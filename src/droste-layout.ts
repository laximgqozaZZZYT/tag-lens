import type { GraphData, GraphNode } from "./types";
import { NONE_BUCKET } from "./types";

// Print Gallery strip layout (spec §4 + §2.1). The membership hierarchy spirals
// into itself: ONE TURN (v: 0 → 2π) is ONE hierarchy slice, and the RECURSION
// lives in the turns (the renderer draws turn m at scale k^m). Each turn packs
// its cells CONTIGUOUSLY around the full ring with a per-turn uniform square cell
// Δ_m = 2π / N_m (no fixed π/2 quadrants — that left empty arcs); the four roles
// keep their ORDER as contiguous bands sized by element count:
//
//   ① focus + sibling notes      (kind: node; the focus is the first cell ⇒ v=0)
//   ② focus's cluster(s)         (kind: cluster)
//   ③ sibling clusters           (co-occurring first; fall back to others if none)
//   ④ "↻" bridge → next turn's focus
//
// Turn 0's focus is the node N; turn s+1 re-roots on an unvisited sibling cluster
// of turn s. The chain N→C1…Ck is finite; the renderer cycles slices[m mod L] and
// slice i's ④ bridge points to chain[(i+1) mod L], so the LAST turn loops back to
// N — a self-referential Droste loop. Cells are Δ×Δ squares in ζ-space (§2.1);
// the conformal map z=R₀·exp(γζ) is untouched.
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
	uBase: number; // inner u offset of the cell row (fit reference)
}

export interface DrosteLayoutOpts {
	focusId?: string;
	labels?: Map<string, string>; // cluster key → human label
	cols?: number; // per-role cap (cells per role before "+N" overflow)
	maxSlices?: number; // cap on distinct hierarchy slices in the focus chain
}

const TWO_PI = 2 * Math.PI;
const U_BASE = 0.04; // inner u offset — small so the central core/hollow stays tight

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
	candidates: string[]; // ordered cluster keys for the next focus (③ order)
}

export function layoutDroste(data: GraphData, opts: DrosteLayoutOpts = {}): DrosteMeta {
	const cap = Math.max(1, Math.floor(opts.cols ?? 8));
	const maxSlices = Math.max(1, Math.floor(opts.maxSlices ?? 8));
	const labels = opts.labels ?? new Map<string, string>();
	const clusterLabel = (key: string): string => labels.get(key) ?? key;
	const nodes = data.nodes;

	const clusterMembers = new Map<string, GraphNode[]>();
	const allClusters: string[] = [];
	for (const n of nodes) {
		for (const m of n.memberships) {
			const arr = clusterMembers.get(m);
			if (arr) arr.push(n);
			else {
				clusterMembers.set(m, [n]);
				allClusters.push(m);
			}
		}
	}

	let focusId = opts.focusId && nodes.some((n) => n.id === opts.focusId) ? opts.focusId : "";
	if (!focusId) {
		const tagged = nodes.find((n) => n.memberships.some((m) => m !== NONE_BUCKET));
		focusId = (tagged ?? nodes[0])?.id ?? "";
	}
	const focusNode = nodes.find((n) => n.id === focusId);
	if (!focusNode) return { slices: [], focusId, uBase: U_BASE };

	const noteItem = (n: GraphNode): Item => ({ id: n.id, label: n.label, hueKey: n.memberships[0] ?? n.id, kind: "node" });
	const clusItem = (c: string): Item => ({ id: c, label: clusterLabel(c), hueKey: c, kind: "cluster" });

	// Sibling clusters = OTHER memberships of the member notes (co-occurring tags).
	const siblingsOf = (set: Set<string>, members: GraphNode[]): string[] => {
		const sib: string[] = [];
		const seen = new Set<string>();
		for (const n of members) for (const m of n.memberships) {
			if (!set.has(m) && !seen.has(m)) { seen.add(m); sib.push(m); }
		}
		return sib;
	};

	// (A) ③ = co-occurring siblings FIRST; only if empty, fall back to other clusters.
	const contentFor = (f: Focus): SliceContent => {
		if (f.isNode) {
			let fc = focusNode.memberships.filter((m) => m !== NONE_BUCKET);
			if (fc.length === 0) fc = [...focusNode.memberships];
			const set = new Set(fc);
			const peers = nodes.filter((n) => n.id === f.id || n.memberships.some((m) => set.has(m)));
			let threes = siblingsOf(set, peers);
			if (threes.length === 0) threes = allClusters.filter((c) => !set.has(c));
			return {
				ones: [noteItem(focusNode), ...peers.filter((n) => n.id !== f.id).map(noteItem)],
				twos: fc.map(clusItem),
				threes: threes.map(clusItem),
				candidates: threes,
			};
		}
		const members = clusterMembers.get(f.id) ?? [];
		const set = new Set([f.id]);
		let threes = siblingsOf(set, members);
		if (threes.length === 0) threes = allClusters.filter((c) => c !== f.id);
		return {
			ones: members.map(noteItem),
			twos: [clusItem(f.id)],
			threes: threes.map(clusItem),
			candidates: threes,
		};
	};

	// Build the finite focus chain by descending into unvisited candidate clusters.
	const chain: Focus[] = [];
	const contents: SliceContent[] = [];
	const visited = new Set<string>();
	let cur: Focus = { id: focusId, label: focusNode.label, hueKey: focusNode.memberships[0] ?? focusId, isNode: true };
	focusNode.memberships.filter((m) => m !== NONE_BUCKET).forEach((c) => visited.add(c));
	while (chain.length < maxSlices) {
		const c = contentFor(cur);
		chain.push(cur);
		contents.push(c);
		const next = c.candidates.find((k) => !visited.has(k));
		if (next === undefined) break;
		visited.add(next);
		cur = { id: next, label: clusterLabel(next), hueKey: next, isNode: false };
	}
	const L = chain.length;

	// Cap one role to `cap` cells (overflow → "+N"), tagging each with its level.
	const capRole = (items: Item[], level: 1 | 2 | 3, tag: string): (Item & { level: 1 | 2 | 3 | 4 })[] => {
		let shown = items;
		if (items.length > cap) {
			shown = [...items.slice(0, cap - 1), { id: `__more_${tag}`, label: `+${items.length - cap + 1}`, hueKey: "more", kind: "cluster" }];
		}
		return shown.map((it) => ({ ...it, level }));
	};

	// (B) Compact contiguous fill: concat roles in order, place as N_m equal Δ_m
	// square cells around the full [0, 2π). Roles keep their order (the climb
	// reads); widths are proportional to capped counts; the focus is cell 0 ⇒ v=0.
	const slices = contents.map((c, i): DrosteBandElement[] => {
		const next = chain[(i + 1) % L];
		const seq: (Item & { level: 1 | 2 | 3 | 4 })[] = [
			...capRole(c.ones, 1, `${i}n`),
			...capRole(c.twos, 2, `${i}c`),
			...capRole(c.threes, 3, `${i}s`),
			{ id: `__loop_${i}`, label: `↻ ${next.label}`, hueKey: next.hueKey, kind: "node", level: 4 },
		];
		const d = TWO_PI / seq.length;
		return seq.map((s, j) => ({
			id: s.id,
			kind: s.kind,
			label: s.label,
			hueKey: s.hueKey,
			level: s.level,
			u0: U_BASE,
			u1: U_BASE + d,
			v0: j * d,
			v1: (j + 1) * d,
		}));
	});

	return { slices, focusId, uBase: U_BASE };
}

// Invariant (spec §2.1): every tile is a SQUARE in ζ-space (Δu = Δv) and lies in
// [0, 2π). maxAspectGap = 0 ⇒ perfectly square cells.
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

// Visual-seam check (spec §3): each turn must fill [0, 2π) CONTIGUOUSLY so no empty
// arc breaks the spiral and turn m's v=2π⁻ abuts turn m+1's v=0⁺. maxGap = 0 ⇒ the
// cells tile the ring without gaps. Returns the worst gap over all turns.
export function assertTurnsFilled(meta: DrosteMeta): { maxGap: number } {
	let maxGap = 0;
	for (const slice of meta.slices) {
		if (slice.length === 0) continue;
		const sorted = [...slice].sort((a, b) => a.v0 - b.v0);
		maxGap = Math.max(maxGap, Math.abs(sorted[0].v0 - 0));
		for (let i = 1; i < sorted.length; i++) maxGap = Math.max(maxGap, Math.abs(sorted[i].v0 - sorted[i - 1].v1));
		maxGap = Math.max(maxGap, Math.abs(TWO_PI - sorted[sorted.length - 1].v1));
	}
	return { maxGap };
}
