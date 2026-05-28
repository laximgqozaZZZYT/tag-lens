import type { LaidOut, PositionedNode, ClusterRect } from "./layout";
import type { GraphNode, GraphEdge } from "./types";
import {
	nodeFootprint,
	buildCardAABBs,
	cellHitsAnyCard,
	findFreeCell,
} from "./aggregate-util";
import { simpleChannelRoute } from "./edge-routing";

export interface AggregateSnapResult {
	trulyAgg: Set<string>;
	aggregateCount: Map<string, number>;
	aggCenter: Map<string, { x: number; y: number }>;
}

export interface AggregateSnapInput {
	aggregatedLayers: string[];
	hiddenNodes: string[];
	inheritFrom: Record<string, string>;
	// Pre-computed trulyAgg set + ALL data nodes (before any filtering),
	// supplied by the caller. The caller already removed trulyAgg nodes
	// from `laid.nodes` so the layout could repack around them — we look
	// at `allNodes` here to find each badge's member count + a sensible
	// centroid based on the shared membership tags.
	trulyAgg: Set<string>;
	allNodes: GraphNode[];
	allEdges: GraphEdge[];
	clusterLabels: Map<string, string>;
}

const EMPTY_RESULT: AggregateSnapResult = {
	trulyAgg: new Set(),
	aggregateCount: new Map(),
	aggCenter: new Map(),
};

// Run the aggregate-stack snap. MUTATES laid:
//   - cluster.x / y / width / height for every aggregated cluster gets
//     overwritten with the 1-slot box that contains the badge.
//   - Each edge whose source or target is in trulyAgg has its path
//     re-routed to go through the corresponding stack centre instead of
//     the now-hidden card centre.
// Returns the trulyAgg set + per-cluster counts so the renderer can
// honour the same definition of "hidden because aggregated".
export function runAggregateSnap(
	laid: LaidOut,
	input: AggregateSnapInput,
): AggregateSnapResult {
	const aggSet = new Set(input.aggregatedLayers);
	if (aggSet.size === 0) return EMPTY_RESULT;
	const slotW = laid.slotW;
	const slotH = laid.slotH;
	const trulyAgg = input.trulyAgg;
	const aggregateCount = new Map<string, number>();
	const aggCenter = new Map<string, { x: number; y: number }>();

	// Reserve every cell currently holding a visible card — including
	// the FULL footprint of multi-cell (scaled) cards so an aggregate
	// stack never lands inside a giant card like a hub at scale 5x.
	// A truly-aggregated node is hidden, so its cells are free for
	// reuse. User-hidden nodes also free their cells.
	const hiddenSet = new Set(input.hiddenNodes);
	const occupied = new Set<string>();
	for (const n of laid.nodes) {
		if (trulyAgg.has(n.id)) continue;
		if (hiddenSet.has(n.id)) continue;
		const fp = nodeFootprint(n, slotW, slotH);
		for (let c = fp.startCol; c <= fp.endCol; c++) {
			for (let r = fp.startRow; r <= fp.endRow; r++) {
				occupied.add(`${c},${r}`);
			}
		}
	}
	// AABB rectangles of every visible card, used as a second-line
	// verification after the cell-snap spiral.
	const cardAABBs = buildCardAABBs(
		laid.nodes,
		(id) => trulyAgg.has(id) || hiddenSet.has(id),
	);
	const cellHitsCard = (col: number, row: number): boolean =>
		cellHitsAnyCard(col, row, cardAABBs, slotW, slotH);

	// Index trulyAgg members per cluster, computed from the ORIGINAL data
	// (= input.allNodes) since layout was passed only visible nodes and
	// no longer carries the aggregated ones.
	const aggMembersByCluster = new Map<string, GraphNode[]>();
	for (const n of input.allNodes) {
		if (!trulyAgg.has(n.id)) continue;
		for (const m of n.memberships) {
			if (!aggSet.has(m)) continue;
			const arr = aggMembersByCluster.get(m);
			if (arr) arr.push(n);
			else aggMembersByCluster.set(m, [n]);
		}
	}

	// Centroid hint per cluster: average position of the cluster's
	// VISIBLE members (= non-trulyAgg nodes that share the cluster).
	// When the cluster is fully aggregated (no visible members at all),
	// fall back to the rightmost cell of the layout so the badge ends
	// up clearly outside everyone else.
	let maxRightCol = 0;
	let minTopRow = Infinity;
	for (const r of cardAABBs) {
		const rc = Math.ceil(r.right / slotW);
		if (rc > maxRightCol) maxRightCol = rc;
		const tr = Math.floor(r.top / slotH);
		if (tr < minTopRow) minTopRow = tr;
	}
	if (!Number.isFinite(minTopRow)) minTopRow = 0;
	const fallbackCol = maxRightCol + 2;
	let fallbackRow = minTopRow;
	const centroidFor = (
		key: string,
	): { col: number; row: number } => {
		let sx = 0,
			sy = 0,
			n = 0;
		for (const node of laid.nodes) {
			if (!node.memberships.includes(key)) continue;
			sx += node.x;
			sy += node.y;
			n++;
		}
		if (n > 0) {
			return {
				col: Math.floor(sx / n / slotW),
				row: Math.floor(sy / n / slotH),
			};
		}
		return { col: fallbackCol, row: fallbackRow++ };
	};

	// Process clusters in a deterministic order so the spiral search is
	// stable across rebuilds. Iterate the aggSet directly so we cover
	// clusters that no longer have any member in `laid.clusters`.
	const sortedKeys = [...aggMembersByCluster.keys()].sort((a, b) =>
		a.localeCompare(b),
	);
	const clusterByKey = new Map<string, ClusterRect>();
	for (const c of laid.clusters) clusterByKey.set(c.groupKey, c);
	for (const key of sortedKeys) {
		const members = aggMembersByCluster.get(key) ?? [];
		if (members.length === 0) continue;
		const { col: initCol, row: initRow } = centroidFor(key);
		const isBlocked = (c: number, r: number): boolean =>
			occupied.has(`${c},${r}`) || cellHitsCard(c, r);
		let { col, row } = findFreeCell(initCol, initRow, isBlocked);
		if (isBlocked(col, row)) {
			col = fallbackCol;
			row = initRow;
		}
		occupied.add(`${col},${row}`);
		const snapCx = (col + 0.5) * slotW;
		const snapCy = (row + 0.5) * slotH;
		aggCenter.set(key, { x: snapCx, y: snapCy });
		aggregateCount.set(key, members.length);
		let cluster = clusterByKey.get(key);
		if (!cluster) {
			cluster = {
				groupKey: key,
				label: input.clusterLabels.get(key) ?? key,
				x: 0,
				y: 0,
				width: 0,
				height: 0,
				memberCount: members.length,
			};
			laid.clusters.push(cluster);
			clusterByKey.set(key, cluster);
		}
		cluster.x = snapCx - slotW / 2;
		cluster.y = snapCy - slotH / 2;
		cluster.width = slotW;
		cluster.height = slotH;
		cluster.memberCount = members.length;
	}

	// Edge stitching:
	//   - laid.edges already covers visible↔visible edges. Untouched.
	//   - For every edge in the ORIGINAL graph that touches a trulyAgg
	//     node, route it via simpleChannelRoute(visible_end → badge) /
	//     (badge → badge) and append. Self-aggregate (= both endpoints
	//     point to the same badge) is dropped.
	const idToVisibleNode = new Map<string, PositionedNode>();
	for (const n of laid.nodes) idToVisibleNode.set(n.id, n);
	const idToAllNode = new Map<string, GraphNode>();
	for (const n of input.allNodes) idToAllNode.set(n.id, n);
	const aggForId = (id: string): { x: number; y: number } | null => {
		if (!trulyAgg.has(id)) return null;
		const node = idToAllNode.get(id);
		if (!node) return null;
		for (const m of node.memberships) {
			const c = aggCenter.get(m);
			if (c) return c;
		}
		return null;
	};
	const endpointFor = (id: string): { x: number; y: number } | null => {
		const agg = aggForId(id);
		if (agg) return agg;
		const v = idToVisibleNode.get(id);
		if (v) return { x: v.x, y: v.y };
		return null;
	};
	for (const e of input.allEdges) {
		const sAgg = aggForId(e.source);
		const tAgg = aggForId(e.target);
		if (!sAgg && !tAgg) continue; // already in laid.edges
		const startPt = endpointFor(e.source);
		const endPt = endpointFor(e.target);
		if (!startPt || !endPt) continue;
		if (Math.abs(startPt.x - endPt.x) < 0.5 && Math.abs(startPt.y - endPt.y) < 0.5)
			continue;
		laid.edges.push({
			source: e.source,
			target: e.target,
			weight: 1,
			path: simpleChannelRoute(startPt, endPt, slotW, slotH),
			bundled: false,
			bundleCount: 1,
		});
	}

	return { trulyAgg, aggregateCount, aggCenter };
}
