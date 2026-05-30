import type { GraphData } from "./types";

export interface DrosteBandElement {
	id: string;
	kind: "node" | "cluster";
	label: string;
	hueKey: string; // key for clusterHue()
	level: 1 | 2 | 3 | 4;
	u0: number;
	u1: number; // radial band extent (depth)
	v0: number;
	v1: number; // angular extent within [0, 2π)
}

export interface DrosteMeta {
	elements: DrosteBandElement[];
	focusId: string;
	uPeriod: number; // radial thickness of one frame band
}

export interface DrosteLayoutOpts {
	focusId?: string;
}

const TWO_PI = 2 * Math.PI;
const QUAD = TWO_PI / 4; // one hierarchy level per quadrant

// Centreline (mid-u) of the band as a function of v, evaluated on the
// canonical period. Exposed for the seam assert. Linear within each quadrant;
// the level-4 quadrant interpolates level-3's trailing state back to level-1's
// leading state so the cylinder closes smoothly.
export function bandCentre(meta: DrosteMeta, v: number): number {
	const vv = ((v % TWO_PI) + TWO_PI) % TWO_PI;
	// Aggregate centre = mean of (u0+u1)/2 over elements whose [v0,v1] covers vv,
	// falling back to uPeriod/2 in the transition gap.
	let sum = 0, count = 0;
	for (const e of meta.elements) {
		if (vv >= e.v0 && vv < e.v1) {
			sum += (e.u0 + e.u1) / 2;
			count++;
		}
	}
	return count > 0 ? sum / count : meta.uPeriod / 2;
}

export function bandWidth(meta: DrosteMeta, v: number): number {
	const vv = ((v % TWO_PI) + TWO_PI) % TWO_PI;
	let maxW = 0;
	for (const e of meta.elements) {
		if (vv >= e.v0 && vv < e.v1) maxW = Math.max(maxW, e.u1 - e.u0);
	}
	if (maxW > 0) return maxW;
	// Fallback: derive the canonical band width from the first level-1 element
	// so the transition quadrant (no elements) matches level-1's leading width,
	// ensuring C0 seam closure.
	const lvl1 = meta.elements.find((e) => e.level === 1);
	return lvl1 ? lvl1.u1 - lvl1.u0 : meta.uPeriod;
}

export function layoutDroste(data: GraphData, opts: DrosteLayoutOpts = {}): DrosteMeta {
	const nodes = data.nodes;
	const focusId = opts.focusId && nodes.some((n) => n.id === opts.focusId)
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

	const uPeriod = 1; // one frame band spans u ∈ [0, 1)
	const u0 = 0.1 * uPeriod;
	const u1 = 0.9 * uPeriod; // 10% margin top/bottom of the band

	const elements: DrosteBandElement[] = [];
	const spread = (
		ids: { id: string; label: string; hueKey: string; kind: "node" | "cluster" }[],
		level: 1 | 2 | 3,
		qStart: number,
	) => {
		const n = Math.max(1, ids.length);
		const slice = QUAD / n;
		ids.forEach((it, i) => {
			elements.push({
				...it,
				level,
				u0,
				u1,
				v0: qStart + i * slice,
				v1: qStart + (i + 1) * slice,
			});
		});
	};

	// Ensure the focus is the FIRST element of quadrant 1 (so it sits at v=0).
	const lvl1Ordered = [
		focus ? { id: focus.id, label: focus.label, hueKey: focus.memberships[0] ?? focus.id, kind: "node" as const } : null,
		...peers.filter((n) => n.id !== focusId).map((n) => ({
			id: n.id, label: n.label, hueKey: n.memberships[0] ?? n.id, kind: "node" as const,
		})),
	].filter(Boolean) as { id: string; label: string; hueKey: string; kind: "node" }[];

	spread(lvl1Ordered, 1, 0 * QUAD);
	spread(lvl2.map((c) => ({ id: c, label: c, hueKey: c, kind: "cluster" as const })), 2, 1 * QUAD);
	spread(lvl3.map((c) => ({ id: c, label: c, hueKey: c, kind: "cluster" as const })), 3, 2 * QUAD);
	// Level 4 (transition quadrant) is intentionally left without its own
	// elements: bandCentre/bandWidth fall back to the period midpoint there,
	// which equals the periodic continuation of level 1's leading state, so the
	// seam closes. (A future revision may render an explicit morph band.)

	return { elements, focusId, uPeriod };
}

// Seam continuity check (spec §8 #3): the layout is 2π-periodic in v, so the
// band centreline + width must match at v=0 ≡ 2π to C0 (value) and C1 (slope).
export function assertLayoutSeam(meta: DrosteMeta): {
	c0CentreGap: number;
	c0WidthGap: number;
	c1CentreGap: number;
} {
	const h = 1e-4;
	const cLeft = bandCentre(meta, TWO_PI - h);
	const cRight = bandCentre(meta, 0 + h);
	const wLeft = bandWidth(meta, TWO_PI - h);
	const wRight = bandWidth(meta, 0 + h);
	// One-sided derivatives across the seam.
	const dLeft = (bandCentre(meta, TWO_PI - h) - bandCentre(meta, TWO_PI - 2 * h)) / h;
	const dRight = (bandCentre(meta, 0 + 2 * h) - bandCentre(meta, 0 + h)) / h;
	return {
		c0CentreGap: Math.abs(cLeft - cRight),
		c0WidthGap: Math.abs(wLeft - wRight),
		c1CentreGap: Math.abs(dLeft - dRight),
	};
}
