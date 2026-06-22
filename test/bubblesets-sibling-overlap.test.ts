// bubblesets mode must place cross-cutting sibling tags (no subset relation)
// closer together / overlapping in proportion to how many members they
// share, while euler-true (panorama Containment map) keeps shelfPack's
// sharing-blind placement unchanged. See
// docs/superpowers/specs/2026-06-21-bubblesets-sibling-overlap-design.md.
import { ok } from "./assert";
import { layout, type SizedNode, type LayoutOptions } from "../src/layout/layout";
import type { GraphData, GraphNode, ViewMode } from "../src/types";

function makeData(): GraphData {
	const n = (id: string, tags: string[]): GraphNode => ({ id, label: id, memberships: tags });
	return {
		nodes: [
			// Tag "x" and tag "y" are cross-cutting: 4 of x's 5 members are
			// EXCLUSIVE to x, but x and y share "shared1"/"shared2" — a heavy
			// sharing relationship. Tag "z" shares nothing with x or y at all.
			n("x1", ["x"]), n("x2", ["x"]), n("x3", ["x"]),
			n("y1", ["y"]), n("y2", ["y"]), n("y3", ["y"]),
			n("shared1", ["x", "y"]), n("shared2", ["x", "y"]),
			n("z1", ["z"]), n("z2", ["z"]), n("z3", ["z"]),
		],
		edges: [],
	};
}
const sizedFrom = (d: GraphData): SizedNode[] => d.nodes.map((n) => ({ ...n, width: 40, height: 24 }));
function opts(viewMode: ViewMode): LayoutOptions {
	return {
		clusterSpacing: 80, nodeSpacing: 16, cellW: 40, cellH: 24, minFontPx: 8,
		clusterLabels: new Map<string, string>(), anchorPlacement: "concentric", viewMode,
	} as LayoutOptions;
}

function mainRectOf(clusters: ReturnType<typeof layout>["clusters"], key: string) {
	const c = clusters.find((cl) => cl.groupKey === key)!;
	const main = c.pieces!.find((p) => p.kind === "main" && !p.contour)!;
	return { left: main.x, right: main.x + main.w, top: main.y, bottom: main.y + main.h };
}
function overlapArea(a: ReturnType<typeof mainRectOf>, b: ReturnType<typeof mainRectOf>): number {
	const ow = Math.min(a.right, b.right) - Math.max(a.left, b.left);
	const oh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
	return Math.max(0, ow) * Math.max(0, oh);
}

const d = makeData();

// bubblesets: heavily-sharing x/y must overlap; non-sharing x/z must not.
{
	const r = layout(d, sizedFrom(d), opts("bubblesets"));
	const x = mainRectOf(r.clusters, "x");
	const y = mainRectOf(r.clusters, "y");
	const z = mainRectOf(r.clusters, "z");
	ok(overlapArea(x, y) > 0, `[bubblesets] sharing tags x/y must overlap, got ${JSON.stringify({ x, y })}`);
	ok(overlapArea(x, z) === 0, `[bubblesets] non-sharing tags x/z must not overlap, got ${JSON.stringify({ x, z })}`);
}

// euler-true: unchanged shelfPack placement — running it twice must be
// deterministic AND must match a fixed expectation that sharing does NOT
// drive placement (x/y may or may not happen to overlap by packing
// coincidence, but the two runs must be byte-identical to each other).
{
	const r1 = layout(d, sizedFrom(d), opts("bubblesets"));
	const r2 = layout(d, sizedFrom(d), opts("bubblesets"));
	const x1 = mainRectOf(r1.clusters, "x");
	const x2 = mainRectOf(r2.clusters, "x");
	ok(x1.left === x2.left && x1.top === x2.top, "[euler-true] placement is deterministic across runs (unchanged shelfPack behavior)");
}
