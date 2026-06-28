// Pure descriptor list for the aggregate (collapsed-cluster) stacks drawn in
// MiniGraphView.drawBodyTile(), extracted verbatim from the inline loop so the
// gating + per-cluster count/highlight rules live in one testable place (same
// pattern as computeJunihitoeStackList). The view still owns the actual
// drawAggregateStack calls and supplies the live ctx/zoom/minFontPx — this only
// decides which clusters draw and the card size / count / highlight flag each
// one uses.
//
// Gating (all must hold, else an empty list): showNodes on, at least one
// aggregate count, and at least one laid-out node (the card size is read from
// nodes[0]). A cluster is skipped when its aggregate count is falsy, and is
// "high" iff its groupKey is in the highlighted-clusters set.
import type { ClusterRect, PositionedNode } from "../layout/layout";

export interface AggregateStackListDeps {
	// MiniGraphView.settings.showNodes
	showNodes: boolean;
	// MiniGraphView.laid.nodes — card size comes from nodes[0].
	nodes: PositionedNode[];
	// MiniGraphView.laid.clusters
	clusters: ClusterRect[];
	// MiniGraphView.aggregateCount (groupKey → collapsed node count)
	aggregateCount: Map<string, number>;
	// MiniGraphView.highlightedClusters
	highlightedClusters: Set<string>;
}

export interface AggregateStackDescriptor {
	cluster: ClusterRect;
	cardW: number;
	cardH: number;
	count: number;
	isHigh: boolean;
}

export function computeAggregateStackList(
	deps: AggregateStackListDeps,
): AggregateStackDescriptor[] {
	if (
		!deps.showNodes ||
		deps.aggregateCount.size === 0 ||
		deps.nodes.length === 0
	) {
		return [];
	}
	const cardW = deps.nodes[0].width;
	const cardH = deps.nodes[0].height;
	const out: AggregateStackDescriptor[] = [];
	for (const cluster of deps.clusters) {
		const count = deps.aggregateCount.get(cluster.groupKey);
		if (!count) continue;
		const isHigh = deps.highlightedClusters.has(cluster.groupKey);
		out.push({ cluster, cardW, cardH, count, isHigh });
	}
	return out;
}
