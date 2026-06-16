// F4 — pure on-canvas legend layout. Turns the encoding's BindingLegend[] into a
// positioned box (sizes computed via an injected text measurer) that the renderer
// paints in screen space. DOM-free + measurer-injected so it unit-tests in Node.
import type { BindingLegend } from "../encoding/evaluate";
import { shapeForKey, type NodeShape } from "../encoding/shapes";
import { shapeMarkerPath } from "./draw-shape";

export interface LegendItem {
	label: string;
	color?: string;
	shape?: NodeShape;
	// Absolute offset from the box's top-left (px). Marker centre is at
	// (x + swatch/2, y + swatch/2).
	x: number;
	y: number;
}
export interface LegendSection {
	title: string;
	kind: "categorical" | "quantitative";
	items: LegendItem[];
	min?: number;
	max?: number;
	gradient?: boolean;
	titleY: number;
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
	maxItemsPerSection?: number;
}

const fmtNum = (n: number): string => {
	if (!isFinite(n)) return "—";
	const r = Math.round(n * 100) / 100;
	return Object.is(r, -0) ? "0" : String(r);
};

// Channels that paint a shape glyph instead of a colour swatch in the legend.
const SHAPE_CHANNELS = new Set(["shape"]);

export function buildLegendBox(legends: BindingLegend[], opts: LegendLayoutOpts): LegendBox {
	const fontPx = opts.fontPx ?? 11;
	const swatch = opts.swatch ?? 10;
	const padX = opts.padX ?? 8;
	const padY = opts.padY ?? 6;
	const rowGap = opts.rowGap ?? 4;
	const sectionGap = opts.sectionGap ?? 6;
	const maxItems = opts.maxItemsPerSection ?? 8;
	const lineH = Math.max(fontPx, swatch);

	const sections: LegendSection[] = [];
	let y = padY;
	let maxContentW = 0;

	for (const lg of legends) {
		const isShape = SHAPE_CHANNELS.has(lg.channelId);
		const title = `${capitalize(lg.channelId)} · ${lg.fieldLabel}`;
		const titleY = y;
		maxContentW = Math.max(maxContentW, opts.measure(title));
		y += fontPx + rowGap;

		const section: LegendSection = { title, kind: lg.legend.kind === "quantitative" ? "quantitative" : "categorical", items: [], titleY };

		if (lg.legend.kind === "quantitative") {
			section.min = lg.legend.min;
			section.max = lg.legend.max;
			section.gradient = true;
			const label = `${fmtNum(lg.legend.min ?? 0)} … ${fmtNum(lg.legend.max ?? 0)}`;
			section.items.push({ label, x: 0, y, color: undefined, shape: undefined });
			maxContentW = Math.max(maxContentW, swatch * 4 + 6 + opts.measure(label));
			y += lineH + rowGap;
		} else {
			const entries = lg.legend.entries ?? [];
			const shown = entries.slice(0, maxItems);
			for (const e of shown) {
				const item: LegendItem = { label: e.key, x: 0, y };
				if (isShape) item.shape = shapeForKey(e.key);
				else item.color = e.output;
				section.items.push(item);
				maxContentW = Math.max(maxContentW, swatch + 6 + opts.measure(e.key));
				y += lineH + rowGap;
			}
			if (entries.length > shown.length) {
				const more = `+${entries.length - shown.length} more`;
				section.items.push({ label: more, x: 0, y });
				maxContentW = Math.max(maxContentW, swatch + 6 + opts.measure(more));
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

function capitalize(s: string): string {
	return s.length ? s[0].toUpperCase() + s.slice(1) : s;
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

export function drawLegend(
	ctx: CanvasRenderingContext2D,
	legends: BindingLegend[],
	canvasW: number,
	canvasH: number,
	anchor: LegendAnchor,
	margin: number,
	theme: LegendTheme,
	o?: Partial<LegendLayoutOpts>,
): { width: number; height: number } {
	if (!legends.length) return { width: 0, height: 0 };
	const fontPx = o?.fontPx ?? 11;
	const swatch = o?.swatch ?? 10;
	const padX = o?.padX ?? 8;
	ctx.font = `${fontPx}px sans-serif`;
	const opts: LegendLayoutOpts = {
		measure: (t) => ctx.measureText(t).width,
		fontPx, swatch, padX,
		padY: o?.padY, rowGap: o?.rowGap, sectionGap: o?.sectionGap, maxItemsPerSection: o?.maxItemsPerSection,
	};
	const box = buildLegendBox(legends, opts);
	if (!box.sections.length) return { width: 0, height: 0 };

	const originX = anchor.endsWith("right") ? canvasW - box.width - margin : margin;
	const originY = anchor.startsWith("bottom") ? canvasH - box.height - margin : margin;

	// Panel background.
	ctx.fillStyle = theme.panelBg;
	ctx.strokeStyle = theme.border;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.rect(originX, originY, box.width, box.height);
	ctx.fill();
	ctx.stroke();

	const sw = swatch;
	for (const sec of box.sections) {
		ctx.font = `600 ${fontPx}px sans-serif`;
		ctx.fillStyle = theme.textMuted;
		ctx.textAlign = "start";
		ctx.textBaseline = "alphabetic";
		ctx.fillText(sec.title, originX + padX, originY + sec.titleY + fontPx);

		for (const it of sec.items) {
			const sx = originX + padX;
			const sy = originY + it.y;
			if (sec.gradient) {
				// A small left-to-right value ramp (light → strong) for quantitative.
				const barW = sw * 4;
				for (let i = 0; i < barW; i++) {
					const t = i / barW;
					ctx.fillStyle = `hsl(210, 70%, ${Math.round(75 - t * 55)}%)`;
					ctx.fillRect(sx + i, sy, 1, sw);
				}
				ctx.fillStyle = theme.text;
				ctx.textBaseline = "middle";
				ctx.fillText(it.label, sx + barW + 6, sy + sw / 2);
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
				// Colour swatch (or a muted box for the "+N more" overflow row).
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
	return { width: box.width, height: box.height };
}
