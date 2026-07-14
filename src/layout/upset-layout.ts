// UpSet plot layout.
//
// Two coexisting visual layers:
//   - MAIN area (world space): card stacks — one card per node, stacked
//     vertically inside each intersection column. Every element is
//     individually visible.
//   - FOOTER (screen space, rendered by draw-upset.ts): dot matrix +
//     bars + labels. Always readable; tracks the cards horizontally
//     via the current pan/zoom transform.
//
// The matrix column's `xWorld` and the card column's x are the same
// number — that's what keeps "this column's stack" and "this column's
// dots" visually under each other at every zoom.
import type { GraphData } from "../types";
import type {
	LaidOut,
	PositionedNode,
	PositionedEdge,
	UpsetMeta,
} from "./layout";
import { computeChannelDims, minFontScale } from "./card-sizing";
import { snapCardsToGrid } from "./cell-snap";
import {
	LaneRegistry,
	aggregateEdges,
	routeZ,
	type RouteObstacle,
	type RouteRect,
} from "./edge-routing";

export interface UpsetLayoutOptions {
	cellW: number;
	cellH: number;
	nodeSpacing: number;
	// Min font size (px) → scales the 隘路 in step with cellW/cellH so the
	// UpSet grid stays proportional to the font floor. Omitted ⇒ scale 1.
	minFontPx?: number;
	clusterLabels: Map<string, string>;
	columnSort?: "size" | "degree";
	minColumnSize?: number;
}

interface Sized {
	id: string;
	width: number;
	height: number;
}

// Stable identity key for an UpSet intersection column, derived from its
// (sorted) tag signature. The "|" separator avoids the {ab,c}/{a,bc}
// collision a naive `.join("")` would produce. This is the single source of
// truth for the key contract: the bucketing pass here, the draw-upset
// highlight match, and the view's stale-selection guard all go through it, so
// a selected column can be re-found (or dropped) verbatim after a relayout.
export function upsetColumnKey(signature: string[]): string {
	return signature.join("|");
}

export function layoutUpset(
	data: GraphData,
	sized: Sized[],
	opts: UpsetLayoutOptions,
): LaidOut {
	// --- 1. Set sizes (rows). HAVING already filtered upstream.
	const setSizes = new Map<string, number>();
	for (const n of data.nodes) {
		for (const m of n.memberships) {
			setSizes.set(m, (setSizes.get(m) ?? 0) + 1);
		}
	}
	const setKeys = [...setSizes.keys()].sort((a, b) => {
		const da = setSizes.get(b)! - setSizes.get(a)!;
		return da !== 0 ? da : a.localeCompare(b);
	});

	// --- 2. Signature buckets — "|" separator avoids the {ab,c}/{a,bc}
	// collision the naive `.join("")` would produce.
	const sigToBucket = new Map<
		string,
		{ signature: string[]; nodeIds: string[] }
	>();
	for (const n of data.nodes) {
		if (n.memberships.length === 0) continue;
		const sorted = [...n.memberships].sort();
		const key = upsetColumnKey(sorted);
		const entry = sigToBucket.get(key);
		if (entry) entry.nodeIds.push(n.id);
		else sigToBucket.set(key, { signature: sorted, nodeIds: [n.id] });
	}

	// --- 3. Min-size cull.
	const minSize = Math.max(1, opts.minColumnSize ?? 1);
	const buckets = [...sigToBucket.values()].filter(
		(b) => b.nodeIds.length >= minSize,
	);

	// --- 4. Sort columns by `columnSort` setting.
	const sortMode = opts.columnSort ?? "size";
	buckets.sort((a, b) => {
		if (sortMode === "degree") {
			if (a.signature.length !== b.signature.length)
				return a.signature.length - b.signature.length;
			if (b.nodeIds.length !== a.nodeIds.length)
				return b.nodeIds.length - a.nodeIds.length;
		} else {
			if (b.nodeIds.length !== a.nodeIds.length)
				return b.nodeIds.length - a.nodeIds.length;
			if (a.signature.length !== b.signature.length)
				return a.signature.length - b.signature.length;
		}
		return a.signature.join().localeCompare(b.signature.join());
	});

	// Stable per-column node order (by id) so the same intersection
	// always lists the same files in the same order — important for
	// the detail panel + reproducible rendering.
	for (const bucket of buckets) {
		bucket.nodeIds.sort((a, b) => a.localeCompare(b));
	}

	// --- 5. Card geometry on a UNIFORM one-cell lattice. The lattice
	// pitch (`slotW × slotH`) is ALWAYS one canonical Euler cell — never
	// the max observed card — so a default 1×1 NODE_DISPLAY card fills
	// exactly one grid 区画 (the cell framed by the row + column 隘路).
	//
	// Size-scaled cards (indegree / outdegree → up to 4×, i.e. 2×2 cells)
	// are NOT shrunk to one cell; instead each card occupies the integer
	// number of cells it spans, and a column reserves as many lattice
	// columns as its widest card needs (`§6`). That way the lattice stays
	// uniform (so `drawCardGrid` / footer math are unchanged) AND a wide
	// card pushes the next Pareto bar to the right rather than overlapping
	// it. Earlier `max(observed)` slot inflation was the bug that left
	// 1×1 defaults tiny inside over-sized cells — avoided here.
	const cardW = opts.cellW > 0 ? opts.cellW : 80;
	const cardH = opts.cellH > 0 ? opts.cellH : 24;
	// Row + column channels via the SAME helper Euler uses, scaled by the
	// SAME minFontScale, so the slot pitch (= cardW + channelW) equals one
	// Euler grid cell pitch and the whole grid (cell + 隘路 + card) grows
	// proportionally with the Min font size in both views.
	const { channelW, channelH } = computeChannelDims(
		opts.nodeSpacing,
		minFontScale(opts.minFontPx ?? 0),
	);
	const slotW = cardW + channelW;
	const slotH = cardH + channelH;

	// Per-node footprint. `sized[].width/height` carry the (possibly
	// scaled) pixel size; `cols/rows` = how many one-cell slots that
	// spans. Because `cardFor` and this layout share the same channel +
	// cell pitch, `(w + channelW) / slotW` is the exact integer cell
	// count (= `effC` from computeCardSize), so `round` is lossless.
	const sizedById = new Map<string, Sized>();
	for (const s of sized) sizedById.set(s.id, s);
	const footprint = (id: string): { w: number; h: number; cols: number; rows: number } => {
		const s = sizedById.get(id);
		const w = s?.width ?? cardW;
		const h = s?.height ?? cardH;
		return {
			w,
			h,
			cols: Math.max(1, Math.round((w + channelW) / slotW)),
			rows: Math.max(1, Math.round((h + channelH) / slotH)),
		};
	};

	// Bottom baseline is shared across columns at `totalRows` cells down,
	// so every Pareto bar grows up from the same line. `totalRows` = the
	// tallest column measured in CELLS (summing each card's row span).
	let totalRows = 1;
	for (const b of buckets) {
		let sum = 0;
		for (const id of b.nodeIds) sum += footprint(id).rows;
		if (sum > totalRows) totalRows = sum;
	}

	// --- 6. Place cards on the cell lattice. Columns flow left→right
	// behind a running `cellCursor` (in cell units). Each column reserves
	// `widthCells` = its widest card's column span, so a 2×2 card forces
	// its column 2 cells wide and the NEXT bar starts 2 cells over — the
	// right-adjacent Pareto bar keeps its distance instead of overlapping.
	// `xWorld` (the column centre) drives the footer dot-matrix + count
	// labels, so they inherit the same variable spacing automatically.
	//
	// All coords land on integer cell boundaries matching each card's own
	// span, so the post-placement `snapCardsToGrid` is a no-op (no spiral
	// re-packing that would scramble the Pareto order).
	const positionedNodes: PositionedNode[] = [];
	let cellCursor = 0;
	const columns: UpsetMeta["columns"] = buckets.map((bucket) => {
		let widthCells = 1;
		for (const id of bucket.nodeIds) {
			widthCells = Math.max(widthCells, footprint(id).cols);
		}
		const colStart = cellCursor;
		const xWorld = (colStart + widthCells / 2) * slotW;
		// Bottom-up Pareto stack, counting CELLS so multi-row cards
		// reserve their full height. `cumRows` = cells already consumed
		// from the shared bottom baseline (`totalRows`).
		let cumRows = 0;
		for (let j = 0; j < bucket.nodeIds.length; j++) {
			const id = bucket.nodeIds[j];
			const node = data.nodes.find((n) => n.id === id);
			if (!node) continue;
			const fp = footprint(id);
			const topCell = totalRows - cumRows - fp.rows;
			cumRows += fp.rows;
			const yCentre = (topCell + fp.rows / 2) * slotH;
			// Centre the card within its column's cell span (left-biased
			// when the parity doesn't divide evenly) so a narrow card in a
			// wide column sits under the bar rather than flush-left.
			const leftCell = colStart + Math.floor((widthCells - fp.cols) / 2);
			const xCentre = (leftCell + fp.cols / 2) * slotW;
			positionedNodes.push({
				...node,
				x: xCentre,
				y: yCentre,
				width: fp.w,
				height: fp.h,
			} as PositionedNode);
		}
		cellCursor += widthCells;
		return {
			signature: bucket.signature,
			nodeIds: bucket.nodeIds,
			size: bucket.nodeIds.length,
			xWorld,
		};
	});

	const cardsWorldWidth = cellCursor * slotW;
	const cardsWorldHeight = totalRows * slotH;

	const sets: UpsetMeta["sets"] = setKeys.map((key) => ({
		key,
		label: opts.clusterLabels.get(key) ?? key,
		size: setSizes.get(key) ?? 0,
	}));

	// Post-placement: snap, build routing data, route edges.
	// INTENTIONALLY DUPLICATED from `layout-shared.ts` (per user
	// spec) so UpSet's pipeline can evolve independently of Euler's
	// — no implicit coupling through a shared helper.
	const idToRect = new Map<string, RouteRect>();
	for (const n of positionedNodes) {
		idToRect.set(n.id, { x: n.x, y: n.y, w: n.width, h: n.height });
	}
	snapCardsToGrid(positionedNodes, slotW, slotH, idToRect);
	const routeObstacles: RouteObstacle[] = [];
	for (const n of positionedNodes) {
		const cs = Math.max(1, Math.ceil(n.width / slotW));
		const rs = Math.max(1, Math.ceil(n.height / slotH));
		const sc = Math.round(n.x / slotW - cs / 2);
		const sr = Math.round(n.y / slotH - rs / 2);
		routeObstacles.push({
			id: n.id,
			startCol: sc,
			endCol: sc + cs - 1,
			startRow: sr,
			endRow: sr + rs - 1,
		});
	}
	const aggregated = aggregateEdges(data.edges, idToRect);
	const lanes = new LaneRegistry();
	const edges: PositionedEdge[] = [];
	for (const e of aggregated) {
		const a = idToRect.get(e.source);
		const b = idToRect.get(e.target);
		if (!a || !b) continue;
		edges.push({
			source: e.source,
			target: e.target,
			weight: e.weight,
			path: routeZ(
				a,
				b,
				lanes,
				slotW,
				slotH,
				channelW,
				channelH,
				routeObstacles,
				e.source,
				e.target,
			),
			bundled: false,
			bundleCount: 1,
		});
	}

	return {
		nodes: positionedNodes,
		edges,
		clusters: [],
		trunks: [],
		slotW,
		slotH,
		channelW,
		channelH,
		upset: {
			sets,
			columns,
			// Cards now span world x = 0 .. numCols*slotW (no leftPad
			// margin) because the placement is on cell centres.
			cardsWorldWidth,
			cardsWorldHeight,
			cardSlotW: slotW,
			cardSlotH: slotH,
		},
	};
}
