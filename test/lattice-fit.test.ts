// latticeFit(worldWidth, worldHeight, visW, visH, gutter) — initial fit for
// the tiered lattice: vertical fit prioritised, horizontal fit only above the
// readability floor, then centre-if-fits-else-pin per axis (X pinned past the
// gutter, Y pinned to the top pad). Behaviour lock for the seam extracted from
// the view's initial-fit path.
import { latticeFit } from "../src/layout/lattice-fit";
import { ok } from "./assert";

const PAD = 8;
const GUTTER = 40;
const MIN_READABLE = 0.45;

// A lattice that fits both dimensions with min(zoomY, zoomX) inside the
// readability floor and the clampZoom ceiling (2) → centred on both axes at
// the unclamped fit zoom.
{
	const visW = 400;
	const visH = 300;
	const usableW = visW - GUTTER - PAD; // 352
	const worldWidth = 300;
	const worldHeight = 200;
	const zoomY = (visH - PAD * 2) / worldHeight; // 284/200 = 1.42
	const zoomX = usableW / worldWidth; // 352/300 = 1.173…
	const fit = latticeFit(worldWidth, worldHeight, visW, visH, GUTTER);
	ok(fit.zoom === Math.min(zoomY, zoomX), "zoom = min(zoomY, zoomX) when in [floor, 2]");
	// worldShownW = 300 * (352/300) = 352 = usableW → fits → centred (offset 0).
	ok(fit.panX === GUTTER + (usableW - worldWidth * fit.zoom) / 2, "panX centred when fits");
	ok(fit.panX >= GUTTER, "panX never left of the gutter");
	// worldShownH = 200 * 1.173… ≈ 234.7 < 284 → centred vertically.
	ok(fit.panY === PAD + (visH - PAD * 2 - worldHeight * fit.zoom) / 2, "panY centred when fits");
	ok(fit.panY >= PAD, "panY never above the top pad");
}

// A wide lattice whose horizontal fit would go below the readability floor →
// zoom clamps to MIN_READABLE and X pins to the gutter (does not fit).
{
	const visW = 200;
	const visH = 2000;
	const worldWidth = 100000; // absurdly wide → zoomX tiny
	const worldHeight = 100;
	const fit = latticeFit(worldWidth, worldHeight, visW, visH, GUTTER);
	ok(fit.zoom === MIN_READABLE, "zoom clamps up to the readability floor");
	// worldShownW = 100000 * 0.45 ≫ usableW → pinned to the gutter.
	ok(fit.panX === GUTTER, "panX pinned to the gutter when it overflows");
}

// Degenerate zero-size world → Math.max(1, …) guards keep zoom finite/positive.
{
	const fit = latticeFit(0, 0, 300, 300, GUTTER);
	ok(Number.isFinite(fit.zoom) && fit.zoom > 0, "zero world → finite positive zoom");
	ok(Number.isFinite(fit.panX) && Number.isFinite(fit.panY), "zero world → finite pans");
}
