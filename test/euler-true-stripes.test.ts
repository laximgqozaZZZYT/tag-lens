// Regression for the F5 stripe-gradient fix: BubbleSets (and euler-true) reuse
// layoutEulerTrue's "PARTIAL-OVERLAP exclave" pieces (layout.ts ~L1084-1107) to
// draw a multi-tag node's ∩ sub-box. draw-enclosures.ts only stripes a sub-box
// when `piece.hueKeys.length > 1` is populated — but the exclave push originally
// set only `hueKey` (a single signature string for the swatch lookup), never
// `hueKeys` (the constituent-tag list createStripeGradient needs). That left
// every BubbleSets intersection sub-box solid-filled regardless of the F5
// stripe work landing in draw-enclosures.ts. This test pins the fix: a node
// that is a member of ≥2 tags and lands OUTSIDE its tag's main rectangle must
// produce a "sub" piece whose `hueKeys` lists all of that node's memberships.
import { ok } from "./assert";
import { layout, type SizedNode, type LayoutOptions } from "../src/layout/layout";
import type { GraphData, GraphNode, ViewMode } from "../src/types";

function makeData(): GraphData {
	const n = (id: string, tags: string[]): GraphNode => ({ id, label: id, memberships: tags });
	return {
		nodes: [
			n("a1", ["x"]),
			n("a2", ["x"]),
			n("b1", ["y"]),
			n("b2", ["y"]),
			// Cross-cutting member: lives in both x and y, neither of which
			// contains the other → triggers the exclave-piece path for both
			// tag x's and tag y's cluster.
			n("c", ["x", "y"]),
		],
		edges: [],
	};
}
const sizedFrom = (d: GraphData): SizedNode[] => d.nodes.map((n) => ({ ...n, width: 40, height: 24 }));
function opts(viewMode: ViewMode): LayoutOptions {
	return {
		clusterSpacing: 80,
		nodeSpacing: 16,
		cellW: 40,
		cellH: 24,
		minFontPx: 8,
		clusterLabels: new Map<string, string>(),
		anchorPlacement: "concentric",
		viewMode,
		bipartiteMaxTags: 80,
		bipartiteLayout: "concentric",
	} as LayoutOptions;
}

for (const mode of ["euler-true", "bubblesets"] as ViewMode[]) {
	const d = makeData();
	const r = layout(d, sizedFrom(d), opts(mode));
	const subPieces = r.clusters.flatMap((c) => (c.pieces ?? []).filter((p) => p.kind === "sub"));
	ok(subPieces.length > 0, `[${mode}] cross-cutting member produces at least one exclave sub-piece`);
	const striped = subPieces.filter((p) => p.hueKeys && p.hueKeys.length > 1);
	ok(
		striped.length > 0,
		`[${mode}] at least one exclave sub-piece carries hueKeys with ≥2 constituent tags (got: ${JSON.stringify(
			subPieces.map((p) => p.hueKeys),
		)})`,
	);
	for (const p of striped) {
		ok(
			p.hueKeys!.includes("x") && p.hueKeys!.includes("y"),
			`[${mode}] exclave hueKeys is the node's own membership list (["x","y"]), got ${JSON.stringify(p.hueKeys)}`,
		);
	}
}
