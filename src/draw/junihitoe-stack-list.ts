// Pure descriptor list for the junihitoe (multi-layer) aggregation stacks drawn
// in MiniGraphView.drawBodyTile(), extracted verbatim from the inline loop so the
// gating + per-group highlight rule live in one testable place (same pattern as
// computeNodeDrawList). The view still owns the actual drawJunihitoeStack calls
// and supplies the live ctx/zoom/minFontPx — this only decides which groups draw
// and the card size / highlight flag each one uses.
//
// Gating (all must hold, else an empty list): showNodes on, at least one group,
// and at least one laid-out node (the card size is read from nodes[0]). A group is
// "high" iff any of its member nodes is in the highlight set.
import type { AggregationGroup } from "../aggregation/types";
import type { PositionedNode } from "../layout/layout";

export interface JunihitoeStackListDeps {
	// MiniGraphView.settings.showNodes
	showNodes: boolean;
	// MiniGraphView.laid.nodes — card size comes from nodes[0].
	nodes: PositionedNode[];
	// MiniGraphView.aggregationState.groups
	groups: Map<string, AggregationGroup>;
	// MiniGraphView.highlightedNodes
	highlightedNodes: Set<string>;
}

export interface JunihitoeStackDescriptor {
	group: AggregationGroup;
	cardW: number;
	cardH: number;
	isHigh: boolean;
}

export function computeJunihitoeStackList(
	deps: JunihitoeStackListDeps,
): JunihitoeStackDescriptor[] {
	if (!deps.showNodes || deps.groups.size === 0 || deps.nodes.length === 0) {
		return [];
	}
	const cardW = deps.nodes[0].width;
	const cardH = deps.nodes[0].height;
	const out: JunihitoeStackDescriptor[] = [];
	for (const group of deps.groups.values()) {
		const isHigh = group.nodeIds.some(id => deps.highlightedNodes.has(id));
		out.push({ group, cardW, cardH, isHigh });
	}
	return out;
}
