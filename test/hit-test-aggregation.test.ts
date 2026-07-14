// Characterization tests for the pure aggregation-group hit-test extracted from
// MiniGraphView.hitTest()'s first branch. Each Junihitoe stack occupies one
// card's footprint (cardW × cardH) centred on the group position, widened by
// slackPx = 1/zoom; the first containing group in iteration order wins. These
// lock the inclusive AABB bounds, the slack, and the first-match rule so the
// extraction can't drift from the original inline loop.
import { ok } from "./assert";
import { hitTestAggregationGroup } from "../src/interaction/hit-test";
import type { AggregationGroup } from "../src/aggregation/types";
import type { PositionedNode } from "../src/layout/layout";

function node(id: string): PositionedNode {
	return { id, label: id, memberships: [], x: 0, y: 0, width: 12, height: 8 };
}

function group(key: string, x: number, y: number, nodeIds: string[]): AggregationGroup {
	return {
		key,
		setKey: "s",
		nodeIds,
		attributeValue: key,
		x,
		y,
		width: 20,
		height: 16,
		representativeNode: node(nodeIds[0] ?? key),
	};
}

// cardW=20 cardH=16, zoom=1 → slack 1. Group at (100,100) spans x∈[89,111], y∈[91,109].
const g = group("g1", 100, 100, ["a", "b"]);

// ── centre hit ──
{
	const hit = hitTestAggregationGroup(100, 100, [g], 20, 16, 1);
	ok(hit != null && hit.kind === "aggregationGroup", "centre → hit");
	ok(hit != null && hit.groupKey === "g1", "carries group key");
	ok(hit != null && hit.nodeIds.length === 2, "carries node ids");
}

// ── inclusive edge + corner (slack widens by 1px) ──
{
	ok(hitTestAggregationGroup(111, 100, [g], 20, 16, 1) != null, "right edge (100+10+1) inclusive");
	ok(hitTestAggregationGroup(89, 91, [g], 20, 16, 1) != null, "top-left corner inclusive");
	ok(hitTestAggregationGroup(111.5, 100, [g], 20, 16, 1) === null, "just past right edge → null");
	ok(hitTestAggregationGroup(100, 90.9, [g], 20, 16, 1) === null, "just above top edge → null");
}

// ── slack scales with 1/zoom: at zoom 0.5 slack is 2px ──
{
	// half-width 10 + slack 2 = 12 → x∈[88,112].
	ok(hitTestAggregationGroup(112, 100, [g], 20, 16, 0.5) != null, "zoom 0.5 widens hit area (112)");
	ok(hitTestAggregationGroup(112, 100, [g], 20, 16, 1) === null, "zoom 1 does not reach 112");
}

// ── first containing group in iteration order wins ──
{
	const a = group("a", 100, 100, ["x"]);
	const b = group("b", 100, 100, ["y"]);
	const hit = hitTestAggregationGroup(100, 100, [a, b], 20, 16, 1);
	ok(hit != null && hit.groupKey === "a", "overlapping groups → first wins");
}

// ── miss + empty ──
{
	ok(hitTestAggregationGroup(0, 0, [g], 20, 16, 1) === null, "far point → null");
	ok(hitTestAggregationGroup(100, 100, [], 20, 16, 1) === null, "no groups → null");
}
