// Pure pan-clamp math for the screen-space frozen-pane grids (connection
// matrix + co-occurrence heatmap). Extracted so the off-by-one click bug it
// fixes can be regression-tested without the DOM-heavy view.
//
// The grids are drawn AND hit-tested across the FULL canvas width — the pinned
// note menu is an overlay, it does not narrow the canvas. The clamp therefore
// MUST use the same full width; feeding a panel-narrowed width here yields a
// smaller `labelBand`, clamps `panX` to the left of the drawn label band, hides
// the first column(s), and shifts every cell click off by ≥1 cell.

export interface SpreadsheetClamp {
	panX: number;
	panY: number;
}

// Clamp a spreadsheet pan so column/row 0 never scrolls right of the frozen
// label band, and the far edge never reveals empty space past the grid.
//   labelBand / headerH : frozen-pane sizes (computed from the FULL width)
//   gridW / gridH       : total scrollable extent (cols*pitch, rows*pitch)
//   fullW / fullH       : the canvas dimensions the draw + hit-test use
export function clampSpreadsheetPan(
	panX: number,
	panY: number,
	labelBand: number,
	headerH: number,
	gridW: number,
	gridH: number,
	fullW: number,
	fullH: number,
): SpreadsheetClamp {
	const minPanX = Math.min(labelBand, fullW - gridW);
	const minPanY = Math.min(headerH, fullH - gridH);
	return {
		panX: Math.min(labelBand, Math.max(minPanX, panX)),
		panY: Math.min(headerH, Math.max(minPanY, panY)),
	};
}
