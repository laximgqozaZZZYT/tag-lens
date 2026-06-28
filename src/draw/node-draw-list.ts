// Pure partitioning of body-tile node cards into the two draw passes, extracted
// verbatim from MiniGraphView.drawBodyTile() so the skip/highlight rules live in
// one testable place (same pattern as computeEdgeDrawPlan). The view still owns
// the actual drawCard calls (and the junihitoe/aggregate-stack loops drawn
// between the two passes) — this only decides which nodes belong to each pass.
//
// Both passes share the same skip rules (skipNode + aggregated); they differ only
// in which side of the highlight split a node lands on:
//   - base        → not-highlighted nodes (drawn under the accent-edge overlay)
//   - highlighted  → highlighted nodes (drawn on top, after accent edges)
import type { PositionedNode } from "../layout/layout";

export interface NodeDrawListDeps {
	nodes: PositionedNode[];
	// MiniGraphView.highlightedNodes
	highlightedNodes: Set<string>;
	// MiniGraphView.aggregationState.aggregatedNodeIds
	aggregatedNodeIds: Set<string>;
	// MiniGraphView's per-frame node skip predicate (world-map tiling / culling).
	skipNode: (id: string) => boolean;
}

export interface NodeDrawList {
	base: PositionedNode[];
	highlighted: PositionedNode[];
}

export function computeNodeDrawList(deps: NodeDrawListDeps): NodeDrawList {
	const base: PositionedNode[] = [];
	const highlighted: PositionedNode[] = [];
	for (const n of deps.nodes) {
		if (deps.skipNode(n.id)) continue;
		if (deps.aggregatedNodeIds.has(n.id)) continue;
		if (deps.highlightedNodes.has(n.id)) highlighted.push(n);
		else base.push(n);
	}
	return { base, highlighted };
}
