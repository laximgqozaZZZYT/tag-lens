import type { GraphData, GraphEdge, GraphNode, MiniSettings } from "../types";
import { computeParentOf, computeTrulyAgg } from "../layout/aggregate-util";
import { nodeIsHidden } from "../interaction/note-menu";

// rebuild()'s data flow happens in 5 named stages. Each stage is a pure
// function with explicit inputs / outputs so the path from raw vault →
// laid-out scene can be traced one step at a time. Bug-fix anchor: when
// "unrelated nodes appear in a cluster" (#3) or "cluster members spread
// abnormally far" (#1), the fault must live in EXACTLY one of these
// stages — the data passing between them is observable.

// Stage 1 (SQL Query) has been removed as Tag Lens now exclusively uses Bases.

// ────────────────────────────────────────────────────────────────────
// Stage 2: degree maps
// ────────────────────────────────────────────────────────────────────
// Total degree drives the "degree" ORDER_BY field; directional in/out
// degree drives indegree / outdegree nodeSizeMode. Computed once per
// rebuild so the resolvers (ORDER_BY, cardFor) can do O(1) lookups.
export interface DegreeMaps {
	degreeMap: Map<string, number>;
	inDegreeMap: Map<string, number>;
	outDegreeMap: Map<string, number>;
}

export function computeDegreeMaps(edges: GraphEdge[]): DegreeMaps {
	const degreeMap = new Map<string, number>();
	const inDegreeMap = new Map<string, number>();
	const outDegreeMap = new Map<string, number>();
	for (const e of edges) {
		degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
		degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
		outDegreeMap.set(e.source, (outDegreeMap.get(e.source) ?? 0) + 1);
		inDegreeMap.set(e.target, (inDegreeMap.get(e.target) ?? 0) + 1);
	}
	return { degreeMap, inDegreeMap, outDegreeMap };
}

// ────────────────────────────────────────────────────────────────────
// Stage 3: edge re-filter after a node-set shrink
// ────────────────────────────────────────────────────────────────────
// Reused by LIMIT and by layout-exclusion. Drops every edge whose
// source OR target is filtered out. Uses a predicate instead of a
// Set so callers can pass a Map (`displayMode.has(id)`) directly
// without wrapping it in `new Set(modes.keys())`.
export function filterEdgesByAlive(
	edges: GraphEdge[],
	isAlive: (id: string) => boolean,
): GraphEdge[] {
	return edges.filter((e) => isAlive(e.source) && isAlive(e.target));
}

// ────────────────────────────────────────────────────────────────────
// Stage 4: pre-layout exclusion (aggregated + hidden nodes)
// ────────────────────────────────────────────────────────────────────
// Aggregated and hidden nodes MUST be removed before layout so the
// cluster pack only allocates physical space for visibly-rendered
// cards. Otherwise: a settings change that flips aggregation /
// visibility leaves surrounding nodes pinned at their pre-flip
// positions — the exact bug previously reported.
//
// Returns the layout-ready data PLUS the trulyAgg set (needed
// downstream by drawing and by aggregate-snap to know which IDs were
// folded). `data` is the post-LIMIT graph.
export interface PreLayoutFilter {
	layoutData: GraphData;
	preTrulyAgg: Set<string>;
}

export function filterLayoutData(
	data: GraphData,
	settings: MiniSettings,
): PreLayoutFilter {
	const preAggSet = new Set(settings.aggregatedLayers);
	const allClusterKeys = [
		...new Set(data.nodes.flatMap((n) => n.memberships)),
	];
	const preParentOf = computeParentOf(
		allClusterKeys,
		data.nodes,
		settings.inheritFrom ?? {},
	);
	const preTrulyAgg = computeTrulyAgg(data.nodes, preAggSet, preParentOf);
	// Match hiddenNodes entries as PATH-OR-ID (nodeIsHidden): a single path entry
	// (the navigator checkboxes) hides every `${tag}\t${path}` Euler/bubbles copy;
	// a raw-id entry (legacy per-card panel) still hides exactly that card.
	const hiddenSet = new Set(settings.hiddenNodes);
	const layoutNodes = data.nodes.filter(
		(n) => !preTrulyAgg.has(n.id) && !nodeIsHidden(n.id, hiddenSet),
	);
	const layoutAlive = new Set(layoutNodes.map((n) => n.id));
	const layoutEdges = filterEdgesByAlive(data.edges, (id) =>
		layoutAlive.has(id),
	);
	return {
		layoutData: { nodes: layoutNodes, edges: layoutEdges },
		preTrulyAgg,
	};
}

// ────────────────────────────────────────────────────────────────────
// Stage 5: adjacency index
// ────────────────────────────────────────────────────────────────────
// id → edge-index list. Used by hover / highlight to find every edge
// touching a given node in O(degree) instead of O(|edges|).
export function buildAdjacency(
	edges: GraphEdge[],
): Map<string, number[]> {
	const adj = new Map<string, number[]>();
	edges.forEach((e, i) => {
		const sa = adj.get(e.source);
		if (sa) sa.push(i);
		else adj.set(e.source, [i]);
		const ta = adj.get(e.target);
		if (ta) ta.push(i);
		else adj.set(e.target, [i]);
	});
	return adj;
}

// Re-export GraphNode so view.ts can import the pipeline + node type
// together without two import lines.
export type { GraphNode };
