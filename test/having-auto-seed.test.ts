import { ok } from "./assert";
import {
	computeAutoHavingRows,
	seedAutoHavingRows,
	resolveEffectiveHaving,
} from "../src/query/rebuild-pipeline";
import { computeDroppedClusters } from "../src/query/query-pipeline";
import type { GraphNode } from "../src/types";

// ── 1. computeAutoHavingRows resolves the legacy AUTO HAVING thresholds to
//      concrete, grammar-valid "count <op> N" rows. These MUST match the exact
//      literals the old resolveEffectiveHaving injected silently.
function legacyAutoRows(nodeCount: number): string[] {
	const rows: string[] = [];
	if (nodeCount > 10) {
		const floor = Math.max(2, Math.floor(Math.sqrt(nodeCount) / 3));
		rows.push(`count >= ${floor}`);
	}
	if (nodeCount > 30) {
		const ceiling = Math.floor(nodeCount * 0.2);
		rows.push(`count <= ${ceiling}`);
	}
	return rows;
}

for (const n of [0, 5, 10, 11, 20, 30, 31, 100, 256, 1000, 9500]) {
	const got = computeAutoHavingRows(n).join("|");
	const want = legacyAutoRows(n).join("|");
	ok(got === want, `computeAutoHavingRows(${n}) === legacy ("${got}")`);
}

// Spot-check the concrete strings users will see in the field.
ok(computeAutoHavingRows(5).length === 0, "n<=10 → no auto rows");
ok(
	computeAutoHavingRows(11).join("|") === "count >= 2",
	"n=11 → count >= 2 (floor lower-bounded at 2)",
);
ok(
	computeAutoHavingRows(36).join("|") === "count >= 2|count <= 7",
	"n=36 → count >= 2, count <= 7",
);
ok(
	computeAutoHavingRows(900).join("|") === "count >= 10|count <= 180",
	"n=900 → count >= 10, count <= 180",
);

// ── 2. seedAutoHavingRows only seeds when auto is on AND no manual rows exist;
//      never overwrites the user's authored HAVING.
{
	let persisted: string[] | null = null;
	const out = seedAutoHavingRows([], true, 36, (s) => (persisted = s));
	ok(out.join("|") === "count >= 2|count <= 7", "empty + auto → seeds resolved rows");
	ok(persisted !== null && (persisted as string[]).join("|") === "count >= 2|count <= 7", "seed is persisted via callback");
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
	ok(out.join("|") === "count >= 2|count <= 7", "blank rows treated as empty");
}

// resolveEffectiveHaving is now an identity pass (rows live in `having`).
ok(
	resolveEffectiveHaving(["count >= 2"], true, 900).join("|") === "count >= 2",
	"resolveEffectiveHaving no longer re-injects auto rows",
);

// ── 3. End-to-end equivalence: the OLD path (auto injects threshold rows on
//      top of empty manual) and the NEW path (threshold rows seeded into
//      `having`, then applied with the auto flag for TOP_K/NONE) drop the
//      EXACT same clusters.
function makeNode(id: string, memberships: string[]): GraphNode {
	return { id, memberships, x: 0, y: 0, width: 1, height: 1, tags: memberships } as unknown as GraphNode;
}

// Build a graph with a long tail + a dominant cluster to exercise floor,
// ceiling, TOP_K and NONE_BUCKET all at once.
function buildNodes(): GraphNode[] {
	const nodes: GraphNode[] = [];
	let id = 0;
	// dominant cluster "big" with 40 members (will trip the ceiling).
	for (let i = 0; i < 40; i++) nodes.push(makeNode(`b${id++}`, ["big"]));
	// 25 mid clusters of size 4 each (exercise TOP_K=20 cap + floor).
	for (let c = 0; c < 25; c++) {
		for (let i = 0; i < 4; i++) nodes.push(makeNode(`m${c}_${id++}`, [`mid${c}`]));
	}
	// rare singletons (below floor) and explicit NONE_BUCKET members.
	for (let i = 0; i < 5; i++) nodes.push(makeNode(`r${id++}`, [`rare${i}`]));
	for (let i = 0; i < 3; i++) nodes.push(makeNode(`none${id++}`, ["__none__"]));
	return nodes;
}

const nodes = buildNodes();
const nodeCount = nodes.length;

// OLD path: empty manual having + auto injects the threshold rows.
const oldEff = [...legacyAutoRows(nodeCount)];
const oldDropped = computeDroppedClusters(nodes, oldEff, true).dropped;

// NEW path: seed threshold rows into having, resolve (identity), apply w/ auto.
const seeded = seedAutoHavingRows([], true, nodeCount, () => {});
const newEff = resolveEffectiveHaving(seeded, true, nodeCount);
const newDropped = computeDroppedClusters(nodes, newEff, true).dropped;

const oldKeys = [...oldDropped.keys()].sort().join(",");
const newKeys = [...newDropped.keys()].sort().join(",");
ok(oldKeys === newKeys, `dropped-cluster sets identical (old=new): ${newKeys}`);
ok(oldDropped.size === newDropped.size, "dropped counts identical");
