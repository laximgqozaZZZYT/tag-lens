// F5 — pure on-canvas legend layout. Consumes LegendSpec[] (source-agnostic) and
// produces a positioned box (sizes computed via an injected text measurer) that
// the renderer paints in screen space. DOM-free + measurer-injected so it
// unit-tests in Node.
import type { NodeShape } from "../encoding/shapes";
import { clamp01 } from "../util/clamp01";
import type { LegendKind, LegendSpec } from "./legend-spec";
import { shapeMarkerPath } from "./draw-shape";

interface LegendItem {
	label: string;
	color?: string | CanvasPattern;
	shape?: NodeShape;
	radius?: number; // size sections: the per-item circle radius (px)
	// Absolute offset from the box's top-left (px). Marker centre is at
	// (x + swatch/2, y + swatch/2) for swatch/shape items.
	x: number;
	y: number;
}
interface LegendSection {
	title: string;
	kind: LegendKind;
	items: LegendItem[];
	titleY: number;
	ramp?: { stops: string[]; minLabel: string; maxLabel: string };
}
export interface LegendBox {
	width: number;
	height: number;
	sections: LegendSection[];
}

export interface LegendLayoutOpts {
	measure: (text: string) => number; // caller pre-binds the font
	fontPx?: number;
	swatch?: number;
	padX?: number;
	padY?: number;
	rowGap?: number;
	sectionGap?: number;
}

export function buildLegendBox(specs: LegendSpec[], opts: LegendLayoutOpts): LegendBox {
	const fontPx = opts.fontPx ?? 11;
	const swatch = opts.swatch ?? 10;
	const padX = opts.padX ?? 8;
	const padY = opts.padY ?? 6;
	const rowGap = opts.rowGap ?? 4;
	const sectionGap = opts.sectionGap ?? 6;

	const sections: LegendSection[] = [];
	let y = padY;
	let maxContentW = 0;

	for (const spec of specs) {
		const titleY = y;
		maxContentW = Math.max(maxContentW, opts.measure(spec.title));
		y += fontPx + rowGap;

		const section: LegendSection = { title: spec.title, kind: spec.kind, items: [], titleY };

		if (spec.kind === "gradient") {
			const ramp = spec.ramp ?? { stops: [], minLabel: "", maxLabel: "" };
			section.ramp = ramp;
			const lineH = Math.max(fontPx, swatch);
			const label = `${ramp.minLabel} … ${ramp.maxLabel}`;
			section.items.push({ label, x: 0, y });
			maxContentW = Math.max(maxContentW, swatch * 4 + 6 + opts.measure(label));
			y += lineH + rowGap;
		} else if (spec.kind === "size") {
			const sizes = spec.sizes ?? [];
			const maxR = sizes.reduce((m, s) => Math.max(m, s.radius), 0);
			for (const s of sizes) {
				section.items.push({ label: s.label, x: 0, y, radius: s.radius, color: s.color });
				const lineH = Math.max(fontPx, 2 * maxR);
				maxContentW = Math.max(maxContentW, 2 * maxR + 6 + opts.measure(s.label));
				y += lineH + rowGap;
			}
		} else {
			const entries = spec.entries ?? [];
			const lineH = Math.max(fontPx, swatch);
			for (const e of entries) {
				const item: LegendItem = { label: e.label, x: 0, y };
				if (e.shape) item.shape = e.shape;
				if (e.color) item.color = e.color;
				section.items.push(item);
				maxContentW = Math.max(maxContentW, swatch + 6 + opts.measure(e.label));
				y += lineH + rowGap;
			}
		}
		y += sectionGap;
		sections.push(section);
	}

	// Trim the trailing sectionGap; add bottom padding.
	if (sections.length) y -= sectionGap;
	const width = Math.ceil(maxContentW + padX * 2);
	const height = Math.ceil(y + padY);
	return { width, height, sections };
}

// ── on-canvas renderer ──────────────────────────────────────────────────────
// Paints the legend in SCREEN space at (originX, originY) — the caller is
// responsible for setting an identity/dpr transform first. Theme colours are
// injected so this file stays free of ./theme coupling.
export interface LegendTheme {
	panelBg: string;
	border: string;
	text: string;
	textMuted: string;
}

export type LegendAnchor = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface LegendRender {
	width: number;
	height: number;
	// Whole legend panel in SCREEN px (for drag hit-testing). null when nothing drawn.
	panelRect: { x: number; y: number; w: number; h: number } | null;
	closeRect: { x: number; y: number; w: number; h: number } | null;
	maxScrollY: number;
}

export function drawLegend(
	ctx: CanvasRenderingContext2D,
	specs: LegendSpec[],
	canvasW: number,
	canvasH: number,
	anchor: LegendAnchor,
	margin: number,
	theme: LegendTheme,
	o?: Partial<LegendLayoutOpts> & { scrollY?: number; maxH?: number },
	showClose = true,
	origin?: { x: number; y: number },
): LegendRender {
	if (!specs.length) return { width: 0, height: 0, panelRect: null, closeRect: null, maxScrollY: 0 };
	const fontPx = o?.fontPx ?? 11;
	const swatch = o?.swatch ?? 10;
	const padX = o?.padX ?? 8;
	ctx.font = `${fontPx}px sans-serif`;
	const opts: LegendLayoutOpts = {
		measure: (t) => ctx.measureText(t).width,
		fontPx, swatch, padX,
		padY: o?.padY, rowGap: o?.rowGap, sectionGap: o?.sectionGap,
	};
	const box = buildLegendBox(specs, opts);
	if (!box.sections.length) return { width: 0, height: 0, panelRect: null, closeRect: null, maxScrollY: 0 };

	const maxAllowedHeight = o?.maxH ?? (canvasH - margin * 2);
	const drawHeight = Math.min(box.height, maxAllowedHeight);
	const maxScrollY = Math.max(0, box.height - drawHeight);
	const scrollY = Math.max(0, Math.min(maxScrollY, o?.scrollY ?? 0));
	const hasScroll = maxScrollY > 0;
	const drawWidth = box.width + (hasScroll ? 10 : 0);

	// Explicit (dragged) origin wins, clamped so the whole panel stays on-screen;
	// otherwise fall back to the anchor corner.
	let originX = anchor.endsWith("right") ? canvasW - drawWidth - margin : margin;
	let originY = anchor.startsWith("bottom") ? canvasH - drawHeight - margin : margin;
	if (origin) {
		originX = Math.max(0, Math.min(canvasW - drawWidth, origin.x));
		originY = Math.max(0, Math.min(canvasH - drawHeight, origin.y));
	}
	// Even without an explicit drag-origin, clamp the anchored position so an
	// oversized panel (box wider/taller than the viewport) never ends up mostly
	// off-screen. This is especially visible in Icon Gallery where legend labels
	// can become long.
	originX = Math.max(0, Math.min(canvasW - drawWidth, originX));
	originY = Math.max(0, Math.min(canvasH - drawHeight, originY));

	// Panel background.
	ctx.fillStyle = theme.panelBg;
	ctx.strokeStyle = theme.border;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.rect(originX, originY, drawWidth, drawHeight);
	ctx.fill();
	ctx.stroke();

	ctx.save();
	ctx.beginPath();
	ctx.rect(originX, originY, drawWidth, drawHeight);
	ctx.clip();

	const sw = swatch;
	for (const sec of box.sections) {
		ctx.font = `600 ${fontPx}px sans-serif`;
		ctx.fillStyle = theme.textMuted;
		ctx.textAlign = "start";
		ctx.textBaseline = "alphabetic";
		ctx.fillText(sec.title, originX + padX, originY - scrollY + sec.titleY + fontPx);

		for (const it of sec.items) {
			const sx = originX + padX;
			const sy = originY - scrollY + it.y;
			if (sec.kind === "gradient") {
				const ramp = sec.ramp ?? { stops: [], minLabel: "", maxLabel: "" };
				const barW = sw * 4;
				const stops = ramp.stops;
				for (let i = 0; i < barW; i++) {
					const t = barW > 1 ? i / (barW - 1) : 0;
					ctx.fillStyle = rampColorAt(stops, t, theme.textMuted);
					ctx.fillRect(sx + i, sy, 1, sw);
				}
				ctx.fillStyle = theme.text;
				ctx.font = `${fontPx}px sans-serif`;
				ctx.textBaseline = "middle";
				ctx.fillText(it.label, sx + barW + 6, sy + sw / 2);
				ctx.textBaseline = "alphabetic";
			} else if (sec.kind === "size") {
				const r = it.radius ?? sw / 2;
				const maxR = sec.items.reduce((m, p) => Math.max(m, p.radius ?? 0), 0);
				const cx = sx + maxR;
				const cy = sy + maxR;
				ctx.beginPath();
				ctx.arc(cx, cy, r, 0, Math.PI * 2);
				ctx.fillStyle = it.color ?? theme.textMuted;
				ctx.fill();
				ctx.strokeStyle = theme.border;
				ctx.lineWidth = 1;
				ctx.stroke();
				ctx.fillStyle = theme.text;
				ctx.font = `${fontPx}px sans-serif`;
				ctx.textBaseline = "middle";
				ctx.fillText(it.label, sx + 2 * maxR + 6, cy);
				ctx.textBaseline = "alphabetic";
			} else if (it.shape) {
				shapeMarkerPath(ctx, it.shape, sx + sw / 2, sy + sw / 2, sw / 2);
				ctx.fillStyle = theme.text;
				ctx.fill();
				ctx.lineWidth = 1;
				ctx.strokeStyle = theme.border;
				ctx.stroke();
				ctx.fillStyle = theme.text;
				ctx.font = `${fontPx}px sans-serif`;
				ctx.textBaseline = "middle";
				ctx.fillText(it.label, sx + sw + 6, sy + sw / 2);
				ctx.textBaseline = "alphabetic";
			} else {
				// Colour swatch (or a muted box for the "+N more"/no-colour overflow row).
				ctx.fillStyle = it.color ?? theme.textMuted;
				ctx.fillRect(sx, sy, sw, sw);
				ctx.strokeStyle = theme.border;
				ctx.lineWidth = 1;
				ctx.strokeRect(sx, sy, sw, sw);
				ctx.fillStyle = it.color ? theme.text : theme.textMuted;
				ctx.font = `${fontPx}px sans-serif`;
				ctx.textBaseline = "middle";
				ctx.fillText(it.label, sx + sw + 6, sy + sw / 2);
				ctx.textBaseline = "alphabetic";
			}
		}
	}

	ctx.restore();

	if (hasScroll) {
		const thumbMinH = 20;
		const trackTop = showClose ? 20 : 4;
		const trackBottom = drawHeight - 4;
		const trackH = trackBottom - trackTop;
		const thumbH = Math.max(thumbMinH, trackH * (drawHeight / box.height));
		const thumbY = originY + trackTop + (scrollY / maxScrollY) * (trackH - thumbH);
		ctx.fillStyle = theme.textMuted;
		ctx.beginPath();
		ctx.roundRect(originX + drawWidth - 8, thumbY, 4, thumbH, 2);
		ctx.fill();
	}

	let closeRect: LegendRender["closeRect"] = null;
	if (showClose) {
		const cb = { x: originX + drawWidth - 12 - 4, y: originY + 4, w: 12, h: 12 };
		ctx.strokeStyle = theme.text;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(cb.x + 2, cb.y + 2);
		ctx.lineTo(cb.x + cb.w - 2, cb.y + cb.h - 2);
		ctx.moveTo(cb.x + cb.w - 2, cb.y + 2);
		ctx.lineTo(cb.x + 2, cb.y + cb.h - 2);
		ctx.stroke();
		closeRect = cb;
	}

	return {
		width: drawWidth,
		height: drawHeight,
		panelRect: { x: originX, y: originY, w: drawWidth, h: drawHeight },
		closeRect,
		maxScrollY,
	};
}

// Sample a colour ramp (array of CSS colour stops) at t in [0,1] by nearest stop.
// Keeps drawLegend DOM-free; stops are pre-resolved CSS colour strings.
function rampColorAt(stops: string[], t: number, fallback: string): string {
	if (!stops.length) return fallback;
	if (stops.length === 1) return stops[0];
	const c = clamp01(t);
	const idx = Math.round(c * (stops.length - 1));
	return stops[idx];
}
