import { theme, colorAlpha } from "./theme";
import type { LaidOut, ClusterRect } from "../layout/layout";
import type { AggregationGroup } from "../aggregation/types";
import { clusterHue, roundedRectPath, truncateToWidth, drawTextWithHalo } from "./canvas-utils";
import { placeOverviewLabels, type OverviewLabelInput, type MeasuredText } from "./overview-label-placement";
import {
	CARD_TITLE_FONT_PX,
	CARD_BODY_FONT_PX,
	CARD_LINE_HEIGHT_PX,
	CARD_PAD_X,
	CARD_PAD_Y,
	CARD_TITLE_BODY_GAP,
	CARD_RADIUS_PX,
} from "../types";

// Number of extra cells drawn beyond the actual content extent (cards +
// cluster bboxes). Visible breathing room on the right / bottom + an
// extra header strip on the left / top so column A / row 1 stay empty
// AND there's a "next blank cell" hint at every edge.


// Excel-style cell grid drawn across the entire VISIBLE viewport
// (= not just the content footprint). Combined with the wrap-aware
// lat/lon labels, the grid reads like a digital world map that
// continues seamlessly as the user pans — past "180°E" it shows
// "180°", "179°W", "178°W", ... rather than fading into a void.
//
// Drawn before any other body content so cards / enclosures sit on top.
export function drawCardGrid(
	ctx: CanvasRenderingContext2D,
	laid: LaidOut,
	canvas: HTMLCanvasElement,
	zoom: number,
	panX: number,
	panY: number,
): void {
	const W = laid.slotW;
	const H = laid.slotH;
	if (W <= 0 || H <= 0) return;

	// Visible world rect: invert the (pan, zoom) screen transform.
	// In CSS pixels: world.x = (screen_x − panX) / zoom.
	const dpr = window.devicePixelRatio || 1;
	const visW = canvas.width / dpr;
	const visH = canvas.height / dpr;
	const leftWorld = -panX / zoom;
	const rightWorld = (visW - panX) / zoom;
	const topWorld = -panY / zoom;
	const bottomWorld = (visH - panY) / zoom;

	const minCol = Math.floor(leftWorld / W) - 1;
	const maxCol = Math.ceil(rightWorld / W) + 1;
	const minRow = Math.floor(topWorld / H) - 1;
	const maxRow = Math.ceil(bottomWorld / H) + 1;

	// Safety: cap cell count per draw so an extreme zoom-out doesn't
	// trigger millions of segments.
	const maxCells = 8000;
	const cellCount = (maxCol - minCol + 1) * (maxRow - minRow + 1);
	if (cellCount > maxCells) return;

	const axX = laid.axes?.x;
	const axY = laid.axes?.y;

	ctx.strokeStyle = theme().overlay(0.22);
	ctx.lineWidth = 1 / zoom;
	ctx.beginPath();

	const xLines: number[] = [];
	if (axX) {
		if (axX.kind === "categorical" && axX.bands) {
			for (const b of axX.bands) {
				xLines.push(b.start);
				xLines.push(b.end);
			}
		} else {
			if (axX.ticks) {
				xLines.push(...axX.ticks.map(t => t.pos));
			}
		}
	} else {
		for (let c = minCol; c <= maxCol; c++) {
			xLines.push(c * W);
		}
	}

	const yLines: number[] = [];
	if (axY) {
		if (axY.kind === "categorical" && axY.bands) {
			for (const b of axY.bands) {
				yLines.push(b.start);
				yLines.push(b.end);
			}
		} else {
			if (axY.ticks) {
				yLines.push(...axY.ticks.map(t => t.pos));
			}
		}
	} else {
		for (let r = minRow; r <= maxRow; r++) {
			yLines.push(r * H);
		}
	}

	const uniqX = [...new Set(xLines)].filter(x => x >= leftWorld && x <= rightWorld);
	const uniqY = [...new Set(yLines)].filter(y => y >= topWorld && y <= bottomWorld);

	for (const x of uniqX) {
		ctx.moveTo(x, topWorld);
		ctx.lineTo(x, bottomWorld);
	}
	for (const y of uniqY) {
		ctx.moveTo(leftWorld, y);
		ctx.lineTo(rightWorld, y);
	}
	ctx.stroke();
}

// Frozen-pane row/column headers drawn in SCREEN space (identity
// transform) so they stay glued to the canvas edges regardless of
// pan/zoom — like Excel's frozen header rows / columns.
export function drawGridHeaders(
	ctx: CanvasRenderingContext2D,
	laid: LaidOut,
	canvas: HTMLCanvasElement,
	zoom: number,
	panX: number,
	panY: number,
	minFontPx: number = 0,
): void {
	const W = laid.slotW;
	const H = laid.slotH;
	if (W <= 0 || H <= 0) return;

	const dpr = window.devicePixelRatio || 1;
	const visW = canvas.width / dpr;
	const visH = canvas.height / dpr;
	const cellScreenW = W * zoom;
	const cellScreenH = H * zoom;
	// Header labels span the ENTIRE viewport (= the grid below them is
	// continuous like a world map, so the labels must follow). Range
	// derived from inverse pan/zoom — same math as drawCardGrid.
	const leftWorld = -panX / zoom;
	const rightWorld = (visW - panX) / zoom;
	const topWorld = -panY / zoom;
	const bottomWorld = (visH - panY) / zoom;
	const minCol = Math.floor(leftWorld / W) - 1;
	const maxCol = Math.ceil(rightWorld / W) + 1;
	const minRow = Math.floor(topWorld / H) - 1;
	const maxRow = Math.ceil(bottomWorld / H) + 1;
	const headerH = Math.max(22, Math.min(36, cellScreenH * 0.9));
	const headerW = Math.max(32, Math.min(56, cellScreenW * 0.7));
	// Safety cap: at extreme zoom-out the visible cell count explodes.
	// Skip per-cell tick rendering when it would generate too many
	// segments; the corner / band overlays still draw below.
	const headerCellCount = (maxCol - minCol) + (maxRow - minRow);
	const skipTicks = headerCellCount > 4000;

	const axX = laid.axes?.x;
	const axY = laid.axes?.y;

	ctx.fillStyle = colorAlpha(theme().panelBg, 0.98);
	ctx.fillRect(0, 0, visW, headerH);
	ctx.fillRect(0, 0, headerW, visH);

	if (!skipTicks) {
		ctx.strokeStyle = theme().overlay(0.45);
		ctx.lineWidth = 1;
		ctx.beginPath();
		if (laid.axes) {
			if (axX) {
				const lines = axX.kind === "categorical" && axX.bands
					? [...axX.bands.map(b => b.start), axX.bands.length > 0 ? axX.bands[axX.bands.length - 1].end : 0]
					: axX.ticks?.map(t => t.pos) || [];
				for (const x of lines) {
					const sx = x * zoom + panX;
					if (sx < headerW - 0.5 || sx > visW + 0.5) continue;
					ctx.moveTo(sx, 0);
					ctx.lineTo(sx, headerH);
				}
			} else {
				for (let c = minCol; c <= maxCol + 1; c++) {
					const x = c * W * zoom + panX;
					if (x < headerW - 0.5 || x > visW + 0.5) continue;
					ctx.moveTo(x, 0);
					ctx.lineTo(x, headerH);
				}
			}
			if (axY) {
				const lines = axY.kind === "categorical" && axY.bands
					? [...axY.bands.map(b => b.start), axY.bands.length > 0 ? axY.bands[axY.bands.length - 1].end : 0]
					: axY.ticks?.map(t => t.pos) || [];
				for (const y of lines) {
					const sy = y * zoom + panY;
					if (sy < headerH - 0.5 || sy > visH + 0.5) continue;
					ctx.moveTo(0, sy);
					ctx.lineTo(headerW, sy);
				}
			} else {
				for (let r = minRow; r <= maxRow + 1; r++) {
					const y = r * H * zoom + panY;
					if (y < headerH - 0.5 || y > visH + 0.5) continue;
					ctx.moveTo(0, y);
					ctx.lineTo(headerW, y);
				}
			}
		} else {
			for (let c = minCol; c <= maxCol + 1; c++) {
				const x = c * W * zoom + panX;
				if (x < headerW - 0.5 || x > visW + 0.5) continue;
				ctx.moveTo(x, 0);
				ctx.lineTo(x, headerH);
			}
			for (let r = minRow; r <= maxRow + 1; r++) {
				const y = r * H * zoom + panY;
				if (y < headerH - 0.5 || y > visH + 0.5) continue;
				ctx.moveTo(0, y);
				ctx.lineTo(headerW, y);
			}
		}
		ctx.stroke();
	}

	ctx.strokeStyle = colorAlpha(theme().accent, 0.9);
	ctx.lineWidth = 1.6;
	ctx.beginPath();
	ctx.moveTo(0, headerH);
	ctx.lineTo(visW, headerH);
	ctx.moveTo(headerW, 0);
	ctx.lineTo(headerW, visH);
	ctx.stroke();

	// Labels with stride so they don't overlap at low zoom.
	// Stride bumped a bit because lat/lon labels are wider than the old
	// "A" / "1" forms.
	const colStride = Math.max(1, Math.ceil(36 / Math.max(1, cellScreenW)));
	const rowStride = Math.max(1, Math.ceil(28 / Math.max(1, cellScreenH)));
	const fontPx = Math.max(
		minFontPx,
		Math.min(headerH * 0.62, headerW * 0.4, 14),
	);
	ctx.font = `700 ${fontPx}px sans-serif`;
	ctx.fillStyle = theme().textNormal;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	if (!skipTicks) {
		if (laid.axes) {
			if (axX) {
				if (axX.kind === "categorical" && axX.bands) {
					for (const b of axX.bands) {
						const xC = b.center * zoom + panX;
						if (xC < headerW || xC > visW) continue;
						const bwScreen = (b.end - b.start) * zoom;
						ctx.font = `700 ${fontPx}px sans-serif`;
						const tw = ctx.measureText(b.label).width;
						const targetFont = Math.max(6, fontPx * Math.min(1, (bwScreen - 8) / Math.max(1, tw)));
						ctx.font = `700 ${targetFont}px sans-serif`;
						ctx.fillText(b.label, xC, headerH / 2);
					}
				} else {
					let lastRight = -1;
					for (const t of axX.ticks || []) {
						const xC = t.pos * zoom + panX;
						if (xC < headerW || xC > visW) continue;
						ctx.font = `700 ${fontPx}px sans-serif`;
						const w = ctx.measureText(t.label).width;
						if (xC - w / 2 < lastRight + 10) continue;
						ctx.fillText(t.label, xC, headerH / 2);
						lastRight = xC + w / 2;
					}
				}
			}
			if (axY) {
				if (axY.kind === "categorical" && axY.bands) {
					for (const b of axY.bands) {
						const yC = b.center * zoom + panY;
						if (yC < headerH || yC > visH) continue;
						ctx.save();
						ctx.translate(headerW / 2, yC);
						ctx.rotate(-Math.PI / 2);
						const bhScreen = (b.end - b.start) * zoom;
						ctx.font = `700 ${fontPx}px sans-serif`;
						const th = ctx.measureText(b.label).width;
						const targetFont = Math.max(6, fontPx * Math.min(1, (bhScreen - 8) / Math.max(1, th)));
						ctx.font = `700 ${targetFont}px sans-serif`;
						ctx.fillText(b.label, 0, 0);
						ctx.restore();
					}
				} else {
					let lastBottom = -1;
					for (const t of axY.ticks || []) {
						const yC = t.pos * zoom + panY;
						if (yC < headerH || yC > visH) continue;
						const h = fontPx;
						if (yC - h / 2 < lastBottom + 10) continue;
						ctx.fillText(t.label, headerW / 2, yC);
						lastBottom = yC + h / 2;
					}
				}
			}
		} else {
			for (let c = minCol; c <= maxCol; c += colStride) {
				const xC = c * W * zoom + panX + cellScreenW / 2;
				if (xC < headerW || xC > visW) continue;
				ctx.fillText(longitudeLabel(c), xC, headerH / 2);
			}
			for (let r = minRow; r <= maxRow; r += rowStride) {
				const yC = r * H * zoom + panY + cellScreenH / 2;
				if (yC < headerH || yC > visH) continue;
				ctx.fillText(latitudeLabel(r), headerW / 2, yC);
			}
		}
	}
	ctx.textAlign = "start";
	ctx.textBaseline = "alphabetic";

	// Corner block — slightly darker to anchor the header origin.
	ctx.fillStyle = theme().panelBg;
	ctx.fillRect(0, 0, headerW, headerH);
	ctx.strokeStyle = colorAlpha(theme().accent, 0.9);
	ctx.lineWidth = 1.6;
	ctx.beginPath();
	ctx.moveTo(0, headerH);
	ctx.lineTo(headerW, headerH);
	ctx.moveTo(headerW, 0);
	ctx.lineTo(headerW, headerH);
	ctx.stroke();
}

// Map a column index to a longitude label, wrapped to (−180°, 180°].
// The cell at col 0 (= the column containing world x = 0) is the prime
// meridian ("0°"). Cells east of it get "${n}°E", west cells get
// "${n}°W". The label wraps modulo 360 so col 200 → "160°W" (=
// equivalent meridian on the other side of the date line), reflecting
// the "両端が構造上で繋がる" (toroidal longitude) topology — even
// though rendering stays on a flat plane.
function longitudeLabel(col: number): string {
	const n = wrapTo(col, 360, -180);
	if (n === 0) return "0°";
	if (n === 180 || n === -180) return "180°";
	return `${Math.abs(n)}°${n > 0 ? "E" : "W"}`;
}

// Map a row index to a latitude label, wrapped to (−90°, 90°]. Rows
// count DOWN in screen coords, so row r > 0 (= below origin) = south.
// Row 0 (= the row containing world y = 0) is the equator ("0°"). The
// label wraps modulo 180 so row 100 → "80°N" (= equivalent latitude
// on the antipodal side, as if you continued past the south pole and
// came up the other side of the globe).
function latitudeLabel(row: number): string {
	const n = wrapTo(row, 180, -90);
	if (n === 0) return "0°";
	if (n === 90 || n === -90) return "90°";
	return `${Math.abs(n)}°${n > 0 ? "S" : "N"}`;
}

// Wrap an integer cell index into the half-open interval
// [min, min + period). Used so column/row indices map back into the
// canonical latitude/longitude range regardless of how far the grid
// extends. JS `%` returns negative remainders for negative dividends;
// the double-mod idiom normalises that.
function wrapTo(v: number, period: number, min: number): number {
	const max = min + period;
	const m = (((v - min) % period) + period) % period;
	const out = m + min;
	// Snap the +max boundary back to min so e.g. col 180 → 180 (not −180);
	// but col 540 (= 3 × 180 wraps) lands on -180 / +180 depending on phase.
	// For our labels we want either "180°" or "0°" at the antimeridian
	// rather than a flipped sign, so leave the value as-is here and let
	// the caller render it.
	if (out === max) return min;
	return out;
}


// Map-style top-left cluster labels with collision avoidance.
// Smaller clusters yield to larger ones (= the larger label keeps its
// natural anchor position). A leader line links a label back to its
// anchor when displacement pushes it more than one line up.
// A placed label's final world-space box (after merge + de-confliction).
// Returned so the caller can debug overlaps against nodes / each other.
export interface PlacedLabelBox {
	key: string;
	x1: number;
	x2: number;
	top: number;
	bot: number;
	text: string;
	anchorX: number;
	anchorY: number;
}

// Overview-only auxiliary labels: one BIG cluster name centred in each
// enclosure, fitted to the enclosure box. Drawn in world space on top of
// everything when the whole diagram is in view, independent of the
// Graph-display toggles and SEPARATE from `drawClusterLabels` (the small
// on-grid title bars). Not used in UpSet mode. Seeded with the small label
// chips (laid.labelCells) as already-occupied space so the giant text never
// renders on top of a chip showing the same (or a different) cluster's name.
export function drawOverviewLabels(
	ctx: CanvasRenderingContext2D,
	laid: LaidOut,
	zoom: number,
	warningClusters?: Map<string, number>,
): void {
	const inputs: OverviewLabelInput[] = laid.clusters
		.filter((c) => !c.ghostSingle && c.memberCount >= 2 && c.width > 0 && c.height > 0)
		.map((c) => ({
			groupKey: c.groupKey,
			text: warningClusters && warningClusters.has(c.groupKey) ? `⚠ ${c.label}` : c.label,
			x: c.x,
			y: c.y,
			width: c.width,
			height: c.height,
		}));
	const occupied = (laid.labelCells ?? []).map((lc) => ({
		x1: lc.x - lc.w / 2,
		y1: lc.y - lc.h / 2,
		x2: lc.x + lc.w / 2,
		y2: lc.y + lc.h / 2,
	}));
	ctx.font = "800 100px sans-serif";
	const measureAt100px = (text: string): MeasuredText => {
		const m = ctx.measureText(text);
		return {
			width: m.width || 1,
			ascent: m.actualBoundingBoxAscent || 74,
			descent: m.actualBoundingBoxDescent || 20,
		};
	};
	const placements = placeOverviewLabels(inputs, measureAt100px, occupied);
	for (const p of placements) {
		ctx.font = `800 ${p.font}px sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		const hue = clusterHue(p.groupKey);
		ctx.lineJoin = "round";
		ctx.lineWidth = Math.max(p.font * 0.08, 2 / zoom);
		ctx.strokeStyle = colorAlpha(theme().canvasBg, 0.9);
		ctx.strokeText(p.text, p.cx, p.cy);
		ctx.fillStyle = theme().swatch(hue, "fill", 0.96);
		ctx.fillText(p.text, p.cx, p.cy);
	}
	ctx.textAlign = "start";
	ctx.textBaseline = "alphabetic";
}

export function drawClusterLabels(
	ctx: CanvasRenderingContext2D,
	laid: LaidOut,
	zoom: number,
	minFontPx: number = 0,
	warningClusters?: Map<string, number>,
): PlacedLabelBox[] {
	// Labels live in the grid cells the LAYOUT reserved for them
	// (`laid.labelCells` — one empty cell per cluster, kept clear of nodes
	// and inside the cluster's enclosure). We just draw each cluster's name
	// in its reserved cell: it is already on a grid cell, clear of nodes and
	// of every other label's cell, so no search / de-confliction is needed.
	const cells = laid.labelCells ?? [];
	if (cells.length === 0) return [];
	const byKey = new Map<string, ClusterRect>();
	for (const c of laid.clusters) byKey.set(c.groupKey, c);

	const screenPx = Math.max(12, minFontPx);
	const labelBg = colorAlpha(theme().canvasBg, 0.9);
	const boxes: PlacedLabelBox[] = [];
	for (const cell of cells) {
		const c = byKey.get(cell.key);
		// `cell.text` overrides (intersection sub-box labels "a*b*c"); otherwise
		// fall back to the owning cluster's "name (count)". A cell with neither
		// is skipped.
		const baseText = cell.text ?? (c ? `${c.label} (${c.memberCount})` : "");
		const text = warningClusters && warningClusters.has(cell.key) ? `⚠ ${baseText}` : baseText;
		if (!text) continue;
		// Clamp the label to the cluster's FINAL bbox (it may have been
		// post-processed after layout, e.g. inheritance expansion). Shrink
		// to fit + clamp centre so the label is never drawn outside its own
		// enclosure — for normal clusters the bbox is larger than the label,
		// so this is a no-op; only stranded labels of territory-less
		// clusters get pulled back in.
		let cw = cell.w;
		let ch = cell.h;
		let cx = cell.x;
		let cy = cell.y;
		if (c && c.width > 0 && c.height > 0) {
			cw = Math.min(cw, c.width);
			ch = Math.min(ch, c.height);
			cx = Math.min(Math.max(cx, c.x + cw / 2), c.x + c.width - cw / 2);
			cy = Math.min(Math.max(cy, c.y + ch / 2), c.y + c.height - ch / 2);
		}
		// Size the font to FILL the reserved ~4×4 cell box: take the largest
		// font that fits both the box width and height. A readability floor
		// (capped by the box height) keeps it legible when zoomed far out.
		const padX = 4 / zoom;
		const maxByH = ch * 0.7;
		ctx.font = "100px sans-serif";
		const w100 = ctx.measureText(text).width || 1;
		const maxByW = ((cw - 2 * padX) * 100) / w100;
		let fontPx = Math.min(maxByH, maxByW);
		fontPx = Math.max(fontPx, Math.min(maxByH, screenPx / zoom));
		ctx.font = `700 ${fontPx}px sans-serif`;
		ctx.textAlign = "start";
		ctx.textBaseline = "middle";
		const fitted = truncateToWidth(ctx, text, cw - 2 * padX);
		const x1 = cx - cw / 2;
		const x2 = cx + cw / 2;
		const top = cy - ch / 2;
		const bot = cy + ch / 2;
		// Opaque tab inside the cell so the label reads cleanly over the grid.
		ctx.fillStyle = labelBg;
		ctx.fillRect(x1, cy - fontPx * 0.62, cw, fontPx * 1.24);

		// Coloured label with halo for extra legibility over stripes/backgrounds.
		drawTextWithHalo(ctx, fitted, cx, cy, {
			font: `700 ${fontPx}px sans-serif`,
			fillStyle: theme().swatch(clusterHue(cell.key), "fill", 1),
			haloStyle: labelBg,
			haloWidth: Math.max(2, fontPx * 0.1),
			textAlign: "center",
			textBaseline: "middle",
		});
		boxes.push({ key: cell.key, x1, x2, top, bot, text, anchorX: cx, anchorY: cy });
	}
	ctx.textAlign = "start";
	ctx.textBaseline = "alphabetic";
	return boxes;
}

// 3-card diagonal stack confined to a SINGLE cell with a small inset
// so the stack never touches the cell boundary, the cluster enclosure,
// or neighbouring cards' strokes.
export function drawAggregateStack(
	ctx: CanvasRenderingContext2D,
	cluster: ClusterRect,
	cardW: number,
	cardH: number,
	count: number,
	zoom: number,
	highlighted = false,
	minFontPx: number = 0,
): void {
	const cx = cluster.x + cluster.width / 2;
	const cy = cluster.y + cluster.height / 2;
	const STACK_INSET = 0.07;
	const SUB_SCALE = 0.78;
	const innerW = cardW * (1 - 2 * STACK_INSET);
	const innerH = cardH * (1 - 2 * STACK_INSET);
	const subW = innerW * SUB_SCALE;
	const subH = innerH * SUB_SCALE;
	const stepX = (innerW - subW) / 2;
	const stepY = (innerH - subH) / 2;
	const r = Math.min(CARD_RADIUS_PX, subW / 2, subH / 2);
	for (let i = 0; i <= 2; i++) {
		const isFront = i === 2;
		const centerX = cx + (1 - i) * stepX;
		const centerY = cy + (1 - i) * stepY;
		const x = centerX - subW / 2;
		const y = centerY - subH / 2;
		ctx.beginPath();
		roundedRectPath(ctx, x, y, subW, subH, r);
		ctx.fillStyle = highlighted
			? isFront
				? theme().warn
				: theme().warn
			: isFront
				? theme().canvasBgAlt
				: theme().canvasBgAlt;
		ctx.fill();
		ctx.lineWidth = (isFront ? (highlighted ? 1.8 : 1.2) : 0.8) / zoom;
		ctx.strokeStyle = highlighted
			? isFront
				? theme().warn
				: theme().warn
			: isFront
				? theme().accent
				: theme().accent;
		ctx.beginPath();
		roundedRectPath(ctx, x, y, subW, subH, r);
		ctx.stroke();
		if (isFront) {
			ctx.textAlign = "start";
			ctx.textBaseline = "top";
			const titleFontPx = Math.max(CARD_TITLE_FONT_PX, minFontPx / Math.max(0.01, zoom));
			const bodyFontPx = Math.max(CARD_BODY_FONT_PX, minFontPx / Math.max(0.01, zoom));
			ctx.font = `600 ${titleFontPx}px sans-serif`;
			ctx.fillStyle = highlighted ? "#1d1100" : theme().textNormal;
			const title = truncateToWidth(
				ctx,
				cluster.label,
				subW - 2 * CARD_PAD_X,
			);
			ctx.fillText(title, x + CARD_PAD_X, y + CARD_PAD_Y);
			ctx.font = `${bodyFontPx}px sans-serif`;
			ctx.fillStyle = highlighted ? "#3a2400" : theme().textMuted;
			ctx.fillText(
				`${count} cards`,
				x + CARD_PAD_X,
				y + CARD_PAD_Y + CARD_LINE_HEIGHT_PX + CARD_TITLE_BODY_GAP,
			);
		}
	}
}

/**
 * Draw a "Junihitoe" stack for aggregated nodes.
 * 
 * Renders a 5-layer cascading stack of card-like shapes with a traditional
 * color palette for the "hems" (borders).
 */
export function drawJunihitoeStack(
	ctx: CanvasRenderingContext2D,
	group: AggregationGroup,
	cardW: number,
	cardH: number,
	zoom: number,
	highlighted = false,
	minFontPx = 0,
): void {
	const cx = group.x;
	const cy = group.y;
	
	const STACK_INSET = 0.05;
	const SUB_SCALE = 0.85;
	const innerW = cardW * (1 - 2 * STACK_INSET);
	const innerH = cardH * (1 - 2 * STACK_INSET);
	const subW = innerW * SUB_SCALE;
	const subH = innerH * SUB_SCALE;
	
	// Offsets for the cascading effect
	const vStep = 2.0; 
	const hStep = 2.0; 
	
	const r = Math.min(CARD_RADIUS_PX, subW / 2, subH / 2);
	
	// Junihitoe-inspired palette (traditional layered hem look)
	const colors = [
		"#6d1d2b", // 1. Deep Red (Kurenai)
		"#c05c30", // 2. Orange-red (Akane)
		"#e9b844", // 3. Golden Yellow (Ki)
		"#4f7239", // 4. Green (Moeghi)
		theme().accent, // 5. Top (Theme Accent)
	];

	for (let i = 0; i < 5; i++) {
		const isFront = i === 4;
		
		// Each layer is offset slightly to show the one beneath
		const ox = (i - 4) * hStep;
		const oy = (i - 4) * vStep;
		
		const x = cx + ox - subW / 2;
		const y = cy + oy - subH / 2;
		
		ctx.beginPath();
		roundedRectPath(ctx, x, y, subW, subH, isFront ? r : r * 0.8);
		
		// Fill: Front is theme card background, others are hem colors
		ctx.fillStyle = isFront ? theme().cardBg : colors[i];
		ctx.fill();
		
		// Stroke
		ctx.lineWidth = (isFront ? (highlighted ? 2.2 : 1.2) : 0.8) / zoom;
		ctx.strokeStyle = isFront ? (highlighted ? theme().accent : theme().cardBorder) : colorAlpha(colors[i], 0.6);
		ctx.stroke();
		
		if (isFront) {
			ctx.textAlign = "start";
			ctx.textBaseline = "top";
			
			const titleFontPx = Math.max(CARD_TITLE_FONT_PX * 0.85, minFontPx / Math.max(0.01, zoom));
			const bodyFontPx = Math.max(CARD_BODY_FONT_PX * 0.85, minFontPx / Math.max(0.01, zoom));
			
			// Label: Attribute Value
			ctx.font = `600 ${titleFontPx}px sans-serif`;
			ctx.fillStyle = highlighted ? theme().accent : theme().textNormal;
			const title = truncateToWidth(
				ctx,
				group.attributeValue,
				subW - 2 * CARD_PAD_X,
			);
			ctx.fillText(title, x + CARD_PAD_X, y + CARD_PAD_Y);
			
			// Count: N nodes
			ctx.font = `${bodyFontPx}px sans-serif`;
			ctx.fillStyle = highlighted ? theme().accent : theme().textMuted;
			ctx.fillText(
				`${group.nodeIds.length} items`,
				x + CARD_PAD_X,
				y + CARD_PAD_Y + CARD_LINE_HEIGHT_PX * 0.85 + CARD_TITLE_BODY_GAP,
			);
		}
	}
}
