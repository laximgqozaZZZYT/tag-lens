// Initial fit for the tiered lattice mode. The lattice's value is the tier
// comparison, so it is fit vertically first (every tier must be visible) and
// horizontally only when that doesn't push the header text below a readable
// size. panX/panY then either centre the figure (when it fits a dimension) or
// pin it: X just past the screen-fixed tier-label gutter, Y at the top pad —
// so the gutter never overlaps a node at default zoom.
//
// Sibling of `contentBounds`/`heatmapGeom`: a pure geometry builder the view's
// initial-fit path consumes, keeping the zoom/pan assignment in the view.
import { clampZoom } from "../util/clamp-zoom";

export interface LatticeFit {
	zoom: number;
	panX: number;
	panY: number;
}

export function latticeFit(
	worldWidth: number,
	worldHeight: number,
	visW: number,
	visH: number,
	gutter: number,
): LatticeFit {
	const pad = 8;
	const usableW = Math.max(1, visW - gutter - pad);
	const zoomY = (visH - pad * 2) / Math.max(1, worldHeight);
	const zoomX = usableW / Math.max(1, worldWidth);
	// Floor below which header text would shrink below ~10 screen px
	// (HEADER_H = 22 world × 0.45 ≈ 10 px).
	const MIN_READABLE = 0.45;
	const zoom = clampZoom(Math.min(zoomY, zoomX), MIN_READABLE);
	// Pin the leftmost node just past the gutter; centre on the gutter-right
	// side when the whole lattice fits horizontally.
	const worldShownW = worldWidth * zoom;
	const panX = worldShownW <= usableW ? gutter + (usableW - worldShownW) / 2 : gutter;
	const worldShownH = worldHeight * zoom;
	const panY = worldShownH <= visH - pad * 2 ? pad + (visH - pad * 2 - worldShownH) / 2 : pad;
	return { zoom, panX, panY };
}
