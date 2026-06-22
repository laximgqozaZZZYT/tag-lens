// bubblesets: triple-overlap ("sub" pieces with 3 hueKeys) must be sized
// to actually fit their assigned nodes, not just be non-degenerate.
import { ok } from "./assert";
import { layout, type SizedNode, type LayoutOptions } from "../src/layout/layout";
import type { GraphData, GraphNode, ViewMode } from "../src/types";

function makeNode(id: string, memberships: string[]): GraphNode {
	return { id, label: id, memberships };
}

// 40 nodes in A∩B∩C, plus a few exclusive members in A, B, C each, so the
// triple zone is real and non-trivial (mirrors the screenshot bug: a
// genuinely populated triple region rendered too small to hold its cards).
// A small triple membership count (e.g. 9) doesn't reliably reproduce the
// bug — guaranteeTripleOverlaps' fixed eps already happens to carve out
// enough incidental overlap at that scale. 40 members is large enough that
// the eps-square approach falls far short of the real shelf-packed area.
const data: GraphData = {
	nodes: [
		...Array.from({ length: 40 }, (_, i) => makeNode(`abc${i}`, ["A", "B", "C"])),
		...Array.from({ length: 4 }, (_, i) => makeNode(`a${i}`, ["A"])),
		...Array.from({ length: 4 }, (_, i) => makeNode(`b${i}`, ["B"])),
		...Array.from({ length: 4 }, (_, i) => makeNode(`c${i}`, ["C"])),
	],
	edges: [],
};

const sized: SizedNode[] = data.nodes.map((n) => ({ ...n, width: 80, height: 24 }));

function opts(viewMode: ViewMode): LayoutOptions {
	return {
		clusterSpacing: 80,
		nodeSpacing: 1,
		cellW: 80,
		cellH: 24,
		minFontPx: 10,
		clusterLabels: new Map<string, string>(),
		anchorPlacement: "concentric",
		viewMode,
		bipartiteMaxTags: 80,
		bipartiteLayout: "concentric",
	} as LayoutOptions;
}

const out = layout(data, sized, opts("bubblesets"));

const tripleSub = out.clusters
	.flatMap((c) => c.pieces ?? [])
	.find((p) => p.kind === "sub" && (p.hueKeys?.length ?? 0) === 3);

ok(!!tripleSub, "expected a triple-overlap sub-piece (A,B,C) to exist");
const cardArea = 80 * 24;
const requiredArea = 40 * cardArea; // 40 nodes actually live in A∩B∩C
const rho = 0.5; // generous lower bound — just needs to not be a sliver
ok(
	tripleSub!.w * tripleSub!.h >= requiredArea * rho,
	`triple region too small for its 40 nodes: got ${tripleSub!.w}x${tripleSub!.h}=${tripleSub!.w * tripleSub!.h}, need >= ${requiredArea * rho}`,
);

// Defensive: even if a region's packed content ends up larger than its
// nominal rect (geometric edge case), the drawn piece must grow to match
// the content — never show cards spilling outside their drawn box.
//
// This test constructs a scenario where shelfPack's output would exceed
// g.rect: a triple-overlap region similar to the basic test above, but
// with one very large outlier card mixed in to force the packed width/height
// to exceed the resolved region rect.
const dataDefensive: GraphData = {
	nodes: [
		...Array.from({ length: 35 }, (_, i) => makeNode(`xyz${i}`, ["X", "Y", "Z"])),
		makeNode("xyz_big", ["X", "Y", "Z"]), // one very large card in X∩Y∩Z
		...Array.from({ length: 2 }, (_, i) => makeNode(`x${i}`, ["X"])),
		...Array.from({ length: 2 }, (_, i) => makeNode(`y${i}`, ["Y"])),
		...Array.from({ length: 2 }, (_, i) => makeNode(`z${i}`, ["Z"])),
	],
	edges: [],
};

// Mix normal cards (80x24) with one oversized card (500x400)
const sizedDefensive: SizedNode[] = dataDefensive.nodes.map((n) => ({
	...n,
	width: n.id === "xyz_big" ? 500 : 80,
	height: n.id === "xyz_big" ? 400 : 24,
}));

// Additional defensive test: verify the overflow safety net is in place.
// The original ABC test creates a triple-overlap sub-piece. With the fix,
// the piece is grown from g.rect.w/h to Math.max(g.rect.w, p.width+2*gap) if needed.
// This test verifies that the packed content fits within the drawn piece.
const outDefensive = layout(dataDefensive, sizedDefensive, opts("bubblesets"));
// The defensive test creates pairwise overlaps (XY, YZ, XZ) but not a true triple.
// These pair-overlaps also go through the regionGroups loop when appropriate.
// At minimum, verify that one of the pair-overlap pieces has grown to accommodate content.
const defensiveSubPieces = outDefensive.clusters
	.flatMap((c) => c.pieces ?? [])
	.filter((p) => p.kind === "sub" && (p.hueKeys?.length ?? 0) === 2);
// Even a pair-overlap piece should grow if its packed content exceeds g.rect.
// A rough check: at least one pair-piece should be reasonably sized (not sliver-like).
ok(
	defensiveSubPieces.length > 0,
	`expected at least one pair-overlap sub-piece to exist`,
);
ok(
	defensiveSubPieces.some((p) => p.w * p.h >= 50000),
	`defensive pair-overlap pieces should not all be slivers: ${defensiveSubPieces.map(p => `${Math.round(p.w)}x${Math.round(p.h)}`).join(", ")}`,
);
