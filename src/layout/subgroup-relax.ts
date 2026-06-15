import type { Offset } from "../types";
import { centroidOf, subgroupHashOffset } from "./anchor-placement";

// Sub-group center positions during layout. Each entry tracks the
// current centre, the half-extents (= sub-group bbox), the membership
// signature (= which clusters this sub-group belongs to), and a "pin"
// weight used by the relaxation step.
//
// Memberships are carried so the relax step can decide whether two
// overlapping sub-groups SHOULD push apart. Sub-groups that share a
// cluster are deliberately allowed to overlap — their cards still
// snap to distinct cells via cell-snap-spiral, but allowing the bbox
// overlap keeps cards from the same cluster ADJACENT, which is what
// Bug #1 / Bug #3 need.
export interface SubPos {
	cx: number;
	cy: number;
	halfW: number;
	halfH: number;
	memberships: string[]; // sorted, same instance as the source SubGroup
	pin: number; // higher = harder to move
}

// Build the initial SubPos for each packed sub-group:
//   1. Centroid of the sub-group's cluster anchors (= where each tag
//      cluster sits on the lattice).
//   2. + user-defined cluster offset for the primary membership.
//   3. + tiny deterministic radial perturbation hashed from the
//      membership signature so coincident centroids (= many sub-groups
//      sharing the same anchors) split apart predictably.
//
// Pin weight = INVERSE of memberships count. Rationale: a single-tag
// node belongs unambiguously to ONE cluster, so it should anchor at
// that cluster's centroid; a multi-tag node sits at an intersection
// and should be willing to migrate.
//
// `relaxSubgroups` displaces side A by `push × b.pin / total` — i.e. a
// pair with very different pin values forces the LOW-pin one to move
// most of the way. With the inversion, single-tag (pin=1) is "heavy"
// and stays put; multi-tag (pin=1/k, k≥2) is "light" and yields.
//
// Bug-fix anchor: previously pin = memberships.length, which produced
// the OPPOSITE behaviour — single-tag sub-groups got pushed far from
// their anchor by collisions with multi-tag intersections, scattering
// the parent cluster's members (Bug #1) and inflating the cluster
// bbox to engulf unrelated cards (Bug #3).
export function buildInitialSubPositions(
	packed: { memberships: string[]; width: number; height: number }[],
	anchors: Map<string, { x: number; y: number }>,
	clusterOff: Record<string, Offset>,
	hashOffsetMagnitude: number = 4,
): SubPos[] {
	return packed.map((p) => {
		const centroid = centroidOf(p.memberships, anchors);
		const off = clusterOff[p.memberships[0] ?? ""] ?? { dx: 0, dy: 0 };
		const tinyOff =
			p.memberships.length > 1
				? subgroupHashOffset(p.memberships.join("|"), hashOffsetMagnitude)
				: { x: 0, y: 0 };
		return {
			cx: centroid.x + off.dx + tinyOff.x,
			cy: centroid.y + off.dy + tinyOff.y,
			halfW: p.width / 2,
			halfH: p.height / 2,
			memberships: p.memberships,
			pin: 1 / Math.max(1, p.memberships.length),
		};
	});
}

// Set-intersection check: do two sorted memberships arrays share at
// least one cluster key? Linear scan since both arrays are tiny (≤
// handful of memberships per card).

// AABB collision-resolution loop. For every pair of overlapping
// sub-group bboxes, push them apart along the shorter overlap axis.
// Displacement is Newton-style: side A's movement = push × (b.pin /
// totalPin). The pin assignment in `buildInitialSubPositions`
// (single-tag heavy, multi-tag light) makes single-tag anchor and
// multi-tag migrate.
// `gap` is the minimum free space required between any two sub-groups
// once relaxation settles.
export function relaxSubgroups(
	subPositions: SubPos[],
	gap: number,
	maxIter: number = 80,
): void {
	for (let iter = 0; iter < maxIter; iter++) {
		let any = false;
		for (let i = 0; i < subPositions.length; i++) {
			for (let j = i + 1; j < subPositions.length; j++) {
				const a = subPositions[i];
				const b = subPositions[j];
				const dx = b.cx - a.cx;
				const dy = b.cy - a.cy;
				const reqX = a.halfW + b.halfW + gap;
				const reqY = a.halfH + b.halfH + gap;
				const overlapX = reqX - Math.abs(dx);
				const overlapY = reqY - Math.abs(dy);
				if (overlapX <= 0 || overlapY <= 0) continue;
				any = true;
				const totalPin = a.pin + b.pin;
				const fracA = b.pin / totalPin;
				const fracB = a.pin / totalPin;
				if (overlapX < overlapY) {
					const push = overlapX + 0.5;
					const sign = dx >= 0 ? 1 : -1;
					a.cx -= sign * push * fracA;
					b.cx += sign * push * fracB;
				} else {
					const push = overlapY + 0.5;
					const sign = dy >= 0 ? 1 : -1;
					a.cy -= sign * push * fracA;
					b.cy += sign * push * fracB;
				}
			}
		}
		if (!any) break;
	}
}

// Post-relax compactness pass. For each multi-tag sub-group, pull it
// back TOWARD its largest-cluster anchor by `pullRatio` (0..1). This
// reduces the centroid-driven spread without breaking the requirement
// that the sub-group's cells appear in EVERY member cluster's bbox.
//
// Bug-fix anchor: Bug #1 (group members spread abnormally) comes from
// multi-tag sub-groups sitting at the geometric centroid of their
// member anchors. With many small + one large cluster, every
// multi-tag combination sits at the midpoint between large and small
// — stretching the LARGE cluster's bbox out into empty space (= the
// path to the small anchors) and dragging single-tag siblings along.
// Pulling each multi-tag sub-group back toward its largest cluster
// keeps that largest cluster's interior dense; smaller clusters still
// own the rendered card via membership (= no semantic change).
export function compactToLargestCluster(
	subPositions: SubPos[],
	anchors: Map<string, { x: number; y: number }>,
	clusterSizes: Map<string, number>,
	pullRatio: number = 0.4,
): void {
	if (pullRatio <= 0) return;
	for (const p of subPositions) {
		if (p.memberships.length <= 1) continue;
		// Largest by member count. Ties broken by string order to keep
		// the layout deterministic across rebuilds.
		let bestKey: string | null = null;
		let bestSize = -1;
		for (const m of p.memberships) {
			const s = clusterSizes.get(m) ?? 0;
			if (s > bestSize || (s === bestSize && (bestKey === null || m < bestKey))) {
				bestSize = s;
				bestKey = m;
			}
		}
		if (!bestKey) continue;
		const anchor = anchors.get(bestKey);
		if (!anchor) continue;
		p.cx += (anchor.x - p.cx) * pullRatio;
		p.cy += (anchor.y - p.cy) * pullRatio;
	}
}

// Snap sub-group centres to the integer grid after relaxation, so cards
// inside each sub-group land on whole-cell positions when the per-card
// cell snap runs next.
export function snapSubgroupsToGrid(
	subPositions: SubPos[],
	gridX: number,
	gridY: number,
): void {
	for (const sp of subPositions) {
		sp.cx = Math.round(sp.cx / gridX) * gridX;
		sp.cy = Math.round(sp.cy / gridY) * gridY;
	}
}
