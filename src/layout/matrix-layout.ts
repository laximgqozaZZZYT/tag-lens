// Connection-matrix layout. Rows = filtered notes (GraphNode), columns =
// unique membership values (tags) kept above `matrixMinColumnSize`. Each
// note's full membership lands on its single row, so high-multiplicity notes
// need no overview/detail split. Optional barycenter seriation surfaces
// co-occurrence blocks. Membership is stored as a packed per-row bitset.
import { GraphData } from "../types";
import type { LaidOut, LayoutOptions, MatrixMeta } from "./layout";
import { computeChannelDims, minFontScale } from "./card-sizing";

const ROW_H = 22; // world units (px at zoom 1)
const COL_W = 16;

export function layoutMatrix(data: GraphData, opts: LayoutOptions): LaidOut {
	const labels = opts.clusterLabels ?? new Map<string, string>();
	const minColSize = Math.max(1, opts.matrixMinColumnSize ?? 1);
	const { channelW, channelH } = computeChannelDims(
		opts.nodeSpacing,
		minFontScale(opts.minFontPx ?? 0),
	);
	const slotW = (opts.cellW > 0 ? opts.cellW : 80) + channelW;
	const slotH = (opts.cellH > 0 ? opts.cellH : 24) + channelH;

	// Columns: unique tags with member count ≥ minColSize. Initial order by
	// count desc (stable, alphabetical tiebreak).
	const colCount = new Map<string, number>();
	for (const n of data.nodes)
		for (const m of n.memberships)
			colCount.set(m, (colCount.get(m) ?? 0) + 1);
	const colKeys = [...colCount.keys()]
		.filter((k) => (colCount.get(k) ?? 0) >= minColSize)
		.sort((a, b) => (colCount.get(b)! - colCount.get(a)!) || (a < b ? -1 : 1));
	const colIndex = new Map<string, number>();
	colKeys.forEach((k, i) => colIndex.set(k, i));
	const nCols = colKeys.length;

	const rows = data.nodes.map((n) => ({ id: n.id, label: n.label }));
	const nRows = rows.length;

	// Sparse adjacency for seriation + bit packing.
	const rowCells: number[][] = rows.map(() => []);
	const colCells: number[][] = colKeys.map(() => []);
	data.nodes.forEach((n, r) => {
		for (const m of n.memberships) {
			const c = colIndex.get(m);
			if (c === undefined) continue;
			rowCells[r].push(c);
			colCells[c].push(r);
		}
	});

	let rowOrder = rows.map((_, i) => i);
	let colOrder = colKeys.map((_, i) => i);
	if (opts.matrixSort === "cooccurrence" && nRows > 1 && nCols > 1) {
		const res = barycenter(rowCells, colCells, nRows, nCols);
		rowOrder = res.rowOrder;
		colOrder = res.colOrder;
		// Ubiquitous tags (on > 25% of notes) appear in almost every row, so
		// their column is a solid vertical band that masks the diagonal. Park
		// them at the RIGHT edge (size desc) so the specific tags keep their
		// barycenter order and form a clean diagonal in the main area.
		const ubiqThresh = nRows * 0.25;
		const specific = colOrder.filter(
			(c) => (colCount.get(colKeys[c]) ?? 0) < ubiqThresh,
		);
		const ubiq = colOrder
			.filter((c) => (colCount.get(colKeys[c]) ?? 0) >= ubiqThresh)
			.sort((a, b) => (colCount.get(colKeys[b])! - colCount.get(colKeys[a])!));
		colOrder = [...specific, ...ubiq];

		// Block-priority row ordering. The Jaccard pass already places
		// same-signature rows adjacent; here we treat each signature as ONE
		// block and order the blocks by SIZE (direction = ORDER_BY asc/desc:
		// desc = biggest blocks first, the default), keeping each block
		// contiguous. Big blocks (×12 …) rise to the top instead of being
		// scattered by singleton rows — the "count overview" — without breaking
		// co-occurrence (columns stay Jaccard-ordered) or the grouping.
		const dir = opts.matrixSortDir ?? "desc";
		if ((opts.matrixBlockPriority ?? false) && nRows > 1) {
			const sigKey = (orig: number): string =>
				rowCells[orig]
					.slice()
					.sort((a, b) => a - b)
					.join(",");
			const seen = new Map<string, number>();
			const groups: Array<{ rows: number[]; rank: number }> = [];
			rowOrder.forEach((orig, jaccardRank) => {
				const k = sigKey(orig);
				let gi = seen.get(k);
				if (gi === undefined) {
					gi = groups.length;
					seen.set(k, gi);
					groups.push({ rows: [], rank: jaccardRank });
				}
				groups[gi].rows.push(orig);
			});
			const sgn = dir === "asc" ? -1 : 1;
			groups.sort((a, b) => sgn * (b.rows.length - a.rows.length) || a.rank - b.rank);
			rowOrder = groups.flatMap((g) => g.rows);
		} else if (dir === "desc") {
			// Pure co-occurrence: desc reverses the seriation order.
			rowOrder = rowOrder.slice().reverse();
		}
	}

	// New column position for each original column index.
	const colNewPos = new Array<number>(nCols);
	colOrder.forEach((c, pos) => (colNewPos[c] = pos));

	const cols = colOrder.map((c) => ({
		key: colKeys[c],
		label: labels.get(colKeys[c]) ?? colKeys[c],
		size: colCount.get(colKeys[c]) ?? 0,
	}));
	const rowsOut = rowOrder.map((i) => rows[i]);

	const bytesPerRow = Math.max(1, Math.ceil(nCols / 8));
	const bits: Uint8Array[] = [];
	for (const i of rowOrder) {
		const b = new Uint8Array(bytesPerRow);
		for (const c of rowCells[i]) {
			const pos = colNewPos[c];
			b[pos >> 3] |= 1 << (pos & 7);
		}
		bits.push(b);
	}

	// Bundle consecutive rows with identical signatures (same bits) into
	// blocks. After co-occurrence seriation, same-signature notes sit
	// adjacent, so these runs are the "UpSet column" groups.
	const blocks: Array<{ start: number; count: number }> = [];
	const sameBits = (a: Uint8Array, b: Uint8Array): boolean => {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
		return true;
	};
	for (let r = 0; r < bits.length; ) {
		let e = r + 1;
		while (e < bits.length && sameBits(bits[e], bits[r])) e++;
		blocks.push({ start: r, count: e - r });
		r = e;
	}

	const matrix: MatrixMeta = {
		rows: rowsOut,
		cols,
		bits,
		rowH: ROW_H,
		colW: COL_W,
		blocks,
	};
	return {
		nodes: [],
		edges: [],
		clusters: [],
		trunks: [],
		slotW,
		slotH,
		channelW,
		channelH,
		matrix,
	};
}

// Bipartite barycenter seriation. Alternately reorders columns by the mean
// position of their member rows and rows by the mean position of their member
// columns. Bounded iterations, keeps the BEST arrangement by a normalised
// cell-spread cost, and stops early once it stops improving. Works over the
// SPARSE cell list so cost is O(#cells), not O(rows × cols).
export interface SeriationResult {
	rowOrder: number[];
	colOrder: number[];
}
// Exported for reuse by the heatmap layout (tag seriation). Behaviour is
// unchanged for the matrix — this is an export-visibility addition only.
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
		colIdx.forEach((c, pos) => (colPos[c] = pos));
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
		rowIdx.forEach((r, pos) => (rowPos[r] = pos));
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
