// bubblesets, end-to-end through layout(): the actual bug a user screenshot
// reported was "n=3 (the A∩B∩C intersection, excluding the outer 'all'
// enclosure) shows the correct overlap shape, but the box is too small for
// its nodes and nodes overlap each other." Root-caused (by direct repro
// before this fix) to TWO things: (1) every degree>=2 intersection region
// was packed independently, with no shared occupancy between regions whose
// boxes legitimately overlap (the Euler-diagram effect itself), so two
// different regions' nodes could land on the same physical cells; (2) a
// row-major packer bug silently dropped nodes when a region's cell grid
// ran out of free cells mid-zone. Both are fixed (see phase-g-place.ts /
// layout.ts's bubblesets branch). This test locks in the actual, global,
// end-to-end invariant a user would see on screen — not just "this one
// region's own box contains its own nodes" (already covered by
// bubblesets-region-sizing.test.ts) but "nothing overlaps ANYTHING else,
// and nothing got silently dropped" — across the whole diagram.
import { ok } from "./assert";
import { layout, type SizedNode, type LayoutOptions } from "../src/layout/layout";
import type { GraphData, GraphNode, ViewMode } from "../src/types";

function makeNode(id: string, memberships: string[]): GraphNode {
	return { id, label: id, memberships };
}

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
	} as LayoutOptions;
}

function rectOf(n: { x: number; y: number; width: number; height: number }) {
	return { x1: n.x - n.width / 2, y1: n.y - n.height / 2, x2: n.x + n.width / 2, y2: n.y + n.height / 2 };
}
function overlaps(a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>): boolean {
	return a.x1 < b.x2 - 0.01 && a.x2 > b.x1 + 0.01 && a.y1 < b.y2 - 0.01 && a.y2 > b.y1 + 0.01;
}
function countGlobalOverlaps(nodes: { x: number; y: number; width: number; height: number; id: string }[]): string[] {
	const collisions: string[] = [];
	for (let i = 0; i < nodes.length; i++) {
		for (let j = i + 1; j < nodes.length; j++) {
			if (overlaps(rectOf(nodes[i]), rectOf(nodes[j]))) collisions.push(`${nodes[i].id} vs ${nodes[j].id}`);
		}
	}
	return collisions;
}

// Scenario 1: a genuine A∩B∩C triple-overlap core (n=3), surrounded by
// pairwise-only siblings (A∩B-only, B∩C-only, A∩C-only) that geometrically
// overlap the triple core's box — exactly the "n=3, excluding the overall
// enclosure" case from the bug report. 52 nodes total. Before this fix,
// direct repro found 19 pairs of node rects from different regions
// overlapping here.
{
	const data: GraphData = {
		nodes: [
			...Array.from({ length: 10 }, (_, i) => makeNode(`abc${i}`, ["A", "B", "C"])),
			...Array.from({ length: 6 }, (_, i) => makeNode(`ab${i}`, ["A", "B"])),
			...Array.from({ length: 6 }, (_, i) => makeNode(`bc${i}`, ["B", "C"])),
			...Array.from({ length: 6 }, (_, i) => makeNode(`ac${i}`, ["A", "C"])),
			...Array.from({ length: 8 }, (_, i) => makeNode(`a${i}`, ["A"])),
			...Array.from({ length: 8 }, (_, i) => makeNode(`b${i}`, ["B"])),
			...Array.from({ length: 8 }, (_, i) => makeNode(`c${i}`, ["C"])),
		],
		edges: [],
	};
	const sized: SizedNode[] = data.nodes.map((n) => ({ ...n, width: 80, height: 24 }));
	const out = layout(data, sized, opts("bubblesets"));

	ok(
		out.nodes.length === data.nodes.length,
		`expected all ${data.nodes.length} input nodes to be present in the output (none dropped), got ${out.nodes.length}`,
	);

	const collisions = countGlobalOverlaps(out.nodes);
	ok(
		collisions.length === 0,
		`expected zero pairwise node-rectangle overlaps across the ENTIRE diagram (n<=3 must have no accepted structural limit on cross-region collision), got ${collisions.length}: ${collisions.slice(0, 10).join(", ")}${collisions.length > 10 ? ", ..." : ""}`,
	);

	// The n=3 region itself must hold real area for its real member count
	// — not just be non-degenerate. rho=0.8 (raised from the historical
	// rho=0.5 "good enough, not a sliver" tolerance): for a genuine n<=3
	// intersection with no independent-many-siblings fan-out pathology,
	// there is no accepted structural limit, so the bar is a real majority
	// of the ideal area, not just "more than half."
	const tripleSub = out.clusters
		.flatMap((c) => c.pieces ?? [])
		.find((p) => p.kind === "sub" && (p.hueKeys?.length ?? 0) === 3);
	ok(!!tripleSub, "expected a triple-overlap (A,B,C) sub-piece to exist");
	const cardArea = 80 * 24;
	const requiredArea = 10 * cardArea;
	ok(
		tripleSub!.w * tripleSub!.h >= requiredArea * 0.8,
		`triple region too small for its 10 nodes at the n<=3 "no structural limit" bar (rho=0.8): got ${tripleSub!.w}x${tripleSub!.h}=${tripleSub!.w * tripleSub!.h}, need >= ${requiredArea * 0.8}`,
	);
}

// Scenario 2: a hub tag sharing independently with 6 mutually-unrelated
// spoke tags (each relationship is itself only n=2 — a plain pairwise
// intersection — the high FAN-OUT, not the intersection ORDER, is what
// stresses this case). The two invariants that must hold unconditionally
// (no accepted limit) are still global zero-collision and zero dropped
// nodes. Per-pair area is reported but not asserted at a uniform bar here:
// independently verified by direct geometric computation (see
// sibling-overlap-pack.test.ts) that many same-size boxes cannot all sit
// close enough to one shared hub for deep simultaneous overlap without
// colliding each other — a real fact about Euclidean rectangles, not an
// algorithm gap "n<=3" can wave away. What IS asserted: a clear majority
// of spokes (>=4 of 6) must achieve real, visible overlap — the
// measured, repeatable result of this plan's radial hub-seeding (see
// sibling-overlap-pack.ts), against a documented pre-fix baseline where
// success was much less predictable.
{
	const hubNodes: GraphNode[] = [];
	for (let s = 0; s < 6; s++) {
		for (let i = 0; i < 5; i++) hubNodes.push(makeNode(`hub_spoke${s}_${i}`, ["HUB", `SPOKE${s}`]));
		for (let i = 0; i < 5; i++) hubNodes.push(makeNode(`spoke${s}_excl${i}`, [`SPOKE${s}`]));
	}
	for (let i = 0; i < 10; i++) hubNodes.push(makeNode(`hub_excl${i}`, ["HUB"]));
	const data: GraphData = { nodes: hubNodes, edges: [] };
	const sized: SizedNode[] = data.nodes.map((n) => ({ ...n, width: 80, height: 24 }));
	const out = layout(data, sized, opts("bubblesets"));

	ok(
		out.nodes.length === data.nodes.length,
		`expected all ${data.nodes.length} input nodes to be present in the output (none dropped), got ${out.nodes.length}`,
	);

	const collisions = countGlobalOverlaps(out.nodes);
	ok(
		collisions.length === 0,
		`expected zero pairwise node-rectangle overlaps across the ENTIRE hub-and-spoke diagram, got ${collisions.length}: ${collisions.slice(0, 10).join(", ")}${collisions.length > 10 ? ", ..." : ""}`,
	);

	const mainRectOf = (key: string) => {
		const c = out.clusters.find((cl) => cl.groupKey === key)!;
		const m = c.pieces!.find((p) => p.kind === "main" && !p.contour)!;
		return { x: m.x, y: m.y, w: m.w, h: m.h };
	};
	const hub = mainRectOf("HUB");
	const cardArea = 80 * 24;
	let strongCount = 0;
	for (let s = 0; s < 6; s++) {
		const sp = mainRectOf(`SPOKE${s}`);
		const l = Math.max(hub.x, sp.x);
		const t = Math.max(hub.y, sp.y);
		const r = Math.min(hub.x + hub.w, sp.x + sp.w);
		const b = Math.min(hub.y + hub.h, sp.y + sp.h);
		const area = Math.max(0, r - l) * Math.max(0, b - t);
		if (area >= 5 * cardArea * 0.5) strongCount++;
	}
	ok(
		strongCount >= 4,
		`expected at least 4 of 6 spokes to achieve a real (>=50% of ideal area) overlap with the hub via radial seeding, got ${strongCount}`,
	);
}
