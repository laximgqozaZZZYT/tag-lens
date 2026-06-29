import { test } from "node:test";
import * as assert from "node:assert";
import { layoutScatter } from "../src/layout/scatter-layout";
import { layout } from "../src/layout/layout";
import type { GraphData } from "../src/types";
import type { LayoutOptions, SizedNode } from "../src/layout/layout";

// F2.3 — scatter is a flat card layout: exactly one positioned node per
// displayed note (no per-tag duplication), and NO clusters / edges. Axis
// placement (F2.4) repositions later, so here we only lock the node set,
// the absence of clustering, and attribute propagation.

function opts(over: Partial<LayoutOptions> = {}): LayoutOptions {
	return {
		clusterLabels: new Map<string, string>(),
		nodeSpacing: 16,
		minFontPx: 8,
		cellW: 80,
		cellH: 24,
		...over,
	} as unknown as LayoutOptions;
}

function makeData(): GraphData {
	const node = (id: string, tags: string[], extra: Record<string, unknown> = {}) =>
		({ id, label: id, memberships: tags, mtime: 0, ...extra }) as unknown as GraphData["nodes"][number];
	return {
		nodes: [
			node("a", ["x"], { ageDays: 1, fmMaturity: "seed" }),
			node("b", ["y"], { ageDays: 5 }),
			node("multi", ["x", "y"], { ageDays: 9, isPeripheral: true }),
		],
		edges: [],
	} as GraphData;
}

function sizedOf(data: GraphData): SizedNode[] {
	return data.nodes.map((n) => ({ ...n, width: 80, height: 24 }) as SizedNode);
}

// One node per displayed note; no clusters, no edges.
{
	const data = makeData();
	const laid = layoutScatter(data, sizedOf(data), opts());
	test("scatter: one positioned node per displayed note", () => {
		assert.strictEqual(laid.nodes.length, data.nodes.length);
		const ids = laid.nodes.map((n) => n.id).sort();
		assert.deepStrictEqual(ids, ["a", "b", "multi"]);
	});
	test("scatter: no clusters and no edges", () => {
		assert.strictEqual(laid.clusters.length, 0);
		assert.strictEqual(laid.edges.length, 0);
	});
	test("scatter: a multi-tag note is placed ONCE with its full memberships", () => {
		const multi = laid.nodes.filter((n) => n.id === "multi");
		assert.strictEqual(multi.length, 1);
		assert.deepStrictEqual(multi[0].memberships, ["x", "y"]);
	});
	test("scatter: encoding attributes propagate onto positioned nodes", () => {
		const a = laid.nodes.find((n) => n.id === "a")!;
		assert.strictEqual(a.ageDays, 1);
		assert.strictEqual(a.fmMaturity, "seed");
		const m = laid.nodes.find((n) => n.id === "multi")!;
		assert.strictEqual(m.isPeripheral, true);
	});
	test("scatter: grid placement is overlap-free (distinct positions)", () => {
		const seen = new Set(laid.nodes.map((n) => `${n.x},${n.y}`));
		assert.strictEqual(seen.size, laid.nodes.length);
	});
}

// The top-level dispatcher routes viewMode === "scatter" to layoutScatter.
{
	test("scatter: layout() dispatch produces the flat scatter layout", () => {
		const data = makeData();
		const laid = layout(data, sizedOf(data), opts({ viewMode: "scatter" }));
		assert.strictEqual(laid.nodes.length, data.nodes.length);
		assert.strictEqual(laid.clusters.length, 0);
	});
}
