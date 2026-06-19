import { ok } from "./assert";
import {
	computeAutoHavingRows,
	seedAutoHavingRows,
	resolveEffectiveHaving,
} from "../src/query/rebuild-pipeline";
import { computeDroppedClusters } from "../src/query/query-pipeline";
import type { GraphNode } from "../src/types";

// ── 1. computeAutoHavingRows now returns a formula instead of resolved numbers.
const formula = "(count >= _noteCount * 0.05) AND (count < _noteCount * 0.6)";

for (const n of [0, 5, 10, 100, 1000]) {
	const got = computeAutoHavingRows(n).join("|");
	ok(got === formula, `computeAutoHavingRows(${n}) returns the new formula`);
}

// ── 2. seedAutoHavingRows seeds the formula when auto is on AND no manual rows exist.
{
	let persisted: string[] | null = null;
	const out = seedAutoHavingRows([], true, 36, (s) => (persisted = s));
	ok(out.join("|") === formula, "empty + auto → seeds formula");
	ok(persisted !== null && (persisted as string[]).join("|") === formula, "formula is persisted via callback");
}

// ── 3. computeDroppedClusters evaluates the formula correctly using _noteCount.
{
	const nodes: GraphNode[] = [];
	for (let i = 0; i < 100; i++) nodes.push({ id: `n${i}`, memberships: ["a"] } as any);
	// _noteCount = 1000.
	// 5% = 50, 60% = 600.
	// Cluster "a" has 100, so 50 <= 100 < 600 is TRUE → NOT dropped.
	const { dropped } = computeDroppedClusters(nodes, [formula], false, { _noteCount: 1000 });
	ok(!dropped.has("a"), "cluster 'a' matches formula (100 is between 50 and 600)");
}
{
	const nodes: GraphNode[] = [];
	for (let i = 0; i < 40; i++) nodes.push({ id: `n${i}`, memberships: ["b"] } as any);
	// _noteCount = 1000. 5% = 50.
	// Cluster "b" has 40, so 40 >= 50 is FALSE → dropped.
	const { dropped } = computeDroppedClusters(nodes, [formula], false, { _noteCount: 1000 });
	ok(dropped.has("b"), "cluster 'b' below 5% floor → dropped");
}
{
	const nodes: GraphNode[] = [];
	for (let i = 0; i < 700; i++) nodes.push({ id: `n${i}`, memberships: ["c"] } as any);
	// _noteCount = 1000. 60% = 600.
	// Cluster "c" has 700, so 700 < 600 is FALSE → dropped.
	const { dropped } = computeDroppedClusters(nodes, [formula], false, { _noteCount: 1000 });
	ok(dropped.has("c"), "cluster 'c' above 60% ceiling → dropped");
}
{
	let persisted: string[] | null = null;
	const manual = ["count >= 5"];
	const out = seedAutoHavingRows(manual, true, 900, (s) => (persisted = s));
	ok(out.join("|") === "count >= 5", "manual rows present → NOT overwritten");
	ok(persisted === null, "no persist when manual rows exist");
}
{
	let persisted: string[] | null = null;
	const out = seedAutoHavingRows([], false, 900, (s) => (persisted = s));
	ok(out.length === 0 && persisted === null, "auto off → no seeding");
}
{
	// Whitespace-only rows count as empty (eligible for seeding).
	const out = seedAutoHavingRows(["", "  "], true, 36, () => {});
	ok(out.join("|") === formula, "blank rows treated as empty");
}

// resolveEffectiveHaving is now an identity pass (rows live in `having`).
ok(
	resolveEffectiveHaving(["count >= 2"], true, 900).join("|") === "count >= 2",
	"resolveEffectiveHaving no longer re-injects auto rows",
);

// Note: legacy end-to-end equivalence test removed as we switched to formulaic approach.

