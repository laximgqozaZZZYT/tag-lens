// In bubblesets mode the cross-cutting tag enclosures intentionally overlap,
// so their independently-computed label cells could land on top of each other
// (real-device screenshots showed `host`/`inferno`/`timeline` tag names
// overlapping). layoutEulerTrue must de-conflict labelCells for bubblesets so
// no two cells overlap, while euler-true (and every other mode) keeps its
// labelCells byte-identical.
// See docs/superpowers/specs/2026-06-22-bubblesets-label-collision-design.md.
import { ok } from "./assert";
import { layout, type SizedNode, type LayoutOptions } from "../src/layout/layout";
import type { GraphData, GraphNode, ViewMode } from "../src/types";

function makeData(): GraphData {
	const n = (id: string, tags: string[]): GraphNode => ({ id, label: id, memberships: tags });
	// Three multi-member tags that heavily share members -> their boxes overlap
	// in bubblesets, so their top-left-strip label cells would collide.
	return {
		nodes: [
			n("a1", ["host"]), n("a2", ["host"]), n("a3", ["host"]),
			n("b1", ["inferno"]), n("b2", ["inferno"]), n("b3", ["inferno"]),
			n("c1", ["timeline"]), n("c2", ["timeline"]), n("c3", ["timeline"]),
			n("s1", ["host", "inferno"]), n("s2", ["host", "inferno"]),
			n("s3", ["host", "timeline"]), n("s4", ["inferno", "timeline"]),
			n("s5", ["host", "inferno", "timeline"]),
		],
		edges: [],
	};
}
const sizedFrom = (d: GraphData): SizedNode[] => d.nodes.map((n) => ({ ...n, width: 40, height: 24 }));
function opts(viewMode: ViewMode): LayoutOptions {
	return {
		clusterSpacing: 80, nodeSpacing: 16, cellW: 40, cellH: 24, minFontPx: 8,
		clusterLabels: new Map<string, string>(), anchorPlacement: "concentric", viewMode,
		bipartiteMaxTags: 80, bipartiteLayout: "concentric",
	} as LayoutOptions;
}

type Cell = { key: string; x: number; y: number; w: number; h: number };
function cellAabb(c: Cell) {
	return { x1: c.x - c.w / 2, y1: c.y - c.h / 2, x2: c.x + c.w / 2, y2: c.y + c.h / 2 };
}
function overlaps(a: ReturnType<typeof cellAabb>, b: ReturnType<typeof cellAabb>): boolean {
	return a.x1 < b.x2 - 0.01 && a.x2 > b.x1 + 0.01 && a.y1 < b.y2 - 0.01 && a.y2 > b.y1 + 0.01;
}

const d = makeData();

// bubblesets: no two label cells may overlap after de-confliction.
{
	const r = layout(d, sizedFrom(d), opts("bubblesets"));
	const cells = (r.labelCells ?? []) as Cell[];
	ok(cells.length >= 2, `[bubblesets] fixture must yield >=2 label cells, got ${cells.length}`);
	for (let i = 0; i < cells.length; i++) {
		for (let j = i + 1; j < cells.length; j++) {
			ok(
				!overlaps(cellAabb(cells[i]), cellAabb(cells[j])),
				`[bubblesets] label cells ${cells[i].key}/${cells[j].key} must not overlap, got ${JSON.stringify({ a: cells[i], b: cells[j] })}`,
			);
		}
	}
}

// euler-true: labelCells are deterministic AND byte-identical across runs (the
// bubblesets-only de-confliction pass must not touch any other mode).
{
	const r1 = layout(d, sizedFrom(d), opts("euler-true"));
	const r2 = layout(d, sizedFrom(d), opts("euler-true"));
	const c1 = (r1.labelCells ?? []) as Cell[];
	const c2 = (r2.labelCells ?? []) as Cell[];
	ok(c1.length === c2.length && c1.length > 0, "[euler-true] label cells deterministic count");
	for (let i = 0; i < c1.length; i++) {
		ok(
			c1[i].key === c2[i].key &&
				c1[i].x === c2[i].x && c1[i].y === c2[i].y &&
				c1[i].w === c2[i].w && c1[i].h === c2[i].h,
			`[euler-true] label cell ${i} byte-identical across runs (unchanged)`,
		);
	}
}
