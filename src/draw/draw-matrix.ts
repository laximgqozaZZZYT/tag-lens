// Connection-matrix renderer. Screen-space (frozen panes): a left band of
// row (note) labels, a top band of column (tag) labels, and the cell grid in
// between. The grid scrolls vertically at a FIXED readable row pitch with
// only the visible rows/columns drawn (virtualization). Consecutive
// same-signature rows are bundled into BLOCKS (count badge + divider +
// alternating shade); blocks can be collapsed to a single "×N" summary line.
import { theme, colorAlpha } from "./theme";
import type { MatrixMeta } from "../layout/layout";
import { clusterHue, truncateToWidth } from "./canvas-utils";

export interface MatrixGeom {
	labelBand: number; // left row-label band width (CSS px)
	headerH: number; // top column-label band height (CSS px)
	rowScreenH: number; // floored row pitch
	colScreenW: number; // colW * zoom
}

// One visible display line: a real note row, or a collapsed block summary.
export type MatrixLine =
	| { kind: "row"; rowIdx: number; blockIdx: number; head: boolean }
	| { kind: "summary"; blockIdx: number };

// Minimum on-screen row pitch so the row labels never overlap, regardless of
// zoom. Rows scroll vertically at (at least) this height; only columns shrink
// to fit the width.
const MIN_ROW_PX = 18;
const BADGE_W = 30; // left zone of a block-head label that toggles collapse

// Shared geometry so the renderer and hit-testing agree.
export function matrixGeom(
	matrix: MatrixMeta,
	zoom: number,
	canvasCssW: number,
): MatrixGeom {
	const labelBand = Math.min(380, Math.max(170, canvasCssW * 0.27));
	return {
		labelBand,
		headerH: 92,
		rowScreenH: Math.max(MIN_ROW_PX, matrix.rowH * zoom),
		colScreenW: matrix.colW * zoom,
	};
}

export const MATRIX_BADGE_W = BADGE_W;

interface DrawOpts {
	zoom: number;
	panX: number;
	panY: number;
	canvas: HTMLCanvasElement;
	dpr?: number; // injected effective DPR (supersample on PNG export); falls back to the window value
	selectedCol: string | null;
	minFontPx: number;
	lines: MatrixLine[];
	group: boolean; // show block badges / dividers / shading
	hoverLine: number; // display-line index under cursor (-1 = none)
	hoverCol: number; // column index under cursor (-1 = none)
}

// Tags of a block's signature (all rows in a block share the same bits), for
// the summary-line label.
function signatureLabel(matrix: MatrixMeta, rowIdx: number): string {
	const b = matrix.bits[rowIdx];
	const names: string[] = [];
	for (let c = 0; c < matrix.cols.length; c++)
		if ((b[c >> 3] >> (c & 7)) & 1) names.push(matrix.cols[c].label);
	return names.join(", ");
}

export function drawMatrix(
	ctx: CanvasRenderingContext2D,
	matrix: MatrixMeta,
	o: DrawOpts,
): void {
	const dpr = o.dpr ?? (window.devicePixelRatio || 1);
	const visW = o.canvas.width / dpr;
	const visH = o.canvas.height / dpr;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.fillStyle = theme().canvasBg;
	ctx.fillRect(0, 0, visW, visH);

	const { cols, bits } = matrix;
	const nCols = cols.length;
	const lines = o.lines;
	const g = matrixGeom(matrix, o.zoom, visW);
	const { labelBand, headerH, rowScreenH, colScreenW } = g;
	if (rowScreenH <= 0 || colScreenW <= 0) return;

	const l0 = Math.max(0, Math.floor((headerH - o.panY) / rowScreenH));
	const l1 = Math.min(lines.length - 1, Math.ceil((visH - o.panY) / rowScreenH));
	const c0 = Math.max(0, Math.floor((labelBand - o.panX) / colScreenW));
	const c1 = Math.min(nCols - 1, Math.ceil((visW - o.panX) / colScreenW));
	const selIdx =
		o.selectedCol != null ? cols.findIndex((c) => c.key === o.selectedCol) : -1;
	const lineY = (li: number): number => li * rowScreenH + o.panY;

	// Selected-column band (behind cells).
	if (selIdx >= 0) {
		const x = selIdx * colScreenW + o.panX;
		if (x + colScreenW > labelBand && x < visW) {
			ctx.fillStyle = colorAlpha(theme().warn, 0.16);
			ctx.fillRect(Math.max(labelBand, x), headerH, colScreenW, visH - headerH);
		}
	}
	// Hover crosshair column band.
	if (o.hoverCol >= 0) {
		const x = o.hoverCol * colScreenW + o.panX;
		if (x + colScreenW > labelBand && x < visW) {
			ctx.fillStyle = colorAlpha(theme().accent, 0.16);
			ctx.fillRect(Math.max(labelBand, x), headerH, colScreenW, visH - headerH);
		}
	}

	// CELLS + per-block shading (clipped to data area).
	ctx.save();
	ctx.beginPath();
	ctx.rect(labelBand, headerH, visW - labelBand, visH - headerH);
	ctx.clip();
	// Dot radius derives ONLY from the matrix cell pitch (matrix.rowH / colW,
	// fixed constants) × zoom — NEVER from node sizing (Size by / Incoming
	// links / m×n). A membership dot always means the same thing, so it must be
	// one uniform size regardless of NODE DISPLAY settings.
	const dotR = Math.max(1.5, Math.min(rowScreenH, colScreenW) * 0.32);
	for (let li = l0; li <= l1; li++) {
		const line = lines[li];
		const y = lineY(li);
		if (o.group && line.blockIdx % 2 === 0) {
			ctx.fillStyle = theme().overlay(0.08);
			ctx.fillRect(labelBand, y, visW - labelBand, rowScreenH);
		}
		// Block divider above a block head / summary.
		if (o.group && (line.kind === "summary" || line.head)) {
			ctx.strokeStyle = colorAlpha(theme().accent, 0.25);
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(labelBand, y + 0.5);
			ctx.lineTo(visW, y + 0.5);
			ctx.stroke();
		}
		const srcRow = line.kind === "row" ? line.rowIdx : matrix.blocks[line.blockIdx].start;
		const cy = y + rowScreenH / 2;
		const b = bits[srcRow];
		const summary = line.kind === "summary";
		// Brighten + enlarge the hovered row's dots so a note whose dots jump
		// across distant columns can be followed along the single row band.
		const hot = li === o.hoverLine;
		for (let c = c0; c <= c1; c++) {
			if (!((b[c >> 3] >> (c & 7)) & 1)) continue;
			const cx = c * colScreenW + o.panX + colScreenW / 2;
			ctx.fillStyle =
				c === selIdx
					? theme().warn
					: theme().swatch(clusterHue(cols[c].key), hot ? "fillStrong" : "fill");
			ctx.beginPath();
			ctx.arc(cx, cy, (summary ? dotR * 1.15 : dotR) * (hot ? 1.35 : 1), 0, Math.PI * 2);
			ctx.fill();
		}
	}
	// Hover crosshair row band (over cells) — drawn under the dots above via
	// composite order; kept light but a touch stronger so the full row reads.
	if (o.hoverLine >= l0 && o.hoverLine <= l1) {
		ctx.fillStyle = colorAlpha(theme().accent, 0.16);
		ctx.fillRect(labelBand, lineY(o.hoverLine), visW - labelBand, rowScreenH);
	}
	ctx.restore();

	// LEFT band — row / summary labels (frozen x, scroll y).
	ctx.fillStyle = colorAlpha(theme().canvasBgAlt, 0.97);
	ctx.fillRect(0, headerH, labelBand, visH - headerH);
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, headerH, labelBand, visH - headerH);
	ctx.clip();
	const rowFont = Math.max(o.minFontPx, 13);
	ctx.textBaseline = "middle";
	for (let li = l0; li <= l1; li++) {
		const line = lines[li];
		const cy = lineY(li) + rowScreenH / 2;
		// Same alternating block shade as the cell area, extended across the
		// row-label band so each signature block reads as one continuous stripe.
		if (o.group && line.blockIdx % 2 === 0) {
			ctx.fillStyle = theme().overlay(0.08);
			ctx.fillRect(0, lineY(li), labelBand, rowScreenH);
		}
		if (li === o.hoverLine) {
			ctx.fillStyle = colorAlpha(theme().accent, 0.12);
			ctx.fillRect(0, lineY(li), labelBand, rowScreenH);
		}
		const blk = matrix.blocks[line.blockIdx];
		if (line.kind === "summary") {
			const n = blk.count;
			ctx.font = `700 ${rowFont}px sans-serif`;
			ctx.fillStyle = theme().accent;
			ctx.textAlign = "start";
			const badge = `×${n}`;
			ctx.fillText(badge, 8, cy);
			const bw = ctx.measureText(badge).width + 12;
			ctx.font = `${rowFont}px sans-serif`;
			ctx.fillStyle = theme().textMuted;
			const sig = signatureLabel(matrix, blk.start) || "(no tags)";
			ctx.fillText(truncateToWidth(ctx, sig, labelBand - 14 - bw), 8 + bw, cy);
			continue;
		}
		let x = 8;
		if (o.group && line.head && blk.count > 1) {
			ctx.font = `700 ${rowFont}px sans-serif`;
			ctx.fillStyle = theme().accent;
			ctx.textAlign = "start";
			const badge = `×${blk.count}`;
			ctx.fillText(badge, 8, cy);
			x = 8 + ctx.measureText(badge).width + 8;
		}
		ctx.font = `${rowFont}px sans-serif`;
		ctx.fillStyle = theme().textNormal;
		ctx.textAlign = "start";
		ctx.fillText(
			truncateToWidth(ctx, matrix.rows[line.rowIdx].label, labelBand - x - 6),
			x,
			cy,
		);
	}
	ctx.restore();

	// TOP band — column (tag) labels, rotated, with width LOD.
	ctx.fillStyle = colorAlpha(theme().canvasBgAlt, 0.97);
	ctx.fillRect(0, 0, visW, headerH);
	ctx.save();
	ctx.beginPath();
	ctx.rect(labelBand, 0, visW - labelBand, headerH);
	ctx.clip();
	const colFont = Math.max(o.minFontPx, 11);
	const colStride = colScreenW < 9 ? Math.ceil(9 / Math.max(1, colScreenW)) : 1;
	for (let c = c0; c <= c1; c += colStride) {
		const x = c * colScreenW + o.panX + colScreenW / 2;
		if (x < labelBand) continue;
		const sel = c === selIdx || c === o.hoverCol;
		ctx.save();
		ctx.translate(x, headerH - 6);
		ctx.rotate(-Math.PI / 2);
		ctx.font = `${sel ? 700 : 400} ${colFont}px sans-serif`;
		ctx.textAlign = "start";
		ctx.textBaseline = "middle";
		ctx.fillStyle = sel ? theme().warn : theme().swatch(clusterHue(cols[c].key), "fill");
		ctx.fillText(
			truncateToWidth(ctx, `${cols[c].label} (${cols[c].size})`, headerH - 12),
			0,
			0,
		);
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
