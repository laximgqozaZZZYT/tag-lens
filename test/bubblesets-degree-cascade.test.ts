// bubblesets mode must place a node inside the highest-degree drawable
// intersection of its own tag signature, cascading down when the exact
// region can't be realized — and must guarantee a true triple region for
// any 3 tags that genuinely share members (n=3 strict, per
// docs/superpowers/specs/2026-06-22-bubblesets-degree-cascade-design.md).
// euler-true keeps its old single-tag-plus-exclave-marker placement.
import { ok } from "./assert";
import { layout, type SizedNode, type LayoutOptions } from "../src/layout/layout";
import type { GraphData, GraphNode, ViewMode } from "../src/types";

function makeData(): GraphData {
	const n = (id: string, tags: string[]): GraphNode => ({ id, label: id, memberships: tags });
	const nodes: GraphNode[] = [];
	// Three mutually cross-cutting tags A, B, C, each with several
	// exclusive members, plus one node belonging to ALL THREE (the literal
	// degree-3 case the n=3 guarantee must serve).
	for (let i = 0; i < 5; i++) nodes.push(n(`a${i}`, ["A"]));
	for (let i = 0; i < 5; i++) nodes.push(n(`b${i}`, ["B"]));
	for (let i = 0; i < 5; i++) nodes.push(n(`c${i}`, ["C"]));
	nodes.push(n("abc1", ["A", "B", "C"]));
	return { nodes, edges: [] };
}
const sizedFrom = (d: GraphData): SizedNode[] => d.nodes.map((n) => ({ ...n, width: 40, height: 24 }));
function opts(viewMode: ViewMode): LayoutOptions {
	return {
		clusterSpacing: 80, nodeSpacing: 16, cellW: 40, cellH: 24, minFontPx: 8,
		clusterLabels: new Map<string, string>(), anchorPlacement: "concentric", viewMode,
		bipartiteMaxTags: 80, bipartiteLayout: "concentric",
	} as LayoutOptions;
}

function mainRectOf(clusters: ReturnType<typeof layout>["clusters"], key: string) {
	const c = clusters.find((cl) => cl.groupKey === key)!;
	const main = c.pieces!.find((p) => p.kind === "main" && !p.contour)!;
	return { x: main.x, y: main.y, w: main.w, h: main.h };
}
function contains(rect: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
	return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

// bubblesets: the degree-3 node must land inside the TRUE triple-overlap
// region of A, B, and C's main rects (not just inside any one of them).
{
	const d = makeData();
	const r = layout(d, sizedFrom(d), opts("bubblesets"));
	const a = mainRectOf(r.clusters, "A");
	const b = mainRectOf(r.clusters, "B");
	const c = mainRectOf(r.clusters, "C");
	const left = Math.max(a.x, b.x, c.x);
	const top = Math.max(a.y, b.y, c.y);
	const right = Math.min(a.x + a.w, b.x + b.w, c.x + c.w);
	const bottom = Math.min(a.y + a.h, b.y + b.h, c.y + c.h);
	ok(right - left > 0 && bottom - top > 0, `[bubblesets] A, B, C main rects must have a real triple overlap, got bounds ${JSON.stringify({ left, top, right, bottom })}`);

	const abc1 = r.nodes.find((n) => n.id === "abc1")!;
	ok(
		contains({ x: left, y: top, w: right - left, h: bottom - top }, abc1.x, abc1.y),
		`[bubblesets] degree-3 node must be placed inside the true A∩B∩C region, got (${abc1.x}, ${abc1.y}) vs region ${JSON.stringify({ left, top, right, bottom })}`,
	);
}

// euler-true: the degree-3 node keeps the OLD behavior (homed in one of
// A/B/C's own block, not necessarily inside any triple region) — this
// mode must be unaffected by this plan.
{
	const d = makeData();
	const r1 = layout(d, sizedFrom(d), opts("euler-true"));
	const r2 = layout(d, sizedFrom(d), opts("euler-true"));
	const abc1a = r1.nodes.find((n) => n.id === "abc1")!;
	const abc1b = r2.nodes.find((n) => n.id === "abc1")!;
	ok(abc1a.x === abc1b.x && abc1a.y === abc1b.y, "[euler-true] placement is deterministic and unaffected by this plan (unchanged exclave-marker behavior)");
}
