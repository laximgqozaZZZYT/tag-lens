import type { GraphData, GraphNode } from "./types";
import { NONE_BUCKET } from "./types";

// Print Gallery strip layout (spec §4 + §2.1). The membership hierarchy spirals
// into itself: ONE TURN (v: 0 → 2π) is ONE hierarchy slice with four quadrants,
// and the RECURSION lives in the turns (the renderer draws turn m at scale k^m):
//
//   ① v ∈ [0,   π/2)  the slice focus + its sibling notes   (kind: node)
//   ② v ∈ [π/2, π)    the focus's cluster(s)                (kind: cluster)
//   ③ v ∈ [π,  3π/2)  the focus's SIBLING clusters (co-occurring, not all)
//   ④ v ∈ [3π/2, 2π)  transition bridge → the NEXT turn's focus
//
// Turn 0's focus is the node N; turn s+1 re-roots on an unvisited sibling cluster
// of turn s. The chain N→C1→…→Ck is finite (clusters run out — the hierarchy is
// ~2-tier); the renderer cycles slices[m mod L], and slice i's ④ bridge points to
// chain[(i+1) mod L], so the LAST turn loops back to N — a self-referential Droste
// loop (termination option (b)). N sits at (u=uBase, v=0). Cells are Δ×Δ squares
// in ζ-space (§2.1); the conformal map z=R₀·exp(γζ) is untouched.
export interface DrosteBandElement {
	id: string;
	kind: "node" | "cluster";
	label: string;
	hueKey: string; // key for clusterHue()
	level: 1 | 2 | 3 | 4;
	u0: number;
	u1: number;
	v0: number;
	v1: number;
}

export interface DrosteMeta {
	// One element array per TURN (hierarchy slice). The renderer draws turn m as
	// slices[m mod slices.length] at scale k^m. Empty ⇒ nothing to draw.
	slices: DrosteBandElement[][];
	focusId: string;
	cell: number; // Δ — uniform square-cell size in ζ-space (Δu = Δv)
}

export interface DrosteLayoutOpts {
	focusId?: string;
	labels?: Map<string, string>; // cluster key → human label
	cols?: number; // columns per quadrant; Δ = (π/2)/cols
	maxSlices?: number; // cap on distinct hierarchy slices in the focus chain
}

const TWO_PI = 2 * Math.PI;
const QUAD = TWO_PI / 4;

interface Item {
	id: string;
	label: string;
	hueKey: string;
	kind: "node" | "cluster";
}
interface Focus {
	id: string;
	label: string;
	hueKey: string;
	isNode: boolean;
}
interface SliceContent {
	ones: Item[];
	twos: Item[];
	threes: Item[];
	siblingKeys: string[]; // candidate clusters to descend into (③)
}

export function layoutDroste(data: GraphData, opts: DrosteLayoutOpts = {}): DrosteMeta {
	const cols = Math.max(1, Math.floor(opts.cols ?? 8));
	const maxSlices = Math.max(1, Math.floor(opts.maxSlices ?? 8));
	const cell = QUAD / cols;
	const uBase = cell;
	const labels = opts.labels ?? new Map<string, string>();
	const clusterLabel = (key: string): string => labels.get(key) ?? key;
	const nodes = data.nodes;

	const clusterMembers = new Map<string, GraphNode[]>();
	for (const n of nodes) {
		for (const m of n.memberships) {
			const arr = clusterMembers.get(m);
			if (arr) arr.push(n);
			else clusterMembers.set(m, [n]);
		}
	}

	// Focus N: drosteFocus if valid; else first node with a real (non-NONE)
	// membership; else first node.
	let focusId = opts.focusId && nodes.some((n) => n.id === opts.focusId) ? opts.focusId : "";
	if (!focusId) {
		const tagged = nodes.find((n) => n.memberships.some((m) => m !== NONE_BUCKET));
		focusId = (tagged ?? nodes[0])?.id ?? "";
	}
	const focusNode = nodes.find((n) => n.id === focusId);
	if (!focusNode) return { slices: [], focusId, cell };

	const noteItem = (n: GraphNode): Item => ({ id: n.id, label: n.label, hueKey: n.memberships[0] ?? n.id, kind: "node" });
	const clusItem = (c: string): Item => ({ id: c, label: clusterLabel(c), hueKey: c, kind: "cluster" });

	// Sibling clusters of a cluster set = the OTHER memberships of the member
	// notes (co-occurring tags), excluding the set itself. This is what ③ shows
	// — NOT every cluster in the vault.
	const siblingsOf = (clusterSet: Set<string>, members: GraphNode[]): string[] => {
		const sib = new Set<string>();
		for (const n of members) for (const m of n.memberships) if (!clusterSet.has(m)) sib.add(m);
		return [...sib];
	};

	const contentFor = (f: Focus): SliceContent => {
		if (f.isNode) {
			let fc = focusNode.memberships.filter((m) => m !== NONE_BUCKET);
			if (fc.length === 0) fc = [...focusNode.memberships];
			const set = new Set(fc);
			const peers = nodes.filter((n) => n.id === f.id || n.memberships.some((m) => set.has(m)));
			const sib = siblingsOf(set, peers);
			return {
				ones: [noteItem(focusNode), ...peers.filter((n) => n.id !== f.id).map(noteItem)],
				twos: fc.map(clusItem),
				threes: sib.map(clusItem),
				siblingKeys: sib,
			};
		}
		const members = clusterMembers.get(f.id) ?? [];
		const set = new Set([f.id]);
		const sib = siblingsOf(set, members);
		return {
			ones: members.map(noteItem),
			twos: [clusItem(f.id)],
			threes: sib.map(clusItem),
			siblingKeys: sib,
		};
	};

	// Build the finite focus chain by descending into unvisited sibling clusters.
	const chain: Focus[] = [];
	const contents: SliceContent[] = [];
	const visited = new Set<string>(); // clusters already used as a focus
	let cur: Focus = { id: focusId, label: focusNode.label, hueKey: focusNode.memberships[0] ?? focusId, isNode: true };
	focusNode.memberships.filter((m) => m !== NONE_BUCKET).forEach((c) => visited.add(c));
	while (chain.length < maxSlices) {
		const c = contentFor(cur);
		chain.push(cur);
		contents.push(c);
		const next = c.siblingKeys.find((k) => !visited.has(k));
		if (next === undefined) break;
		visited.add(next);
		cur = { id: next, label: clusterLabel(next), hueKey: next, isNode: false };
	}
	const L = chain.length;

	// One square row per quadrant; overflow → "+N". All slices share u (the turn
	// = scale axis lives in the renderer's copy offset, not in u).
	const put = (els: DrosteBandElement[], items: Item[], level: 1 | 2 | 3, qStart: number, tag: string): void => {
		let shown = items;
		if (items.length > cols) {
			shown = [
				...items.slice(0, cols - 1),
				{ id: `__more_${tag}`, label: `+${items.length - cols + 1}`, hueKey: "more", kind: "cluster" },
			];
		}
		shown.forEach((it, i) => {
			const v0 = qStart + i * cell;
			els.push({ ...it, level, u0: uBase, u1: uBase + cell, v0, v1: v0 + cell });
		});
	};

	const slices = contents.map((c, i): DrosteBandElement[] => {
		const els: DrosteBandElement[] = [];
		put(els, c.ones, 1, 0 * QUAD, `${i}_1`);
		put(els, c.twos, 2, 1 * QUAD, `${i}_2`);
		put(els, c.threes, 3, 2 * QUAD, `${i}_3`);
		// (4) ④ bridge → the NEXT turn's focus (wraps to chain[0]=N on the last).
		const next = chain[(i + 1) % L];
		els.push({
			id: `__loop_${i}`,
			label: `↻ ${next.label}`,
			hueKey: next.hueKey,
			kind: "node",
			level: 4,
			u0: uBase,
			u1: uBase + cell,
			v0: 3 * QUAD,
			v1: 3 * QUAD + cell,
		});
		return els;
	});

	return { slices, focusId, cell };
}

// Approach B invariant (spec §2.1): every tile is a SQUARE in ζ-space (Δu = Δv)
// and lies within one period [0, 2π). The per-turn cell GRID is identical, so the
// seam L(u,0)=L(u,2π) closes geometrically even though slice CONTENT differs per
// turn (only the labels change — the Print Gallery effect). maxAspectGap = 0 ⇒
// perfectly square cells.
export function assertCellsSquare(meta: DrosteMeta): {
	maxAspectGap: number;
	allWithinPeriod: boolean;
} {
	let maxAspectGap = 0;
	let allWithinPeriod = true;
	for (const slice of meta.slices) {
		for (const e of slice) {
			maxAspectGap = Math.max(maxAspectGap, Math.abs((e.u1 - e.u0) - (e.v1 - e.v0)));
			if (e.v0 < 0 || e.v1 > TWO_PI + 1e-9) allWithinPeriod = false;
		}
	}
	return { maxAspectGap, allWithinPeriod };
}
