import type { GraphData, GraphNode } from "./types";
import { NONE_BUCKET } from "./types";

// Print Gallery strip layout (spec §4 + §2.1). The membership hierarchy spirals
// into itself: each radial RING (one Δ-tall row in u) is one hierarchy slice with
// four angular quadrants, and successive rings (s = 0, 1, 2, …) re-root on a
// cluster drawn from the previous ring's ③ — so going outward climbs
// node → its cluster → a sibling cluster → that cluster's world → …
//
//   ① v ∈ [0,   π/2)  the slice focus + its sibling notes   (kind: node)
//   ② v ∈ [π/2, π)    the focus's cluster(s)                (kind: cluster)
//   ③ v ∈ [π,  3π/2)  the other clusters                    (kind: cluster)
//   ④ v ∈ [3π/2, 2π)  transition: a "↻" bridge from ③ back into ①(next focus)
//
// Ring 0's focus is the node N (drosteFocus, else first tagged node); N sits at
// (u = uBase, v = 0) — the bottom-left corner. Cells are Δ×Δ squares in ζ-space
// (§2.1); the conformal map z=R₀·exp(γζ) is untouched and warps them into the
// spiral. The renderer just draws `elements`, so all of this lives here.
export interface DrosteBandElement {
	id: string;
	kind: "node" | "cluster";
	label: string;
	hueKey: string; // key for clusterHue()
	level: 1 | 2 | 3 | 4;
	// Square cell in ζ-space: u1 - u0 === v1 - v0 === cell.
	u0: number;
	u1: number;
	v0: number;
	v1: number;
}

export interface DrosteMeta {
	elements: DrosteBandElement[];
	focusId: string;
	cell: number; // Δ — uniform square-cell size in ζ-space (Δu = Δv)
}

export interface DrosteLayoutOpts {
	focusId?: string;
	labels?: Map<string, string>; // cluster key → human label
	cols?: number; // columns per quadrant; Δ = (π/2)/cols (reused for the u step)
	depth?: number; // number of recursive rings (hierarchy slices) stacked in u
}

const TWO_PI = 2 * Math.PI;
const QUAD = TWO_PI / 4;

interface Item {
	id: string;
	label: string;
	hueKey: string;
	kind: "node" | "cluster";
}

export function layoutDroste(data: GraphData, opts: DrosteLayoutOpts = {}): DrosteMeta {
	const cols = Math.max(1, Math.floor(opts.cols ?? 8));
	const depth = Math.max(1, Math.floor(opts.depth ?? 6));
	const cell = QUAD / cols;
	const uBase = cell;
	const labels = opts.labels ?? new Map<string, string>();
	const clusterLabel = (key: string): string => labels.get(key) ?? key;
	const nodes = data.nodes;

	// Index: cluster → member nodes; the full cluster set.
	const clusterMembers = new Map<string, GraphNode[]>();
	const allClusters = new Set<string>();
	for (const n of nodes) {
		for (const m of n.memberships) {
			allClusters.add(m);
			const arr = clusterMembers.get(m);
			if (arr) arr.push(n);
			else clusterMembers.set(m, [n]);
		}
	}

	// (1) Focus node N. drosteFocus if valid; else first node with a real
	//     (non-NONE) membership; else first node.
	let focusId = opts.focusId && nodes.some((n) => n.id === opts.focusId) ? opts.focusId : "";
	if (!focusId) {
		const tagged = nodes.find((n) => n.memberships.some((m) => m !== NONE_BUCKET));
		focusId = (tagged ?? nodes[0])?.id ?? "";
	}
	const focus = nodes.find((n) => n.id === focusId);

	const noteItem = (n: GraphNode): Item => ({
		id: n.id,
		label: n.label,
		hueKey: n.memberships[0] ?? n.id,
		kind: "node",
	});
	const clusItem = (c: string): Item => ({ id: c, label: clusterLabel(c), hueKey: c, kind: "cluster" });

	const elements: DrosteBandElement[] = [];
	const cap = cols; // one row per quadrant per ring

	// Fill one quadrant of ring `s` with up to `cap` Δ×Δ cells; overflow → "+N".
	const put = (items: Item[], level: 1 | 2 | 3, qStart: number, u0: number, tag: string): void => {
		let shown = items;
		if (items.length > cap) {
			shown = [
				...items.slice(0, cap - 1),
				{ id: `__more_${tag}`, label: `+${items.length - cap + 1}`, hueKey: "more", kind: "cluster" },
			];
		}
		shown.forEach((it, i) => {
			const v0 = qStart + i * cell;
			elements.push({ ...it, level, u0, u1: u0 + cell, v0, v1: v0 + cell });
		});
	};

	// (4) ④ transition bridge cell at the start of [3π/2, 2π).
	const bridge = (s: number, label: string, hueKey: string, u0: number): void => {
		const v0 = 3 * QUAD;
		elements.push({ id: `__loop_${s}`, label: `↻ ${label}`, hueKey, kind: "node", level: 4, u0, u1: u0 + cell, v0, v1: v0 + cell });
	};

	// Build the recursive focus chain, one ring per slice.
	const visited = new Set<string>(); // clusters already used as a ring focus
	// Ring 0: node focus → classify (2).
	let focusClusters = (focus?.memberships ?? []).filter((m) => m !== NONE_BUCKET);
	if (focusClusters.length === 0 && focus) focusClusters = [...focus.memberships];
	focusClusters.forEach((c) => visited.add(c));

	let nextCluster: string | null = null;

	for (let s = 0; s < depth; s++) {
		const u0 = uBase + s * cell;
		let ones: Item[];
		let twos: Item[];
		let threes: Item[];
		let bridgeLabel: string;
		let bridgeHue: string;

		if (s === 0) {
			if (!focus) break;
			// (3) ① focus + sibling notes (N at v=0), ② N's clusters, ③ others.
			const fc = new Set(focusClusters);
			const peers = nodes.filter((n) => n.id === focusId || n.memberships.some((m) => fc.has(m)));
			ones = [noteItem(focus), ...peers.filter((n) => n.id !== focusId).map(noteItem)];
			twos = focusClusters.map(clusItem);
			threes = [...allClusters].filter((c) => !fc.has(c)).map(clusItem);
			bridgeLabel = focus.label;
			bridgeHue = focus.memberships[0] ?? focusId;
			nextCluster = [...allClusters].find((c) => !fc.has(c)) ?? null;
		} else {
			// Recurse: re-root on a cluster drawn from the previous ring's ③.
			if (nextCluster === null) break;
			const cur: string = nextCluster;
			visited.add(cur);
			const members = clusterMembers.get(cur) ?? [];
			ones = members.map(noteItem);
			twos = [clusItem(cur)];
			threes = [...allClusters].filter((x) => x !== cur).map(clusItem);
			bridgeLabel = clusterLabel(cur);
			bridgeHue = cur;
			nextCluster = [...allClusters].find((x) => x !== cur && !visited.has(x)) ?? null;
		}

		put(ones, 1, 0 * QUAD, u0, `${s}_1`);
		put(twos, 2, 1 * QUAD, u0, `${s}_2`);
		put(threes, 3, 2 * QUAD, u0, `${s}_3`);
		bridge(s, bridgeLabel, bridgeHue, u0);
	}

	return { elements, focusId, cell };
}

// Approach B invariant (spec §2.1): every tile is a SQUARE in ζ-space (Δu = Δv)
// and lies within one period [0, 2π). maxAspectGap = 0 ⇒ perfectly square cells.
export function assertCellsSquare(meta: DrosteMeta): {
	maxAspectGap: number;
	allWithinPeriod: boolean;
} {
	let maxAspectGap = 0;
	let allWithinPeriod = true;
	for (const e of meta.elements) {
		maxAspectGap = Math.max(maxAspectGap, Math.abs((e.u1 - e.u0) - (e.v1 - e.v0)));
		if (e.v0 < 0 || e.v1 > TWO_PI + 1e-9) allWithinPeriod = false;
	}
	return { maxAspectGap, allWithinPeriod };
}
