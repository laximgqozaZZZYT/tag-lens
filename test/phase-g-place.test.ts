// placeNodesInRegions (Phase G of the formerly-unwired region-layout engine):
// two real bugs found while evaluating this engine as a replacement for
// bubblesets' node-region packing. (1) placeMultiZoneRowMajor, when its
// row-major scan ran out of free cells mid-zone, placed only the CURRENT
// node via spiral fallback and returned immediately — silently dropping
// every remaining node in that zone. (2) placeNodesInRegions, when a
// zone's full membership signature had no AABB intersection at all (e.g.
// one of its tags' setRect didn't exist, or the geometric intersection was
// degenerate), skipped the zone entirely instead of cascading down to a
// drawable parent combination (the same fallback resolveNodeRegion already
// implements for the bubblesets degree-cascade scheme).
import { ok } from "./assert";
import { placeNodesInRegions } from "../src/layout/phase-g-place";
import type { Zone } from "../src/layout/zone-decomp";
import type { RegionRect } from "../src/layout/region-layout";
import type { GraphNode } from "../src/types";
import type { SizedNode } from "../src/layout/layout";

function node(id: string, memberships: string[]): GraphNode {
	return { id, label: id, memberships };
}

function zone(memberships: string[], nodes: GraphNode[]): Zone {
	return { key: memberships.join("|"), memberships, count: nodes.length, nodes, isHellyForced: false };
}

const opts = { slotW: 84, slotH: 28, padPx: 8, defaultCardW: 80, defaultCardH: 24 };

// Bug 1 regression: a zone with more nodes than fit in its region's cell
// grid must not lose any nodes — the overflow must spill out via spiral,
// not get dropped.
{
	const nodes = Array.from({ length: 20 }, (_, i) => node(`n${i}`, ["A", "B"]));
	const z = zone(["A", "B"], nodes);
	// A tiny intersection region: only enough cells for ~4 nodes, forcing
	// the row-major scan to run out of free cells well before all 20 are
	// placed.
	const setRects = new Map<string, RegionRect>([
		["A", { setKey: "A", x: 0, y: 0, w: 200, h: 200 }],
		["B", { setKey: "B", x: 0, y: 0, w: 168, h: 56 }],
	]);
	const sized: SizedNode[] = nodes.map((n) => ({ ...n, width: 80, height: 24 }));
	const out = placeNodesInRegions([z], setRects, sized, opts);
	ok(out.length === 20, `expected all 20 nodes to be placed (none dropped), got ${out.length}`);
	const ids = new Set(out.map((n) => n.id));
	ok(ids.size === 20, `expected 20 distinct placed node ids, got ${ids.size}`);
}

// Bug 2 regression: a zone whose full signature has NO AABB intersection
// (one membership's setRect doesn't exist at all) must cascade down to a
// drawable parent combination instead of being skipped outright.
{
	const nodes = [node("x0", ["A", "B", "GHOST"])];
	const z = zone(["A", "B", "GHOST"], nodes);
	// "GHOST" has no setRect at all (e.g. a tag that never got a root
	// cluster) — the full {A,B,GHOST} intersection is undefined, but
	// {A,B} is real and should be used as the cascade fallback.
	const setRects = new Map<string, RegionRect>([
		["A", { setKey: "A", x: 0, y: 0, w: 200, h: 200 }],
		["B", { setKey: "B", x: 50, y: 50, w: 200, h: 200 }],
	]);
	const sized: SizedNode[] = nodes.map((n) => ({ ...n, width: 80, height: 24 }));
	const out = placeNodesInRegions([z], setRects, sized, opts);
	ok(out.length === 1, `expected the node to be placed via cascade fallback, not dropped, got ${out.length}`);
}

// Bug 2, second case: the full signature IS geometrically non-degenerate
// per-pair but the literal 3-way AABB intersection is empty (classic
// "pairwise overlap doesn't imply triple overlap" case) — must cascade to
// a real pairwise region rather than being skipped.
{
	const nodes = [node("y0", ["A", "B", "C"])];
	const z = zone(["A", "B", "C"], nodes);
	const setRects = new Map<string, RegionRect>([
		["A", { setKey: "A", x: 0, y: 0, w: 100, h: 100 }],
		["B", { setKey: "B", x: 50, y: 0, w: 100, h: 100 }],
		["C", { setKey: "C", x: 1000, y: 1000, w: 100, h: 100 }],
	]);
	const sized: SizedNode[] = nodes.map((n) => ({ ...n, width: 80, height: 24 }));
	const out = placeNodesInRegions([z], setRects, sized, opts);
	ok(out.length === 1, `expected the degenerate-triple node to cascade to {A,B} instead of being dropped, got ${out.length}`);
}
