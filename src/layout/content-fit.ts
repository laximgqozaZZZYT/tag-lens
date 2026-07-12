// Initial fit for the default card figure (euler / bubblesets / scatter /
// panorama) — every mode that lays content out in free world space with no
// frozen bands. Given the figure's world bounding box and the visible canvas
// area (already narrowed by the pinned menu on the right), fit the box into the
// area minus asymmetric canvas-pixel padding: extra top room for cluster labels
// (~20 canvas px above each enclosure), symmetric side/bottom pads. The zoom
// floor is intentionally tiny so huge vaults still frame on screen; the user
// zooms in interactively. pan then centres the world box in the padded area.
//
// Sibling of `latticeFit`/`upsetFit`/`heatmapFit`: a pure geometry builder the
// view's initial-fit path consumes, keeping the zoom/pan assignment in the view.
import { clampZoom } from "../util/clamp-zoom";
import type { ContentBounds } from "./content-bounds";

export interface ContentFit {
	zoom: number;
	panX: number;
	panY: number;
}

export function contentFit(bounds: ContentBounds, visW: number, visH: number): ContentFit {
	const { minX, minY, maxX, maxY } = bounds;
	// Reserve canvas-pixel padding (zoom-independent). Top gets extra room
	// for cluster labels which sit ~20 canvas px above each enclosure.
	const padX = 20;
	const padTop = 36;
	const padBottom = 20;
	const fitW = Math.max(1, visW - 2 * padX);
	const fitH = Math.max(1, visH - padTop - padBottom);
	const zx = fitW / Math.max(1, maxX - minX);
	const zy = fitH / Math.max(1, maxY - minY);
	// Min floor is intentionally very low so huge vaults still fit on
	// screen; the user can zoom in interactively as needed.
	const zoom = clampZoom(Math.min(zx, zy), 0.005);
	const worldCenterX = (minX + maxX) / 2;
	const worldCenterY = (minY + maxY) / 2;
	const panX = padX + fitW / 2 - worldCenterX * zoom;
	const panY = padTop + fitH / 2 - worldCenterY * zoom;
	return { zoom, panX, panY };
}
