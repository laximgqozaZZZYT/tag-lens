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
