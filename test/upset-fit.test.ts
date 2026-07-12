// upsetFit(cardSlotH, cardsWorldHeight, cardsWorldWidth, footerH, canvasW,
// canvasH, leftBandPx) — initial fit for UpSet: vertical zoom shows ~8–20 card
// rows, horizontal zoom fits all columns into the width past the frozen
// row-label band, min of the two (clampZoom floor 0.05 / ceiling 2). panY
// bottom-anchors the card band to the footer top; panX is left at 0 for
// clampPan(). Behaviour lock for the seam extracted from the view's fitToView.
import { upsetFit } from "../src/layout/upset-fit";
import { ok } from "./assert";

// Width-limited fit: 10 rows (within 8..20) so zoomFromRows is not the min.
{
	const cardSlotH = 20;
	const cardsWorldHeight = 200; // 200/20 = 10 rows
	const cardsWorldWidth = 692;
	const footerH = 100;
	const canvasW = 800;
	const canvasH = 500;
	const leftBandPx = 100;
	// cardsBandH = 400; targetVisibleRows = 10; zoomFromRows = 400/200 = 2.0.
	// visW = 800-100-8 = 692; zoomFromW = 692/692 = 1.0. min = 1.0 (in range).
	const fit = upsetFit(cardSlotH, cardsWorldHeight, cardsWorldWidth, footerH, canvasW, canvasH, leftBandPx);
	ok(fit.zoom === 1.0, "zoom = min(zoomFromRows, zoomFromW) = width-limited 1.0");
	ok(fit.panX === 0, "panX always 0 (clampPan centres/pins)");
	// panY = cardsBandH - cardsWorldHeight*zoom = 400 - 200 = 200.
	ok(fit.panY === 200, "panY bottom-anchors card band to footer top");
}

// Row-limited fit: cardsWorldHeight huge → targetVisibleRows clamps to 20, and
// a small cardsWorldWidth makes zoomFromW large so rows are the min. panY goes
// negative (tall stack extends above the canvas, reachable by panning).
{
	// cardsBandH = 400; targetVisibleRows = clamp(10000/20=500 → 20);
	// zoomFromRows = 400/(20*20) = 1.0. visW = 1000-0-8 = 992;
	// zoomFromW = 992/100 = 9.92. min = 1.0.
	const fit = upsetFit(20, 10000, 100, 100, 1000, 500, 0);
	ok(fit.zoom === 1.0, "row count clamps to 20 → row-limited zoom 1.0");
	ok(fit.panY === 400 - 10000 * 1.0, "panY negative → stack extends above canvas");
}

// Few-rows floor: cardsWorldHeight tiny → targetVisibleRows clamps UP to 8.
{
	// 40/20 = 2 rows → clamp to 8. cardsBandH = 300; zoomFromRows = 300/(8*20)
	// = 0.1875. Make width non-binding (large visW / small width).
	const fit = upsetFit(20, 40, 10, 100, 1000, 400, 0);
	ok(fit.zoom === 300 / (8 * 20), "row count clamps up to 8 → floor'd row zoom");
}

// clampZoom ceiling: both fits exceed 2 → zoom caps at 2.
{
	// zoomFromRows: cardsBandH large, few slot px. cardsBandH = 900,
	// 8 rows * 5 px = 40 → 22.5. zoomFromW = 995/1 = 995. min = 22.5 → clamp 2.
	const fit = upsetFit(5, 40, 1, 100, 1000, 1000, 0);
	ok(fit.zoom === 2, "zoom caps at clampZoom ceiling 2");
}
