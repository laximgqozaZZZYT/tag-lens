import type { GraphData } from "./types";

// Approach B (spec §2.1): tile ζ-space with a UNIFORM SQUARE grid — every cell is
// a Δ × Δ square in the (u, v) plane (Δu = Δv). Because z = R₀·exp(γζ) is
// conformal, each ζ-square maps to a locally-square screen tile with logarithmic-
// spiral edges (the Print Gallery look). Equal Δu/Δv is what stops cells reading
// as radial slivers / circular sectors. The "square" lives in ζ (log-polar) space.
export interface DrosteBandElement {
	id: string;
	kind: "node" | "cluster";
	label: string;
	hueKey: string; // key for clusterHue()
	level: 1 | 2 | 3 | 4;
	// Square cell in ζ-space: u1 - u0 === v1 - v0 === cell (radial × angular).
	u0: number;
	u1: number;
	v0: number;
	v1: number;
}

export interface DrosteMeta {
	elements: DrosteBandElement[];
	focusId: string;
	// Δ — the uniform square-cell size in ζ-space (Δu = Δv).
	cell: number;
}

export interface DrosteLayoutOpts {
	focusId?: string;
	// Columns per hierarchy quadrant and radial rows per level. Δ = (π/2)/cols,
	// and the same Δ is used for the u step so cells are square.
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
	const cols = Math.max(1, Math.floor(opts.cols ?? 6));
	const rows = Math.max(1, Math.floor(opts.rows ?? 5));
	const cell = QUAD / cols; // Δ — angular cell width; reused as the u step (square)
	const uBase = cell; // one cell of inner margin before the first row

	const nodes = data.nodes;
	const focusId =
		opts.focusId && nodes.some((n) => n.id === opts.focusId)
			? opts.focusId
			: nodes[0]?.id ?? "";
	const focus = nodes.find((n) => n.id === focusId);
	const focusClusters = new Set(focus?.memberships ?? []);

	// Level 1: focus + sibling notes sharing any of the focus's clusters.
	const peers = nodes.filter(
		(n) => n.id === focusId || n.memberships.some((m) => focusClusters.has(m)),
	);
	// Level 2: the focus's clusters. Level 3: all other clusters.
	const allClusters = new Set<string>();
	for (const n of nodes) for (const m of n.memberships) allClusters.add(m);
	const lvl2 = [...focusClusters];
	const lvl3 = [...allClusters].filter((c) => !focusClusters.has(c));

	const elements: DrosteBandElement[] = [];
	const capacity = cols * rows;

	// Fill one quadrant with up to `capacity` Δ×Δ square cells (cols × rows) in
	// reading order. Overflow folds into a final "+N" cell so render cost (and
	// element count) stays bounded regardless of vault size.
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
			elements.push({
				id: it.id,
				label: it.label,
				hueKey: it.hueKey,
				kind: it.kind,
				level,
				u0,
				u1: u0 + cell,
				v0,
				v1: v0 + cell,
			});
		});
	};

	// Focus is cell 0 of quadrant 1 → bottom-left corner (v = 0).
	const lvl1: Item[] = [
		...(focus
			? [{ id: focus.id, label: focus.label, hueKey: focus.memberships[0] ?? focus.id, kind: "node" as const }]
			: []),
		...peers
			.filter((n) => n.id !== focusId)
			.map((n) => ({ id: n.id, label: n.label, hueKey: n.memberships[0] ?? n.id, kind: "node" as const })),
	];

	fill(lvl1, 1, 0 * QUAD);
	fill(lvl2.map((c) => ({ id: c, label: c, hueKey: c, kind: "cluster" as const })), 2, 1 * QUAD);
	fill(lvl3.map((c) => ({ id: c, label: c, hueKey: c, kind: "cluster" as const })), 3, 2 * QUAD);
	// Quadrant 4 (v ∈ [3π/2, 2π)) is the transition band — left empty; the spiral
	// continues into the next scale copy (v += 2π) there, closing the loop.

	return { elements, focusId, cell };
}

// Approach B invariant (replaces the old band-seam check): every tile must be a
// SQUARE in ζ-space (Δu = Δv) and lie within one period [0, 2π). maxAspectGap = 0
// means perfectly square cells. The conformal seam continuity (the spiral closing
// across v = 0 ≡ 2π) is guaranteed by the map itself — see conformal.test.ts's
// scale-periodicity / angle-closure assertions — so it is not re-checked here.
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
