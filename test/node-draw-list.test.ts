import { ok } from "./assert";
import {
	computeNodeDrawList,
	type NodeDrawListDeps,
} from "../src/draw/node-draw-list";
import type { PositionedNode } from "../src/layout/layout";

// Characterization tests for the pure node-card partitioning extracted from
// MiniGraphView.drawBodyTile(). They lock how nodes split across the base vs
// highlighted draw passes so the extraction can't drift from the original two
// inline `for (n of this.laid.nodes)` loops.

function node(id: string): PositionedNode {
	return { id, label: id, memberships: [], x: 0, y: 0, width: 10, height: 10 };
}

function deps(over: Partial<NodeDrawListDeps> = {}): NodeDrawListDeps {
	return {
		nodes: [node("a"), node("b"), node("c")],
		highlightedNodes: new Set(),
		aggregatedNodeIds: new Set(),
		skipNode: () => false,
		...over,
	};
}

const ids = (ns: PositionedNode[]) => ns.map(n => n.id).join(",");

// No highlight → every (non-skipped, non-aggregated) node lands in base.
{
	const { base, highlighted } = computeNodeDrawList(deps());
	ok(ids(base) === "a,b,c", "all nodes base when nothing highlighted");
	ok(highlighted.length === 0, "no highlighted nodes");
}

// Highlight splits the set; order within each pass follows nodes order.
{
	const { base, highlighted } = computeNodeDrawList(
		deps({ highlightedNodes: new Set(["b"]) }),
	);
	ok(ids(base) === "a,c", "non-highlighted go to base");
	ok(ids(highlighted) === "b", "highlighted node goes to highlighted pass");
}

// skipNode drops a node from BOTH passes (it is culled this frame).
{
	const { base, highlighted } = computeNodeDrawList(
		deps({
			highlightedNodes: new Set(["b"]),
			skipNode: id => id === "b" || id === "c",
		}),
	);
	ok(ids(base) === "a", "skipped non-highlighted dropped from base");
	ok(highlighted.length === 0, "skipped highlighted dropped from highlighted");
}

// Aggregated nodes are drawn as stacks, not cards → excluded from both passes.
{
	const { base, highlighted } = computeNodeDrawList(
		deps({
			highlightedNodes: new Set(["c"]),
			aggregatedNodeIds: new Set(["a", "c"]),
		}),
	);
	ok(ids(base) === "b", "aggregated non-highlighted excluded from base");
	ok(highlighted.length === 0, "aggregated highlighted excluded from highlighted");
}
