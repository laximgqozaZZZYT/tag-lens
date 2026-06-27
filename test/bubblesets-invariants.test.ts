// BubbleSets layout INVARIANTS — the structural properties the layout must
// always satisfy, encoded once so they are checked by `npm test` instead of by
// eye on every change. These are exactly the checks that were repeatedly run by
// hand (throwaway `_diag.ts` probes) while building the grid-aligned Euler
// layout;固定化 prevents silent regressions and removes the manual
// screenshot round-trip from the dev loop.
//
// Properties asserted, per representative dataset, in bubblesets mode:
//   1. No FOREIGN node inside any tag's box (a box contains only its members).
//   2. Every card sits on a grid-CELL CENTRE (方眼整列).
//   3. Zero pairwise node-node overlap.
//   4. Every box edge lies on a grid LINE (cards and boxes share the grid).
//   5. No two OVERLAPPING boxes share an edge line (outlines never merge).
//   6. Every cluster label sits inside its box's INNER TOP-RIGHT region.
//   7. The whole figure's pixel aspect ratio stays roughly square (0.4–2.5).
import { ok } from "./assert";
import { layout, type SizedNode, type LayoutOptions } from "../src/layout/layout";
import type { GraphData, GraphNode } from "../src/types";

function opts(): LayoutOptions {
	// Real deployed card geometry (CARD_CELL_W/H are 270×72 in types.ts), so the
	// invariants are checked at the size users actually see.
	return {
		clusterSpacing: 80,
		nodeSpacing: 1,
		cellW: 270,
		cellH: 72,
		minFontPx: 10,
		clusterLabels: new Map<string, string>(),
		anchorPlacement: "concentric",
		viewMode: "bubblesets",
	} as LayoutOptions;
}

interface Box { x: number; y: number; w: number; h: number }
function mainOf(c: { pieces?: { kind: string; contour?: boolean; x: number; y: number; w: number; h: number }[] }): Box | null {
	const m = c.pieces?.find((p) => p.kind === "main" && !p.contour);
	return m ? { x: m.x, y: m.y, w: m.w, h: m.h } : null;
}
function gridAligned(v: number, step: number): boolean {
	const r = Math.abs((v / step) % 1);
	return r < 0.02 || r > 0.98;
}

// Run the layout for a dataset and assert all 7 invariants. `label` names the
// scenario in failure messages.
function check(label: string, nodes: GraphNode[], clusterLabels: Map<string, string>): void {
	const data: GraphData = { nodes, edges: [] };
	const sized: SizedNode[] = nodes.map((n) => ({ ...n, width: 270, height: 72 }));
	const o = opts();
	o.clusterLabels = clusterLabels;
	const out = layout(data, sized, o);
	const slotW = out.slotW;
	const slotH = out.slotH;
	const memById = new Map(nodes.map((n) => [n.id, new Set(n.memberships)]));
	const clusters = out.clusters;
	const mains = clusters
		.map((c) => ({ key: c.groupKey, m: mainOf(c) }))
		.filter((e): e is { key: string; m: Box } => !!e.m);

	// 1. No foreign node inside any box.
	for (const { key, m } of mains) {
		let foreign = 0;
		for (const n of out.nodes) {
			if (n.x > m.x && n.x < m.x + m.w && n.y > m.y && n.y < m.y + m.h && !memById.get(n.id)!.has(key)) {
				foreign++;
			}
		}
		ok(foreign === 0, `[${label}] box "${key}" contains ${foreign} foreign (non-member) node(s)`);
	}

	// 2. Cards on grid-cell centres.
	let offGrid = 0;
	for (const n of out.nodes) {
		if (!gridAligned(n.x / slotW - 0.5, 1) || !gridAligned(n.y / slotH - 0.5, 1)) offGrid++;
	}
	ok(offGrid === 0, `[${label}] ${offGrid} card(s) not on a grid-cell centre`);

	// 3. Zero node-node overlap.
	let nn = 0;
	for (let i = 0; i < out.nodes.length; i++) {
		for (let j = i + 1; j < out.nodes.length; j++) {
			const a = out.nodes[i], b = out.nodes[j];
			if ((a.width + b.width) / 2 - Math.abs(a.x - b.x) > 0.5 && (a.height + b.height) / 2 - Math.abs(a.y - b.y) > 0.5) nn++;
		}
	}
	ok(nn === 0, `[${label}] ${nn} overlapping node pair(s)`);

	// 4. Box edges on grid lines.
	let nonGrid = 0;
	for (const { m } of mains) {
		if (!gridAligned(m.x, slotW) || !gridAligned(m.x + m.w, slotW) || !gridAligned(m.y, slotH) || !gridAligned(m.y + m.h, slotH)) nonGrid++;
	}
	ok(nonGrid === 0, `[${label}] ${nonGrid} box(es) with non-grid-aligned edges`);

	// 5. No overlapping box pair shares an edge line.
	let coincident = 0;
	for (let i = 0; i < mains.length; i++) {
		for (let j = i + 1; j < mains.length; j++) {
			const a = mains[i].m, b = mains[j].m;
			const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
			const sharesEdge =
				Math.abs(a.x - b.x) < 1 || Math.abs(a.x + a.w - (b.x + b.w)) < 1 ||
				Math.abs(a.y - b.y) < 1 || Math.abs(a.y + a.h - (b.y + b.h)) < 1;
			if (overlap && sharesEdge) coincident++;
		}
	}
	ok(coincident === 0, `[${label}] ${coincident} overlapping box pair(s) share an edge (outlines merge)`);

	// 6. Labels in the inner top-right.
	const lcs = out.labelCells ?? [];
	let badLabel = 0;
	for (const lc of lcs) {
		const c = clusters.find((cc) => cc.groupKey === lc.key);
		const m = c ? mainOf(c) : null;
		if (!m) continue;
		const inTopHalf = lc.y < m.y + m.h / 2;
		const inRightHalf = lc.x > m.x + m.w / 2;
		if (!(inTopHalf && inRightHalf)) badLabel++;
	}
	ok(badLabel === 0, `[${label}] ${badLabel} label(s) not in the inner top-right of their box`);

	// 7. Roughly-square figure aspect.
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const { m } of mains) {
		minX = Math.min(minX, m.x); minY = Math.min(minY, m.y);
		maxX = Math.max(maxX, m.x + m.w); maxY = Math.max(maxY, m.y + m.h);
	}
	const aspect = (maxX - minX) / Math.max(1, maxY - minY);
	ok(aspect >= 0.4 && aspect <= 2.5, `[${label}] figure aspect ${aspect.toFixed(2)} outside [0.4, 2.5] (not roughly square)`);
}

// --- Dataset A: universal + laminar (the user's filtered-view shape) ---
// _all/timeline/act are all 54 (identical, universal); drama=8, wisdom=2⊂drama.
{
	const nodes: GraphNode[] = [];
	let i = 0;
	const mk = (extra: string[]) => nodes.push({ id: `a${i++}`, label: `a`, memberships: ["_all", "timeline", "act", ...extra] });
	for (let k = 0; k < 44; k++) mk([]);
	for (let k = 0; k < 6; k++) mk(["drama"]);
	for (let k = 0; k < 2; k++) mk(["drama", "wisdom"]);
	check("universal+laminar", nodes, new Map([["_all", "_all"], ["timeline", "timeline"], ["act", "act"], ["drama", "drama"], ["wisdom", "wisdom"]]));
}

// --- Dataset B: genuine 3-way Venn (A,B,C cross-cutting, all 7 regions) ---
{
	const nodes: GraphNode[] = [];
	let i = 0;
	const add = (tags: string[]) => { for (let k = 0; k < 4; k++) nodes.push({ id: `b${i++}`, label: `b`, memberships: tags.slice() }); };
	add(["A"]); add(["B"]); add(["C"]);
	add(["A", "B"]); add(["A", "C"]); add(["B", "C"]); add(["A", "B", "C"]);
	check("3-way-venn", nodes, new Map([["A", "A"], ["B", "B"], ["C", "C"]]));
}

// --- Dataset C: disjoint leaves under one universal tag ---
{
	const nodes: GraphNode[] = [];
	let i = 0;
	const mk = (extra: string[]) => nodes.push({ id: `c${i++}`, label: `c`, memberships: ["all", ...extra] });
	for (let k = 0; k < 5; k++) mk(["x"]);
	for (let k = 0; k < 5; k++) mk(["y"]);
	for (let k = 0; k < 5; k++) mk(["z"]);
	check("disjoint-leaves", nodes, new Map([["all", "all"], ["x", "x"], ["y", "y"], ["z", "z"]]));
}
