// bubblesets: triple-overlap ("sub" pieces with 3 hueKeys) must be sized
// to actually fit their assigned nodes, not just be non-degenerate.
import { ok } from "./assert";
import { layout, type SizedNode, type LayoutOptions } from "../src/layout/layout";
import { shelfPack } from "../src/layout/subgroup-packing";
import { computeChannelDims, minFontScale } from "../src/layout/card-sizing";
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
// This test constructs a scenario where shelfPack's output PROVABLY
// exceeds the resolved region rect: a triple-overlap region (39 normal
// cards + 1 moderately oversized card) mixed in. Rather than asserting
// an area floor that is satisfiable whether or not the fix is applied
// (the bug this test previously had), this test independently
// recomputes the EXACT packed dimensions shelfPack will produce for the
// triple piece's member nodes (same inputs, same gap layout.ts uses
// internally) and asserts the drawn piece's w/h against that exact
// value.
//
// Empirically verified (see Task 4 review fix-up): with a 95x35 outlier
// mixed into 39 otherwise-uniform 80x24 cards, resolveNodeRegion still
// resolves a genuine X∩Y∩Z triple region at g.rect=277x360 (same
// resolved rect as the all-uniform case — the geometric search is blind
// to the one oversized card), while shelfPack's packed content for
// those same 40 cards needs ~564x424 once gap padding is added. That gap
// between g.rect and the packed requirement is exactly what the Task 4
// safety net (`Math.max(g.rect.w, p.width + 2*gap)`) exists to close.
// Without the fix (`w: g.rect.w, h: g.rect.h`), the drawn piece stays at
// 277x360 — well under the packed requirement — so the assertions below
// fail; with the fix, they pass. (See the explicit revert/restore
// verification recorded in task-4-report.md.)
const dataDefensive: GraphData = {
	nodes: [
		...Array.from({ length: 39 }, (_, i) => makeNode(`xyz${i}`, ["X", "Y", "Z"])),
		makeNode("xyz_big", ["X", "Y", "Z"]), // one oversized card in X∩Y∩Z
		...Array.from({ length: 4 }, (_, i) => makeNode(`x${i}`, ["X"])),
		...Array.from({ length: 4 }, (_, i) => makeNode(`y${i}`, ["Y"])),
		...Array.from({ length: 4 }, (_, i) => makeNode(`z${i}`, ["Z"])),
	],
	edges: [],
};

// Mix normal cards (80x24) with one oversized card (95x35). Chosen to be
// large enough that the packed content provably exceeds g.rect, but
// small enough that resolveNodeRegion still resolves a real triple
// region instead of cascading down to pair-overlaps (verified by sweeping
// outlier sizes from 80x24 up to 160x100: 95x35 sits in the stable middle
// of the range that still produces a triple, well clear of the ~105x45
// boundary where cascade-to-pairs begins).
const sizedDefensive: SizedNode[] = dataDefensive.nodes.map((n) => ({
	...n,
	width: n.id === "xyz_big" ? 95 : 80,
	height: n.id === "xyz_big" ? 35 : 24,
}));

const outDefensive = layout(dataDefensive, sizedDefensive, opts("bubblesets"));
const tripleSubDefensive = outDefensive.clusters
	.flatMap((c) => c.pieces ?? [])
	.find((p) => p.kind === "sub" && (p.hueKeys?.length ?? 0) === 3);

ok(!!tripleSubDefensive, "expected a triple-overlap sub-piece (X,Y,Z) to exist");

// Recompute shelfPack's exact output for the 35 X∩Y∩Z members, using the
// same gap layout.ts derives internally: gap = computeChannelDims(nodeSpacing,
// minFontScale(minFontPx)).channelW. With nodeSpacing:1, minFontPx:10 (<=
// CARD_TITLE_FONT_PX), this is a deterministic constant.
const xyzMembers = dataDefensive.nodes.filter(
	(n) => n.memberships.length === 3 && n.memberships.includes("X") && n.memberships.includes("Y") && n.memberships.includes("Z"),
);
const xyzSizes: SizedNode[] = xyzMembers.map((n) => {
	const s = sizedDefensive.find((sd) => sd.id === n.id)!;
	return { id: n.id, label: n.label, memberships: n.memberships, width: s.width, height: s.height };
});
const gap = computeChannelDims(opts("bubblesets").nodeSpacing, minFontScale(opts("bubblesets").minFontPx ?? 0)).channelW;
const packed = shelfPack(xyzSizes, gap);
const requiredW = packed.width + 2 * gap;
const requiredH = packed.height + 2 * gap;

ok(
	tripleSubDefensive!.w >= requiredW,
	`triple piece width ${tripleSubDefensive!.w} must be >= packed content width ${requiredW} (packed.width=${packed.width}, gap=${gap}) — the drawn box must grow to fit the oversized card`,
);
ok(
	tripleSubDefensive!.h >= requiredH,
	`triple piece height ${tripleSubDefensive!.h} must be >= packed content height ${requiredH} (packed.height=${packed.height}, gap=${gap}) — the drawn box must grow to fit the oversized card`,
);

// Host selection for degree-cascade sub-pieces must pick the SMALLEST-area
// participating cluster, not the alphabetically-first tag — otherwise a
// small, specific intersection's content renders in the BIGGER cluster's
// pieces array and only gets painted when that bigger cluster's z-order
// slot comes up, burying it under whatever smaller-but-unrelated cluster
// happens to paint later (draw-enclosures.ts paints largest-area clusters
// first, smallest last/on top — see its line ~46 sort).
{
	const data: GraphData = {
		nodes: [
			...Array.from({ length: 30 }, (_, i) => makeNode(`big${i}`, ["AAA_big"])),
			...Array.from({ length: 4 }, (_, i) => makeNode(`shared${i}`, ["AAA_big", "zzz_small"])),
		],
		edges: [],
	};
	const sized = data.nodes.map((n) => ({ ...n, width: 80, height: 24 }));
	const out = layout(data, sized, {
		viewMode: "bubblesets",
		cellW: 80,
		cellH: 24,
		nodeSpacing: 1,
		minFontPx: 10,
	} as any);
	const big = out.clusters.find((c) => c.groupKey === "AAA_big")!;
	const small = out.clusters.find((c) => c.groupKey === "zzz_small")!;
	ok(
		small.width * small.height < big.width * big.height,
		`precondition failed: zzz_small must actually be the smaller cluster, got small=${small.width}x${small.height} big=${big.width}x${big.height}`,
	);
	const subInBig = (big.pieces ?? []).some((p) => p.kind === "sub" && p.hueKeys?.includes("zzz_small"));
	const subInSmall = (small.pieces ?? []).some((p) => p.kind === "sub" && p.hueKeys?.includes("AAA_big"));
	ok(
		!subInBig && subInSmall,
		`the intersection sub-piece must host on the smaller cluster (zzz_small), not the alphabetically-first one (AAA_big). subInBig=${subInBig} subInSmall=${subInSmall}`,
	);
}
