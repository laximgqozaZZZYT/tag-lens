import type { GraphEdge } from "./types";
import type { PositionedNode } from "./layout";
import type { HoverTarget } from "./hit-test";

// Tooltip lifecycle constants. 350 ms is the longest delay that still
// feels intentional; below ~200 ms tooltips appear during ordinary
// mouse drift. Offsets push the tooltip down-right of the cursor by
// default and flip to up-left when it would overflow the canvas edge.
export const HOVER_DELAY_MS = 350;
export const TOOLTIP_OFFSET_X = 14;
export const TOOLTIP_OFFSET_Y = -8;

// Equality check on a HoverTarget. Two targets are "the same" when
// they refer to the same node id OR the same cluster groupKey. Used to
// skip re-renders when the mouse moves but the underlying target is
// unchanged.
export function sameTarget(a: HoverTarget, b: HoverTarget): boolean {
	if (a === null || b === null) return a === b;
	if (a.kind !== b.kind) return false;
	if (a.kind === "cluster" && b.kind === "cluster")
		return a.group === b.group;
	if (a.kind === "node" && b.kind === "node") return a.nodeId === b.nodeId;
	if (a.kind === "matrixCol" && b.kind === "matrixCol") return a.col === b.col;
	if (a.kind === "heatmapCell" && b.kind === "heatmapCell")
		return a.i === b.i && a.j === b.j;
	return false;
}

// Output of `computeHighlight`. All four sets are written together
// because the renderer reads them as one snapshot — splitting their
// computation would leave a window where the highlighted node has been
// added but its cluster hasn't.
export interface HighlightState {
	highlightedNodes: Set<string>;
	highlightedClusters: Set<string>;
	highlightedEdgeIdx: Set<number>;
	hoveredNodeId: string | null;
}

export function emptyHighlight(): HighlightState {
	return {
		highlightedNodes: new Set(),
		highlightedClusters: new Set(),
		highlightedEdgeIdx: new Set(),
		hoveredNodeId: null,
	};
}

// Pure highlight computation: for a node-kind hover target, produce
// (a) the node itself + all directly-adjacent nodes, (b) every
// membership of any highlighted node (= the clusters that should glow),
// and (c) the edge indices that connect any pair of highlighted nodes.
//
// Cluster-kind and null targets yield empty highlights — the cluster
// itself isn't highlighted on hover (the enclosure tab does that).
//
// Bug-fix anchor: when "wrong clusters glow" or "stray edges
// highlight" recur, the entire decision lives here in one function;
// the renderer just reads the produced sets.
export function computeHighlight(
	target: HoverTarget,
	nodes: PositionedNode[],
	edges: GraphEdge[],
	adjacency: Map<string, number[]>,
): HighlightState {
	const state = emptyHighlight();
	if (!target || target.kind !== "node") return state;

	const id = target.nodeId;
	state.hoveredNodeId = id;
	state.highlightedNodes.add(id);

	// Build an id → node index ONCE so the membership lookup for each
	// adjacent node stays O(1) instead of O(|nodes|).
	const idIndex = new Map<string, PositionedNode>();
	for (const n of nodes) idIndex.set(n.id, n);

	const targetNode = idIndex.get(id);
	if (targetNode) {
		for (const m of targetNode.memberships) {
			state.highlightedClusters.add(m);
		}
	}
	const adj = adjacency.get(id);
	if (!adj) return state;

	for (const i of adj) {
		state.highlightedEdgeIdx.add(i);
		const edge = edges[i];
		if (!edge) continue;
		const otherId = edge.source === id ? edge.target : edge.source;
		state.highlightedNodes.add(otherId);
		const otherNode = idIndex.get(otherId);
		if (!otherNode) continue;
		for (const m of otherNode.memberships) {
			state.highlightedClusters.add(m);
		}
	}
	return state;
}

// Pure tooltip-positioning math: place at (sx + offX, sy + offY); if
// the tip would overflow the right edge, mirror to the left; clamp
// vertically inside [4, canvasH − tipH − 4].
//
// Returns the absolute (left, top) in canvas-relative pixels. The
// caller is responsible for writing them onto the DOM element.
export function positionTip(
	sx: number,
	sy: number,
	tipW: number,
	tipH: number,
	canvasW: number,
	canvasH: number,
): { x: number; y: number } {
	let x = sx + TOOLTIP_OFFSET_X;
	let y = sy + TOOLTIP_OFFSET_Y;
	if (x + tipW > canvasW) x = sx - tipW - TOOLTIP_OFFSET_X;
	if (y + tipH > canvasH) y = canvasH - tipH - 4;
	if (y < 4) y = 4;
	return { x, y };
}
