import type { GraphNode } from "../types";
import type { SizedNode } from "./layout";

// Sub-group = a maximal set of nodes that share an IDENTICAL membership
// signature. Single-membership clusters produce a sub-group per
// membership; multi-tag combinations produce one sub-group per unique
// combination.
export interface SubGroup {
	memberships: string[]; // sorted
	nodes: GraphNode[];
}

export function groupByMembershipSet(nodes: GraphNode[]): SubGroup[] {
	const m = new Map<string, SubGroup>();
	for (const n of nodes) {
		const sorted = [...n.memberships].sort();
		const key = sorted.join("");
		let sg = m.get(key);
		if (!sg) {
			sg = { memberships: sorted, nodes: [] };
			m.set(key, sg);
		}
		sg.nodes.push(n);
	}
	return [...m.values()];
}

// Pick the "main" cluster for every node. Rule (2026-05-24, latest):
//   main = cluster with the largest total member count among the
//          node's memberships. Ties broken by cluster-key string
//          (alphabetical, smaller wins).
// Returns Map<node id, main cluster key>. Nodes with zero memberships
// are absent from the map.
export function computeMainOf(nodes: GraphNode[]): Map<string, string> {
	const sizes = new Map<string, number>();
	for (const n of nodes) {
		for (const m of n.memberships) {
			sizes.set(m, (sizes.get(m) ?? 0) + 1);
		}
	}
	const out = new Map<string, string>();
	for (const n of nodes) {
		if (n.memberships.length === 0) continue;
		let bestKey = n.memberships[0];
		let bestSize = sizes.get(bestKey) ?? 0;
		for (let i = 1; i < n.memberships.length; i++) {
			const m = n.memberships[i];
			const s = sizes.get(m) ?? 0;
			if (s > bestSize || (s === bestSize && m < bestKey)) {
				bestKey = m;
				bestSize = s;
			}
		}
		out.set(n.id, bestKey);
	}
	return out;
}

// Group nodes by their MAIN cluster (= one sub-group per cluster that
// is the main of at least one node). Cluster anchors then map 1:1 to
// these sub-groups, so the downstream layout naturally places each
// main group at its own anchor and the main-rectangles of distinct
// clusters cannot overlap (provided strideX/Y exceeds the largest
// sub-group's footprint, which the existing layout already enforces).
//
// The SubGroup's `memberships` carries only [main], so multi-tag
// nodes do NOT split across sub-groups — they live entirely inside
// their MAIN cluster's sub-group. Sub-cluster (extra-membership)
// enclosures are computed separately by cluster-bbox.ts.
export function groupByMain(
	nodes: GraphNode[],
	mainOf: Map<string, string>,
): SubGroup[] {
	const m = new Map<string, SubGroup>();
	for (const n of nodes) {
		const main = mainOf.get(n.id);
		if (!main) continue;
		let sg = m.get(main);
		if (!sg) {
			sg = { memberships: [main], nodes: [] };
			m.set(main, sg);
		}
		sg.nodes.push(n);
	}
	return [...m.values()];
}

export function isSubset<T>(small: Set<T>, big: Set<T>): boolean {
	if (small.size > big.size) return false;
	for (const v of small) if (!big.has(v)) return false;
	return true;
}

export function fallbackSize(n: GraphNode): SizedNode {
	return { ...n, width: 80, height: 24 };
}

// Shelf-pack cards into rows until the row would exceed a sqrt-area
// target, then wrap. Returned positions are top-left-relative card
// CENTRES (i.e. each position is the centre of one card).
export function shelfPack(
	sizes: SizedNode[],
	gap: number,
): {
	positions: { x: number; y: number }[];
	width: number;
	height: number;
} {
	if (sizes.length === 0) return { positions: [], width: 32, height: 24 };
	let totalArea = 0;
	let maxCardW = 0;
	for (const s of sizes) {
		totalArea += (s.width + gap) * (s.height + gap);
		if (s.width > maxCardW) maxCardW = s.width;
	}
	const targetW = Math.max(
		maxCardW,
		Math.ceil(Math.sqrt(totalArea) * 1.15),
	);
	const positions: { x: number; y: number }[] = new Array<{ x: number; y: number }>(sizes.length);
	let curX = 0;
	let curY = 0;
	let rowH = 0;
	let maxEnd = 0;
	for (let i = 0; i < sizes.length; i++) {
		const s = sizes[i];
		if (curX > 0 && curX + s.width > targetW) {
			curY += rowH + gap;
			curX = 0;
			rowH = 0;
		}
		positions[i] = { x: curX + s.width / 2, y: curY + s.height / 2 };
		curX += s.width + gap;
		if (s.height > rowH) rowH = s.height;
		if (curX - gap > maxEnd) maxEnd = curX - gap;
	}
	return { positions, width: maxEnd, height: curY + rowH };
}
