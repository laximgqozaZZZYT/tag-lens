// Centre-on-cell fit for the Icon Gallery (droste) mode. Unlike the other
// modes' whole-figure fits, the gallery frames a SINGLE focus cell: zoom to a
// readable icon size (~55% of the smaller canvas dimension per cell) and pan so
// the cell's centre sits at the canvas centre. col/row are the cell's grid
// coordinates; cellSize is the world-space cell pitch (DROSTE_CELL).
//
// Sibling of `latticeFit`/`upsetFit`/`heatmapFit`/`contentFit`: a pure geometry
// builder the view's fit/centre path consumes, keeping the zoom/pan assignment
// in the view.
import { clampZoom } from "../util/clamp-zoom";

export interface DrosteFit {
	zoom: number;
	panX: number;
	panY: number;
}

export function drosteFit(
	cell: { col: number; row: number },
	cw: number,
	ch: number,
	cellSize: number,
): DrosteFit {
	const w = cw || 1;
	const h = ch || 1;
	// Readable icon zoom: fit ~55% of the smaller canvas dimension to one cell.
	const zoom = clampZoom((Math.min(w, h) * 0.55) / cellSize, 0.05, 3);
	// World centre of the target cell, then pan it to the canvas centre.
	const wx = (cell.col + 0.5) * cellSize;
	const wy = (cell.row + 0.5) * cellSize;
	const panX = w / 2 - wx * zoom;
	const panY = h / 2 - wy * zoom;
	return { zoom, panX, panY };
}
