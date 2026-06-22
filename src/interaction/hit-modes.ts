// Pure hit-testing for the frozen-pane co-occurrence heatmap. Extracted from
// view.ts so the screen→index math is testable without a live canvas. Rebuilds
// the same geometry the renderer uses (heatmapGeom) so hit-testing and drawing
// can never disagree.
import { heatmapGeom } from "../draw/draw-heatmap";
import type { HeatmapMeta } from "../layout/layout";

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
