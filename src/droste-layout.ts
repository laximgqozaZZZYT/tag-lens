import type { GraphData } from "./types";
import { NONE_BUCKET } from "./types";

// Print Gallery strip layout (spec §4 + §2.1). One turn (v: 0 → 2π) climbs the
// membership hierarchy across four quadrants, and the conformal map z=R₀·exp(γζ)
// warps the square ζ-cells into the Droste spiral:
//
//   ① v ∈ [0,   π/2)  focus node N + its sibling notes   (kind: node)
//   ② v ∈ [π/2, π)    N's own cluster(s)                 (kind: cluster)
//   ③ v ∈ [π,  3π/2)  the other clusters                 (kind: cluster)
//   ④ v ∈ [3π/2, 2π)  transition: a bridge echoing N so ③ leads back into ①(N)
//                      of the NEXT scaled turn — the abstraction loop closes.
//
// N sits at v=0 (bottom-left corner). Cells are Δ×Δ squares in ζ-space (§2.1).
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
	// Cluster key → human-readable label (from buildGraph). Without it, cluster
	// cells fall back to the raw membership key.
	labels?: Map<string, string>;
	// Columns per quadrant and radial rows per level. Δ = (π/2)/cols, reused as
	// the u step so cells are square. Defaults keep the radial band thin so the
	// angular axis (= hierarchy level) reads clearly and the Droste scale axis
	// stays the turns.
	cols?: number;
	rows?: number;
}

const TWO_PI = 2 * Math.PI;
const QUAD = TWO_PI / 4; // one hierarchy level per quadrant of the turn

interface Item {
	id: string;
	label: string;
	hueKey: string;
	kind: "node" | "cluster";
}

export function layoutDroste(data: GraphData, opts: DrosteLayoutOpts = {}): DrosteMeta {
	const cols = Math.max(1, Math.floor(opts.cols ?? 8));
	const rows = Math.max(1, Math.floor(opts.rows ?? 3));
	const cell = QUAD / cols; // Δ — angular cell width; reused as the u step (square)
	const uBase = cell; // one cell of inner margin before the first row
	const labels = opts.labels ?? new Map<string, string>();
	const clusterLabel = (key: string): string => labels.get(key) ?? key;

	const nodes = data.nodes;

	// (1) Focus node N. Explicit drosteFocus wins; otherwise the first node that
	//     carries a real (non-NONE) membership so the hierarchy isn't degenerate;
	//     otherwise the first node.
	let focusId = opts.focusId && nodes.some((n) => n.id === opts.focusId) ? opts.focusId : "";
	if (!focusId) {
		const tagged = nodes.find((n) => n.memberships.some((m) => m !== NONE_BUCKET));
		focusId = (tagged ?? nodes[0])?.id ?? "";
	}
	const focus = nodes.find((n) => n.id === focusId);

	// (2) Classify from N's memberships: sibling notes, N's clusters, other clusters.
	let focusClusters = new Set((focus?.memberships ?? []).filter((m) => m !== NONE_BUCKET));
	if (focusClusters.size === 0 && focus) {
		// Untagged focus — fall back to its NONE bucket so ② / peers still resolve.
		focusClusters = new Set(focus.memberships);
	}
	const peers = nodes.filter(
		(n) => n.id === focusId || n.memberships.some((m) => focusClusters.has(m)),
	);
	const allClusters = new Set<string>();
	for (const n of nodes) for (const m of n.memberships) allClusters.add(m);
	const lvl2 = [...focusClusters];
	const lvl3 = [...allClusters].filter((c) => !focusClusters.has(c));

	const elements: DrosteBandElement[] = [];
	const capacity = cols * rows;

	// Fill one quadrant with up to `capacity` Δ×Δ square cells (cols × rows) in
	// reading order. Overflow folds into a final "+N" cell so render cost and
	// element count stay bounded regardless of vault size.
	const fill = (items: Item[], level: 1 | 2 | 3, qStart: number): void => {
		let shown = items;
		if (items.length > capacity) {
			const overflow = items.length - (capacity - 1);
			shown = [
				...items.slice(0, capacity - 1),
				{ id: `__more_l${level}`, label: `+${overflow}`, hueKey: "more", kind: "cluster" },
			];
		}
		shown.forEach((it, i) => {
			const col = i % cols;
			const row = Math.floor(i / cols);
			const v0 = qStart + col * cell;
			const u0 = uBase + row * cell;
			elements.push({ ...it, level, u0, u1: u0 + cell, v0, v1: v0 + cell });
		});
	};

	// (3) ① focus + sibling notes, with N as cell 0 → v=0 (bottom-left corner).
	const lvl1: Item[] = [
		...(focus
			? [{ id: focus.id, label: focus.label, hueKey: focus.memberships[0] ?? focus.id, kind: "node" as const }]
			: []),
		...peers
			.filter((n) => n.id !== focusId)
			.map((n) => ({ id: n.id, label: n.label, hueKey: n.memberships[0] ?? n.id, kind: "node" as const })),
	];
	fill(lvl1, 1, 0 * QUAD);
	// ② N's clusters, ③ other clusters — readable labels via clusterLabels.
	fill(lvl2.map((c) => ({ id: c, label: clusterLabel(c), hueKey: c, kind: "cluster" as const })), 2, 1 * QUAD);
	fill(lvl3.map((c) => ({ id: c, label: clusterLabel(c), hueKey: c, kind: "cluster" as const })), 3, 2 * QUAD);

	// (4) ④ transition band [3π/2, 2π): a single bridge cell echoing N at the
	//     quadrant start. The rest of the band stays open, so the spiral runs
	//     from ③ (other clusters) through this "↻ N" marker into ①(N) at the
	//     next turn's v=0 — i.e. v=2π ≡ 0 of the next scaled copy. This is what
	//     makes the "climb back to the next N" legible and closes the loop
	//     (the layout is 2π-periodic; copies repeat it at successive scales).
	if (focus) {
		const v0 = 3 * QUAD;
		elements.push({
			id: `__loop_${focusId}`,
			label: `↻ ${focus.label}`,
			hueKey: focus.memberships[0] ?? focusId,
			kind: "node",
			level: 4,
			u0: uBase,
			u1: uBase + cell,
			v0,
			v1: v0 + cell,
		});
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
