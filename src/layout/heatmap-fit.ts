// Initial fit for the heatmap mode. The square n×n cell grid is fit into the
// smaller of the two data-area dimensions — the canvas minus the frozen label
// band on the left and the header band on top; panX/panY then pin the grid
// origin to those band edges so column A / row 1 sit exactly past the frozen
// panes at default zoom.
//
// labelBand/headerH are zoom-independent (labelBand tracks only canvas width,
// headerH is constant), so a single geom read gives the frozen-band sizes used
// for both the fit area and the pan pins — the view's original three
// heatmapGeom reads (at zoom 1 for the fit, at the fitted zoom for each pin)
// all return the same bands.
//
// Sibling of `latticeFit`/`upsetFit`: a pure geometry builder the view's
// initial-fit path consumes, keeping the zoom/pan assignment in the view.
import { heatmapGeom } from "../draw/draw-heatmap";
import { clampZoom } from "../util/clamp-zoom";
import type { HeatmapMeta } from "./layout";

export interface HeatmapFit {
	zoom: number;
	panX: number;
	panY: number;
}

export function heatmapFit(h: HeatmapMeta, canvasW: number, canvasH: number): HeatmapFit {
	const g = heatmapGeom(h, 1, canvasW);
	const availW = Math.max(1, canvasW - g.labelBand);
	const availH = Math.max(1, canvasH - g.headerH);
	const fit = Math.min(availW, availH) / Math.max(1, h.n * h.cell);
	const zoom = clampZoom(fit, 0.05);
	return { zoom, panX: g.labelBand, panY: g.headerH };
}
