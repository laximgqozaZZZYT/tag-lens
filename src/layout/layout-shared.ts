// Shared layout helpers for Euler + UpSet view modes: build a per-card
// idToRect map and the per-card cell-footprint routing obstacles, plus the
// barycenter helper. (The former snapAndBuildRouteData / routeAllEdges
// one-shot pipeline was unused and removed.)
import type { PositionedNode } from "./layout";
import type { RouteObstacle, RouteRect } from "./edge-routing";

// Build an `idToRect` map from the current `(x, y, width, height)` of
// each positioned node. Pure read.
export function buildIdToRect(
	positionedNodes: PositionedNode[],
): Map<string, RouteRect> {
	const m = new Map<string, RouteRect>();
	for (const n of positionedNodes) {
		m.set(n.id, { x: n.x, y: n.y, w: n.width, h: n.height });
	}
	return m;
}

// Derive the per-card cell footprint (= `RouteObstacle[]`) used by
// `routeZ` to steer around cards. Each card reserves
// `ceil(w/slotW) × ceil(h/slotH)` cells centred on its current x/y.
export function buildRouteObstacles(
	positionedNodes: PositionedNode[],
	slotW: number,
	slotH: number,
): RouteObstacle[] {
	const out: RouteObstacle[] = [];
	for (const n of positionedNodes) {
		const cs = Math.max(1, Math.ceil(n.width / slotW));
		const rs = Math.max(1, Math.ceil(n.height / slotH));
		const sc = Math.round(n.x / slotW - cs / 2);
		const sr = Math.round(n.y / slotH - rs / 2);
		out.push({
			id: n.id,
			startCol: sc,
			endCol: sc + cs - 1,
			startRow: sr,
			endRow: sr + rs - 1,
		});
	}
	return out;
}


// Bipartite barycenter seriation. Alternately reorders columns by the mean
// position of their member rows and rows by the mean position of their member
// columns. Bounded iterations, keeps the BEST arrangement by a normalised
// cell-spread cost, and stops early once it stops improving. Works over the
// SPARSE cell list so cost is O(#cells), not O(rows × cols).
//
// Shared by the heatmap layout (tag seriation) — originally written for the
// (now-removed) Connection-matrix layout.
export interface SeriationResult {
	rowOrder: number[];
	colOrder: number[];
}
export function barycenter(
	rowCells: number[][],
	colCells: number[][],
	nRows: number,
	nCols: number,
): SeriationResult {
	const MAX_ITER = 12;
	const rowPos = Array.from({ length: nRows }, (_, i) => i);
	const colPos = Array.from({ length: nCols }, (_, i) => i);
	let bestCost = Infinity;
	let bestRowPos = rowPos.slice();
	let bestColPos = colPos.slice();
	let noImprove = 0;
	const rd = nRows > 1 ? nRows - 1 : 1;
	const cd = nCols > 1 ? nCols - 1 : 1;
	const colIdx = Array.from({ length: nCols }, (_, i) => i);
	const rowIdx = Array.from({ length: nRows }, (_, i) => i);
	// Jaccard / cosine-style inverse-frequency weights. A barycenter is a
	// WEIGHTED mean: a giant tag (large |rows(c)|) or a high-degree note (many
	// tags) contributes LESS, so the ordering follows shared-PATTERN closeness
	// (|A∩B| relative to set sizes) rather than raw co-occurrence counts. This
	// stops big tags (scene 174, talk 30 …) from dragging the layout left.
	const wcol = colCells.map((rs) => 1 / Math.sqrt(rs.length || 1));
	const wrow = rowCells.map((cs) => 1 / Math.sqrt(cs.length || 1));
	for (let it = 0; it < MAX_ITER; it++) {
		// Columns ← weighted mean row position (empty columns sink to the end).
		const colB = colCells.map((rs) => {
			if (!rs.length) return nRows + it;
			let s = 0;
			let w = 0;
			for (const r of rs) {
				s += wrow[r] * rowPos[r];
				w += wrow[r];
			}
			return w ? s / w : nRows + it;
		});
		colIdx.sort((a, b) => colB[a] - colB[b]);
		colIdx.forEach((c, pos) => { (colPos[c] = pos); });
		// Rows ← weighted mean column position.
		const rowB = rowCells.map((cs) => {
			if (!cs.length) return nCols + it;
			let s = 0;
			let w = 0;
			for (const c of cs) {
				s += wcol[c] * colPos[c];
				w += wcol[c];
			}
			return w ? s / w : nCols + it;
		});
		rowIdx.sort((a, b) => rowB[a] - rowB[b]);
		rowIdx.forEach((r, pos) => { (rowPos[r] = pos); });
		// Jaccard-weighted cell-spread cost (lower = tighter diagonal/blocks).
		let cost = 0;
		let wsum = 0;
		for (let r = 0; r < nRows; r++)
			for (const c of rowCells[r]) {
				const wgt = wrow[r] * wcol[c];
				const d = rowPos[r] / rd - colPos[c] / cd;
				cost += wgt * d * d;
				wsum += wgt;
			}
		cost = wsum ? cost / wsum : 0;
		if (cost < bestCost - 1e-9) {
			bestCost = cost;
			bestRowPos = rowPos.slice();
			bestColPos = colPos.slice();
			noImprove = 0;
		} else if (++noImprove >= 2) {
			break;
		}
	}
	const rowOrder = new Array<number>(nRows);
	for (let i = 0; i < nRows; i++) rowOrder[bestRowPos[i]] = i;
	const colOrder = new Array<number>(nCols);
	for (let c = 0; c < nCols; c++) colOrder[bestColPos[c]] = c;
	return { rowOrder, colOrder };
}

