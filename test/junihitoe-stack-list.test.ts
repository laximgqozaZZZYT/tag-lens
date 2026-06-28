import { ok } from "./assert";
import {
	computeJunihitoeStackList,
	type JunihitoeStackListDeps,
} from "../src/draw/junihitoe-stack-list";
import type { AggregationGroup } from "../src/aggregation/types";
import type { PositionedNode } from "../src/layout/layout";

// Characterization tests for the pure junihitoe stack-descriptor list extracted
// from MiniGraphView.drawBodyTile(). They lock the gating (showNodes / non-empty
// groups / non-empty nodes), the card size source (nodes[0]) and the per-group
// "high iff any member highlighted" rule so the extraction can't drift from the
// original inline loop.

function node(id: string, width = 12, height = 8): PositionedNode {
	return { id, label: id, memberships: [], x: 0, y: 0, width, height };
}

function group(key: string, nodeIds: string[]): AggregationGroup {
	return {
		key,
		setKey: "s",
		nodeIds,
		attributeValue: key,
		x: 0,
		y: 0,
		width: 1,
		height: 1,
		representativeNode: node(nodeIds[0] ?? key),
	};
}

function deps(over: Partial<JunihitoeStackListDeps> = {}): JunihitoeStackListDeps {
	const groups = new Map<string, AggregationGroup>([
		["g1", group("g1", ["a", "b"])],
		["g2", group("g2", ["c"])],
	]);
	return {
		showNodes: true,
		nodes: [node("a"), node("b"), node("c")],
		groups,
		highlightedNodes: new Set(),
		...over,
	};
}

// Card size comes from nodes[0]; every group emits one descriptor in map order.
{
	const list = computeJunihitoeStackList(deps());
	ok(list.length === 2, "one descriptor per group");
	ok(list[0].group.key === "g1" && list[1].group.key === "g2", "map order kept");
	ok(list[0].cardW === 12 && list[0].cardH === 8, "card size read from nodes[0]");
	ok(!list[0].isHigh && !list[1].isHigh, "no highlight → all low");
}

// A group is high iff ANY member node is highlighted.
{
	const list = computeJunihitoeStackList(
		deps({ highlightedNodes: new Set(["b"]) }),
	);
	ok(list[0].isHigh, "g1 high because member b is highlighted");
	ok(!list[1].isHigh, "g2 low — no member highlighted");
}

// Gating: showNodes off, no groups, or no nodes → empty list.
{
	ok(
		computeJunihitoeStackList(deps({ showNodes: false })).length === 0,
		"showNodes off → empty",
	);
	ok(
		computeJunihitoeStackList(deps({ groups: new Map() })).length === 0,
		"no groups → empty",
	);
	ok(
		computeJunihitoeStackList(deps({ nodes: [] })).length === 0,
		"no laid nodes → empty (card size unreadable)",
	);
}
