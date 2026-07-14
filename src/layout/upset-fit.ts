// Initial fit for UpSet mode. Cards occupy the canvas band ABOVE the
// screen-fixed footer (full canvas width); the vertical zoom shows ~8–20 card
// rows and the horizontal zoom fits every column into the width that remains
// once the frozen row-label band is excluded. The card band is bottom-anchored
// to the top of the footer, so tall stacks extend above the canvas and are
// reachable by panning; panX is left at 0 for clampPan() to centre or pin.
//
// Sibling of `latticeFit`: a pure geometry builder the view's initial-fit path
// consumes, keeping the zoom/pan assignment (and the screen-space footer height)
// in the view.
import { clampZoom } from "../util/clamp-zoom";

export interface UpsetFit {
	zoom: number;
	panX: number;
	panY: number;
}

export function upsetFit(
	cardSlotH: number,
	cardsWorldHeight: number,
	cardsWorldWidth: number,
	footerH: number,
	canvasW: number,
	canvasH: number,
	leftBandPx: number,
): UpsetFit {
	const cardsBandH = canvasH - footerH;
	const targetVisibleRows = Math.max(8, Math.min(20, cardsWorldHeight / cardSlotH));
	const zoomFromRows = cardsBandH / (targetVisibleRows * cardSlotH);
	// Cards START at the right edge of the row-label band, so the horizontal
	// fit area excludes that band.
	const padX = 8;
	const visW = Math.max(1, canvasW - leftBandPx - padX);
	const zoomFromW = visW / Math.max(1, cardsWorldWidth);
	const zoom = clampZoom(Math.min(zoomFromRows, zoomFromW), 0.05);
	// Cards bottom (= world y = cardsWorldHeight) anchored at the top of the
	// footer; panX starts at 0 (clampPan centres or pins).
	const panY = cardsBandH - cardsWorldHeight * zoom;
	return { zoom, panX: 0, panY };
}
