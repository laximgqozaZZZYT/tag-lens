// Tag co-occurrence heatmap renderer. Screen-space frozen panes (same pattern
// as draw-matrix): a left band of row (tag) labels, a top band of column (tag)
// labels, and a symmetric n×n cell grid scrolled at a fixed cell pitch with
// only visible rows/cols drawn (virtualization). Cell shade = |Ti ∩ Tj|
// (raw, log+p95-clamped) or Jaccard. The diagonal (|Ti|) is drawn in a
// distinct amber so it reads apart from the blue intersection cells.
import { theme, colorAlpha } from "./theme";
import type { HeatmapMeta } from "./layout";
import { truncateToWidth } from "./canvas-utils";

export interface HeatmapGeom {
	labelBand: number;
	headerH: number;
	cellPx: number;
}

const MIN_CELL = 4;

export function heatmapGeom(
	h: HeatmapMeta,
	zoom: number,
	canvasCssW: number,
): HeatmapGeom {
	return {
		labelBand: Math.min(380, Math.max(170, canvasCssW * 0.27)),
		headerH: 92,
		cellPx: Math.max(MIN_CELL, h.cell * zoom),
	};
}

interface DrawOpts {
	zoom: number;
	panX: number;
	panY: number;
	canvas: HTMLCanvasElement;
	minFontPx: number;
	jaccard: boolean;
	selected: { i: number; j: number } | null;
	hoverRow: number;
	hoverCol: number;
}

export function drawHeatmap(
	ctx: CanvasRenderingContext2D,
	h: HeatmapMeta,
	o: DrawOpts,
): void {
	const dpr = window.devicePixelRatio || 1;
	const visW = o.canvas.width / dpr;
	const visH = o.canvas.height / dpr;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.fillStyle = theme().canvasBg;
	ctx.fillRect(0, 0, visW, visH);

	const n = h.n;
	const g = heatmapGeom(h, o.zoom, visW);
	const { labelBand, headerH, cellPx } = g;
	if (cellPx <= 0 || n === 0) return;

	const c0 = Math.max(0, Math.floor((labelBand - o.panX) / cellPx));
	const c1 = Math.min(n - 1, Math.ceil((visW - o.panX) / cellPx));
	const r0 = Math.max(0, Math.floor((headerH - o.panY) / cellPx));
	const r1 = Math.min(n - 1, Math.ceil((visH - o.panY) / cellPx));
	const cellX = (c: number): number => c * cellPx + o.panX;
	const cellY = (r: number): number => r * cellPx + o.panY;

	let maxSize = 1;
	for (const t of h.tags) if (t.size > maxSize) maxSize = t.size;
	const logRef = Math.log((h.p95 || 1) + 1) || 1;
	const logSize = Math.log(maxSize + 1) || 1;

	// Hover crosshair bands (behind cells).
	if (o.hoverCol >= 0) {
		const x = cellX(o.hoverCol);
		if (x + cellPx > labelBand && x < visW) {
			ctx.fillStyle = colorAlpha(theme().accent, 0.14);
			ctx.fillRect(Math.max(labelBand, x), headerH, cellPx, visH - headerH);
		}
	}
	if (o.hoverRow >= 0) {
		const y = cellY(o.hoverRow);
		if (y + cellPx > headerH && y < visH) {
			ctx.fillStyle = colorAlpha(theme().accent, 0.14);
			ctx.fillRect(labelBand, Math.max(headerH, y), visW - labelBand, cellPx);
		}
	}

	// CELLS (clipped to data area).
	ctx.save();
	ctx.beginPath();
	ctx.rect(labelBand, headerH, visW - labelBand, visH - headerH);
	ctx.clip();
	const inset = cellPx > 6 ? 0.5 : 0;
	// In-cell number LOD: only when a cell is large enough to fit a legible
	// digit (same slot*zoom idea as the matrix). Numbers are the raw COUNT
	// (|Ti ∩ Tj|, or |Ti| on the diagonal) regardless of the colour scale.
	const numFont = Math.max(o.minFontPx, Math.min(cellPx * 0.44, 13));
	const showNums = cellPx >= Math.max(16, o.minFontPx * 2);
	if (showNums) {
		ctx.font = `${numFont}px sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
	}
	// Text colour picked for contrast against the cell's lightness.
	const num = (v: number, cx: number, cy: number, light: number): void => {
		if (v <= 0) return;
		ctx.fillStyle = light > 52 ? "#10141c" : "#eef3f9";
		ctx.fillText(String(v), cx, cy);
	};
	for (let r = r0; r <= r1; r++) {
		const y = cellY(r);
		for (let c = c0; c <= c1; c++) {
			const x = cellX(c);
			if (c === r) {
				// Diagonal = tag size, distinct amber (log-scaled lightness).
				const t = Math.log(h.tags[r].size + 1) / logSize;
				const light = 28 + t * 34;
				ctx.fillStyle = `hsl(42, 85%, ${light}%)`;
				ctx.fillRect(x + inset, y + inset, cellPx - 2 * inset, cellPx - 2 * inset);
				if (showNums) num(h.tags[r].size, x + cellPx / 2, y + cellPx / 2, light);
				continue;
			}
			const cnt = h.counts[r * n + c];
			if (cnt <= 0) continue; // background (no co-occurrence): no fill, no number
			let intensity: number;
			if (o.jaccard) {
				const uni = h.tags[r].size + h.tags[c].size - cnt;
				intensity = uni > 0 ? cnt / uni : 0;
			} else {
				// log scale clamped at the 95th percentile so a few giant pairs
				// don't wash out the rest.
				intensity = Math.min(1, Math.log(cnt + 1) / logRef);
			}
			const light = 16 + intensity * 56;
			ctx.fillStyle = `hsl(210, 72%, ${light}%)`;
			ctx.fillRect(x + inset, y + inset, cellPx - 2 * inset, cellPx - 2 * inset);
			if (showNums) num(cnt, x + cellPx / 2, y + cellPx / 2, light);
		}
	}
	// Selected cell outline (both the cell and its symmetric twin).
	if (o.selected) {
		ctx.strokeStyle = theme().warn;
		ctx.lineWidth = 2;
		for (const [rr, cc] of [
			[o.selected.i, o.selected.j],
			[o.selected.j, o.selected.i],
		]) {
			if (rr < r0 || rr > r1 || cc < c0 || cc > c1) continue;
			ctx.strokeRect(cellX(cc) + 1, cellY(rr) + 1, cellPx - 2, cellPx - 2);
		}
	}
	ctx.restore();

	// LEFT band — row (tag) labels, frozen x, scroll y. LOD: skip rows when the
	// pitch is too small for legible text.
	ctx.fillStyle = colorAlpha(theme().canvasBgAlt, 0.97);
	ctx.fillRect(0, headerH, labelBand, visH - headerH);
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, headerH, labelBand, visH - headerH);
	ctx.clip();
	const font = Math.max(o.minFontPx, 12);
	const stride = cellPx < font + 2 ? Math.ceil((font + 2) / cellPx) : 1;
	ctx.textBaseline = "middle";
	ctx.textAlign = "start";
	for (let r = r0; r <= r1; r++) {
		if (r % stride !== 0 && r !== o.hoverRow) continue;
		const cy = cellY(r) + cellPx / 2;
		const sel = r === o.hoverRow || r === o.selected?.i || r === o.selected?.j;
		ctx.font = `${sel ? 700 : 400} ${font}px sans-serif`;
		ctx.fillStyle = sel ? theme().warn : theme().textNormal;
		ctx.fillText(
			truncateToWidth(ctx, `${h.tags[r].label} (${h.tags[r].size})`, labelBand - 12),
			8,
			cy,
		);
	}
	ctx.restore();

	// TOP band — column (tag) labels, rotated, same LOD stride.
	ctx.fillStyle = colorAlpha(theme().canvasBgAlt, 0.97);
	ctx.fillRect(0, 0, visW, headerH);
	ctx.save();
	ctx.beginPath();
	ctx.rect(labelBand, 0, visW - labelBand, headerH);
	ctx.clip();
	for (let c = c0; c <= c1; c++) {
		if (c % stride !== 0 && c !== o.hoverCol) continue;
		const x = cellX(c) + cellPx / 2;
		if (x < labelBand) continue;
		const sel = c === o.hoverCol || c === o.selected?.i || c === o.selected?.j;
		ctx.save();
		ctx.translate(x, headerH - 6);
		ctx.rotate(-Math.PI / 2);
		ctx.font = `${sel ? 700 : 400} ${font}px sans-serif`;
		ctx.textAlign = "start";
		ctx.textBaseline = "middle";
		ctx.fillStyle = sel ? theme().warn : theme().textMuted;
		ctx.fillText(truncateToWidth(ctx, `${h.tags[c].label}`, headerH - 12), 0, 0);
		ctx.restore();
	}
	ctx.restore();

	// Corner + frozen-pane separators.
	ctx.fillStyle = theme().canvasBg;
	ctx.fillRect(0, 0, labelBand, headerH);
	ctx.strokeStyle = colorAlpha(theme().accent, 0.55);
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(labelBand + 0.5, 0);
	ctx.lineTo(labelBand + 0.5, visH);
	ctx.moveTo(0, headerH + 0.5);
	ctx.lineTo(visW, headerH + 0.5);
	ctx.stroke();
	ctx.textAlign = "start";
	ctx.textBaseline = "alphabetic";
}
