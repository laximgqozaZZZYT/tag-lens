// Pure hit-testing for the frozen-pane modes (connection matrix, co-occurrence
// heatmap). Extracted from view.ts so the screen→index math is testable without
// a live canvas. Each helper rebuilds the same geometry the renderer uses
// (matrixGeom/heatmapGeom) so hit-testing and drawing can never disagree.
import { matrixGeom } from "../draw/draw-matrix";
import { heatmapGeom } from "../draw/draw-heatmap";
import type { MatrixMeta, HeatmapMeta } from "../layout/layout";

// Display-line index under sy (-1 = top header band / out of range). `lineCount`
// is the number of visible matrix lines (rows + collapsed summaries).
export function hitMatrixLine(
	matrix: MatrixMeta,
	lineCount: number,
	zoom: number,
	panY: number,
	canvasCssW: number,
	sy: number,
): number {
	const g = matrixGeom(matrix, zoom, canvasCssW);
	if (sy < g.headerH) return -1;
	const li = Math.floor((sy - panY) / g.rowScreenH);
	return li >= 0 && li < lineCount ? li : -1;
}

// Column index under sx (-1 = left label band / out of range).
export function hitMatrixCol(
	matrix: MatrixMeta,
	zoom: number,
	panX: number,
	canvasCssW: number,
	sx: number,
): number {
	const g = matrixGeom(matrix, zoom, canvasCssW);
	if (sx < g.labelBand) return -1;
	const c = Math.floor((sx - panX) / g.colScreenW);
	return c >= 0 && c < matrix.cols.length ? c : -1;
}

// Heatmap cell (row i, col j) under (sx, sy), or null over a frozen band / out
// of range. The grid is symmetric n×n at a fixed cell pitch.
export function hitHeatmapCell(
	heatmap: HeatmapMeta,
	zoom: number,
	panX: number,
	panY: number,
	canvasCssW: number,
	sx: number,
	sy: number,
): { i: number; j: number } | null {
	const g = heatmapGeom(heatmap, zoom, canvasCssW);
	if (sx < g.labelBand || sy < g.headerH) return null;
	const j = Math.floor((sx - panX) / g.cellPx);
	const i = Math.floor((sy - panY) / g.cellPx);
	if (i < 0 || i >= heatmap.n || j < 0 || j >= heatmap.n) return null;
	return { i, j };
}
