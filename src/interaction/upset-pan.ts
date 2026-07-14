// Pure horizontal pan-clamp math for UpSet mode. Extracted from view.ts so the
// user-specified edge rule (2026-05-26) can be regression-tested without the
// DOM-heavy view. A sibling of `clampSpreadsheetPan` (frozen-pane grids).
//
// The "Pareto-shaped" card-stack columns and their matching matrix dots must
// start at the RIGHT edge of the footer's row-label band (`leftBandPx`), never
// to the left of it. So:
//   maxPanX = leftBandPx            (world-x=0 sits at screen-x=leftBandPx)
//   minPanX = canvasW - contentW    (cards' right edge at the canvas right)
// When the cards fit in the area right of the label band they pin to maxPanX
// (no panning needed); otherwise panX is clamped into [minPanX, maxPanX].

// Clamp an UpSet horizontal pan.
//   panX      : the requested pan
//   contentW  : cards' world width already scaled by zoom
//   canvasW   : the canvas client width
//   leftBandPx: the frozen row-label band width
export function clampUpsetPanX(
	panX: number,
	contentW: number,
	canvasW: number,
	leftBandPx: number,
): number {
	const availableW = canvasW - leftBandPx;
	const maxPanX = leftBandPx;
	if (contentW <= availableW) return maxPanX;
	const minPanX = canvasW - contentW;
	return Math.max(minPanX, Math.min(maxPanX, panX));
}
