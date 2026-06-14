// Regression tests for the heatmap/matrix pan clamp. The original bug: the
// clamp computed `labelBand` from a width narrowed by the pinned note menu,
// while draw + hit-test used the FULL canvas width. The two `labelBand` values
// disagreed, so `panX` was clamped to the LEFT of the drawn label band, hiding
// the first column(s) and shifting every cell click off by ≥1 cell (clicking
// the apparent "battle" diagonal opened a different tag's notes).
import { ok, approx } from "./assert";
import { clampSpreadsheetPan } from "../src/spreadsheet-pan";

// Mirror heatmapGeom's labelBand formula for the test.
const labelBandOf = (w: number) => Math.min(380, Math.max(170, w * 0.27));

// --- The fix's core invariant ---------------------------------------------
// When fitToView pins panX to the (full-width) labelBand, clampPan — given the
// SAME full width — must leave panX exactly at labelBand so column 0 starts at
// the visible band edge (not under it).
{
	const fullW = 777;
	const fullH = 600;
	const band = labelBandOf(fullW); // 209.79
	const cellPx = 36;
	const n = 12;
	const grid = n * cellPx; // 432, fits within fullW - band
	const headerH = 92;
	// fitToView sets panX = band; clamp must preserve it.
	const c = clampSpreadsheetPan(band, headerH, band, headerH, grid, grid, fullW, fullH);
	approx(c.panX, band, 1e-6, "panX stays pinned at the full-width labelBand");
	approx(c.panY, headerH, 1e-6, "panY stays pinned at headerH");
	ok(c.panX >= band - 1e-9, "column 0 origin is NOT left of the drawn label band");
}

// --- The bug it prevents: regression guard --------------------------------
// Demonstrate that feeding a PANEL-NARROWED width (the old behaviour) would
// have clamped panX below the true label band, while the full-width clamp keeps
// it correct. Pinned menu = 621px of an 777px canvas (the captured E2E case).
{
	const fullW = 777;
	const fullH = 600;
	const panelW = 621;
	const narrowW = fullW - panelW; // 156
	const trueBand = labelBandOf(fullW); // 209.79 (used by draw + hit-test)
	const narrowBand = labelBandOf(narrowW); // 170 (the OLD buggy value)
	const cellPx = 36;
	const grid = 1 * cellPx;
	const headerH = 92;

	// OLD behaviour (narrow width): panX clamped to 170 — left of the real band.
	const oldClamp = clampSpreadsheetPan(trueBand, headerH, narrowBand, headerH, grid, grid, narrowW, fullH);
	ok(oldClamp.panX < trueBand, "old (panel-narrowed) clamp pushed panX left of the drawn band (the bug)");
	approx(oldClamp.panX, narrowBand, 1e-6, "old clamp pinned panX at the wrong 170px band");

	// NEW behaviour (full width): panX preserved at the real band — no shift.
	const newClamp = clampSpreadsheetPan(trueBand, headerH, trueBand, headerH, grid, grid, fullW, fullH);
	approx(newClamp.panX, trueBand, 1e-6, "new (full-width) clamp keeps panX at the real label band");
	ok(newClamp.panX >= trueBand - 1e-9, "new clamp never hides column 0 under the band");
}

// --- Scrolling a grid wider than the data area still works -----------------
// When the grid overflows, panX must be allowed to go negative-ish (< band) so
// the far columns are reachable, but never further than visW - grid.
{
	const fullW = 600;
	const fullH = 600;
	const band = labelBandOf(fullW);
	const grid = 2000; // much wider than the data area
	const headerH = 92;
	const minPanX = Math.min(band, fullW - grid); // = fullW - grid (negative)
	// Try to over-scroll left: clamp to minPanX.
	const c = clampSpreadsheetPan(-99999, headerH, band, headerH, grid, grid, fullW, fullH);
	approx(c.panX, minPanX, 1e-6, "over-scroll left clamps to fullW - grid");
	// Try to over-scroll right: clamp to band (column 0 pinned).
	const c2 = clampSpreadsheetPan(99999, headerH, band, headerH, grid, grid, fullW, fullH);
	approx(c2.panX, band, 1e-6, "over-scroll right pins column 0 at the band");
}
