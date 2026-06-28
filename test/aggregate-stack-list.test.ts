import { ok } from "./assert";
import {
	type AggregateStackListDeps,
	computeAggregateStackList,
} from "../src/draw/aggregate-stack-list";
import type { ClusterRect, PositionedNode } from "../src/layout/layout";

// Characterization tests for the pure aggregate stack-descriptor list extracted
// from MiniGraphView.drawBodyTile(). They lock the gating (showNodes / non-empty
// aggregateCount / non-empty nodes), the card size source (nodes[0]), the
// falsy-count skip and the per-cluster "high iff groupKey in highlightedClusters"
// rule so the extraction can't drift from the original inline loop.

function node(id: string, width = 12, height = 8): PositionedNode {
	return { id, label: id, memberships: [], x: 0, y: 0, width, height };
}

function cluster(groupKey: string): ClusterRect {
	return {
		groupKey,
		label: groupKey,
		x: 0,
		y: 0,
		width: 1,
		height: 1,
		memberCount: 1,
	};
}

function deps(over: Partial<AggregateStackListDeps> = {}): AggregateStackListDeps {
	return {
		showNodes: true,
		nodes: [node("a"), node("b")],
		clusters: [cluster("g1"), cluster("g2")],
		aggregateCount: new Map([
			["g1", 3],
			["g2", 5],
		]),
		highlightedClusters: new Set(),
		...over,
	};
}

// Card size comes from nodes[0]; every counted cluster emits one descriptor.
{
	const list = computeAggregateStackList(deps());
	ok(list.length === 2, "one descriptor per counted cluster");
	ok(
		list[0].cluster.groupKey === "g1" && list[1].cluster.groupKey === "g2",
		"cluster order kept",
	);
	ok(list[0].cardW === 12 && list[0].cardH === 8, "card size read from nodes[0]");
	ok(list[0].count === 3 && list[1].count === 5, "count read from aggregateCount");
	ok(!list[0].isHigh && !list[1].isHigh, "no highlight → all low");
}

// A cluster is high iff its groupKey is in highlightedClusters.
{
	const list = computeAggregateStackList(
		deps({ highlightedClusters: new Set(["g2"]) }),
	);
	ok(!list[0].isHigh, "g1 low — not highlighted");
	ok(list[1].isHigh, "g2 high — groupKey highlighted");
}

// A cluster with a falsy (missing or 0) aggregate count is skipped.
{
	const list = computeAggregateStackList(
		deps({ aggregateCount: new Map([["g2", 0]]) }),
	);
	ok(list.length === 0, "missing (g1) and zero (g2) counts both skipped");
}

// Gating: showNodes off, empty aggregateCount, or no nodes → empty list.
{
	ok(
		computeAggregateStackList(deps({ showNodes: false })).length === 0,
		"showNodes off → empty",
	);
	ok(
		computeAggregateStackList(deps({ aggregateCount: new Map() })).length === 0,
		"no aggregate counts → empty",
	);
	ok(
		computeAggregateStackList(deps({ nodes: [] })).length === 0,
		"no laid nodes → empty (card size unreadable)",
	);
}
