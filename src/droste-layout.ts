import type { GraphData, GraphNode } from "./types";
import { NONE_BUCKET } from "./types";

// Print Gallery TRUE self-similarity (spec §4, revision 2026-05-31). There is ONE
// hierarchy slice. The renderer draws it at m = 0, 1, 2, … via `v += 2π·m`, each
// copy a ×k reduction of the SAME picture nested inside the last — the Escher
// "image contains itself" structure. `z(ζ+2πi) = k·z(ζ)` makes the outer slice and
// its nested copies continuous. No per-turn re-rooting / drill-down (that was the
// round-6 mistake: it nested a DIFFERENT picture, not a self-similar one).
//
// The single slice fills the full ring with contiguous square bands (§2.1):
//   ① focus N + its sibling notes   (kind: node; N is the first cell ⇒ v = 0)
//   ② N's cluster(s)                (kind: cluster)
//   ③ the other clusters            (kind: cluster; capped → "+N")
//   ④ "↻ N" bridge                  (self-reference: the nested copy is N again)
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
	// The single hierarchy slice repeated by the renderer as slices[m mod 1] at
	// scale k^m. (Kept as a one-element array so draw-droste / hit-test, which
	// already cycle `slices[m mod L]`, need no change.)
	slices: DrosteBandElement[][];
	focusId: string;
	uBase: number; // inner u offset of the cell row (fit reference)
}

export interface DrosteLayoutOpts {
	focusId?: string;
	labels?: Map<string, string>; // cluster key → human label
	cols?: number; // per-role cap (cells per role before "+N" overflow)
}

const TWO_PI = 2 * Math.PI;
const U_BASE = 0.04; // inner u offset — small so the central core/hollow stays tight

interface Item {
	id: string;
	label: string;
	hueKey: string;
	kind: "node" | "cluster";
}

export function layoutDroste(data: GraphData, opts: DrosteLayoutOpts = {}): DrosteMeta {
	const cap = Math.max(1, Math.floor(opts.cols ?? 8));
	const labels = opts.labels ?? new Map<string, string>();
	const clusterLabel = (key: string): string => labels.get(key) ?? key;
	const nodes = data.nodes;

	// Focus N: drosteFocus if valid; else first node with a real (non-NONE)
	// membership; else first node. (Click-to-re-root just sets drosteFocus and
	// rebuilds — re-centres the whole self-similar spiral on the new N; §5.)
	let focusId = opts.focusId && nodes.some((n) => n.id === opts.focusId) ? opts.focusId : "";
	if (!focusId) {
		const tagged = nodes.find((n) => n.memberships.some((m) => m !== NONE_BUCKET));
		focusId = (tagged ?? nodes[0])?.id ?? "";
	}
	const focusNode = nodes.find((n) => n.id === focusId);
	if (!focusNode) return { slices: [], focusId, uBase: U_BASE };

	const noteItem = (n: GraphNode): Item => ({ id: n.id, label: n.label, hueKey: n.memberships[0] ?? n.id, kind: "node" });
	const clusItem = (c: string): Item => ({ id: c, label: clusterLabel(c), hueKey: c, kind: "cluster" });

	// Classify from N's memberships (no recursion / visited / fallback needed).
	let fc = focusNode.memberships.filter((m) => m !== NONE_BUCKET);
	if (fc.length === 0) fc = [...focusNode.memberships];
	const focusClusters = new Set(fc);
	const peers = nodes.filter((n) => n.id === focusId || n.memberships.some((m) => focusClusters.has(m)));
	const allClusters: string[] = [];
	const seenC = new Set<string>();
	for (const n of nodes) for (const m of n.memberships) if (!seenC.has(m)) { seenC.add(m); allClusters.push(m); }
	const otherClusters = allClusters.filter((c) => !focusClusters.has(c));

	// ① focus + sibling notes (N first ⇒ v=0), ② N's clusters, ③ other clusters.
	const ones: Item[] = [noteItem(focusNode), ...peers.filter((n) => n.id !== focusId).map(noteItem)];
	const twos: Item[] = fc.map(clusItem);
	const threes: Item[] = otherClusters.map(clusItem);

	// Cap a role to `cap` cells (overflow → "+N"), tagging each with its level.
	const capRole = (items: Item[], level: 1 | 2 | 3, tag: string): (Item & { level: 1 | 2 | 3 | 4 })[] => {
		let shown = items;
		if (items.length > cap) {
			shown = [...items.slice(0, cap - 1), { id: `__more_${tag}`, label: `+${items.length - cap + 1}`, hueKey: "more", kind: "cluster" }];
		}
		return shown.map((it) => ({ ...it, level }));
	};

	// Compact contiguous fill (§2.1): roles in order ①②③④ as N_m equal Δ square
	// cells around the full [0, 2π); ④ is a self-referential "↻ N" bridge.
	const seq: (Item & { level: 1 | 2 | 3 | 4 })[] = [
		...capRole(ones, 1, "n"),
		...capRole(twos, 2, "c"),
		...capRole(threes, 3, "s"),
		{ id: "__loop", label: `↻ ${focusNode.label}`, hueKey: focusNode.memberships[0] ?? focusId, kind: "node", level: 4 },
	];
	const d = TWO_PI / seq.length;
	const slice: DrosteBandElement[] = seq.map((s, j) => ({
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

	return { slices: [slice], focusId, uBase: U_BASE };
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

// Visual-seam check (spec §3): the slice must fill [0, 2π) CONTIGUOUSLY so no empty
// arc breaks the spiral and the nested ×k copies abut. maxGap = 0 ⇒ gap-free.
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
