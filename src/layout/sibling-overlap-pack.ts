import type { SizedNode } from "./layout";
import { shelfPack } from "./subgroup-packing";

// Sharing-aware sibling box placement. Used by `bubblesets` mode to place
// cross-cutting tag boxes (neither a subset of the other) like an
// approximate Euler diagram: pairs that share members are pulled toward a
// target overlap proportional to their shared fraction; pairs that share
// nothing are kept apart by the same gap-enforcing repulsion `shelfPack`
// already guarantees. Same input/output contract as `shelfPack` (positions
// are box CENTRES, in the same order as `boxes`) so callers can swap it in
// without touching anything downstream of the pack call.
//
// Overlap-fraction cap: a near-identical pair would otherwise be pulled to
// fully coincide, which reads as one box, not two overlapping sets — 0.7
// keeps both boxes' labels legible.
const MAX_OVERLAP_FRAC = 0.7;
const ITERS = 60;
const ATTRACT_RATE = 0.15;

export interface SiblingOverlapOpts {
	// Number of members tag `a` and tag `b` have in common. 0 for any pair
	// with no sharing relation at all (e.g. the OWN pseudo-box against any
	// sibling tag — by construction a node's OWN box only happens when this
	// tag is its single most-specific membership, so it can't also be a
	// member of a sibling tag).
	sharedCount: (a: string, b: string) => number;
	// Total member count of one tag (>=1). Used to normalize the shared
	// count into an overlap FRACTION (shared / min(sizeOf(a), sizeOf(b))).
	sizeOf: (id: string) => number;
}

// Minimum number of independent sharing-partners before a box counts as a
// "hub" worth seeding radially. Below this, shelfPack's row-major seed
// already converges fine (verified — see the visibility-density plan's
// Task 3 investigation, which only found uneven results at higher
// fan-out).
const HUB_MIN_DEGREE = 3;

interface HubInfo {
	hubIdx: number;
	spokes: number[]; // indices of boxes[] sharing with the hub
}

// Find the box with the most independent sharing-partners. Returns null
// when no box's degree reaches HUB_MIN_DEGREE (the common, non-hub case —
// every existing pairwise/triple scenario is unaffected by anything below).
function detectHub(boxes: SizedNode[], opts: SiblingOverlapOpts): HubInfo | null {
	const partnersOf: number[][] = boxes.map(() => []);
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			if (opts.sharedCount(boxes[i].id, boxes[j].id) > 0) {
				partnersOf[i].push(j);
				partnersOf[j].push(i);
			}
		}
	}
	let hubIdx = -1;
	let hubDegree = 0;
	for (let i = 0; i < boxes.length; i++) {
		if (partnersOf[i].length > hubDegree) {
			hubDegree = partnersOf[i].length;
			hubIdx = i;
		}
	}
	if (hubIdx < 0 || hubDegree < HUB_MIN_DEGREE) return null;
	return { hubIdx, spokes: partnersOf[hubIdx] };
}

// The distance at which two boxes' edges JUST touch along direction
// (cosT, sinT) — the boundary of the Minkowski sum of both half-extents.
// NOT halfWSum*|cos|+halfHSum*|sin|, which overshoots past the true
// touching point at any non-axis-aligned angle whenever width and height
// differ.
function touchDistance(cosT: number, sinT: number, halfWSum: number, halfHSum: number): number {
	return Math.min(
		Math.abs(cosT) > 1e-6 ? halfWSum / Math.abs(cosT) : Infinity,
		Math.abs(sinT) > 1e-6 ? halfHSum / Math.abs(sinT) : Infinity,
	);
}

// `shelfPack`'s row-major seed starts every box roughly along a single
// axis. For a "hub" box that shares members independently with many
// mutually-unrelated sibling boxes (a "spoke" pattern — sharing only with
// the hub, not each other), that seed puts most spokes on the same side of
// the hub with near-zero initial Y separation, so the pairwise pull-apart
// force spends its iterations fighting over the same x-axis instead of
// spreading spokes around the hub. Re-seeding the hub's spokes evenly
// around it on a circle, at the distance that already achieves their
// target overlap fraction, gives the optimizer a starting point where
// simultaneous overlap with every spoke is actually reachable. Mutates
// `pos` in place.
function seedHubRadially(boxes: SizedNode[], pos: { x: number; y: number }[], opts: SiblingOverlapOpts, hub: HubInfo): void {
	const hubBox = boxes[hub.hubIdx];
	const hubPos = pos[hub.hubIdx];
	const hubSize = Math.max(1, opts.sizeOf(hubBox.id));
	hub.spokes.forEach((spokeIdx, k) => {
		const spoke = boxes[spokeIdx];
		const theta = (k / hub.spokes.length) * Math.PI * 2;
		const cosT = Math.cos(theta);
		const sinT = Math.sin(theta);
		const halfWSum = hubBox.width / 2 + spoke.width / 2;
		const halfHSum = hubBox.height / 2 + spoke.height / 2;
		const sizeS = Math.max(1, opts.sizeOf(spoke.id));
		const shared = opts.sharedCount(hubBox.id, spoke.id);
		const overlapFrac = Math.min(MAX_OVERLAP_FRAC, shared / Math.min(hubSize, sizeS));
		const radius = touchDistance(cosT, sinT, halfWSum, halfHSum) * (1 - overlapFrac);
		pos[spokeIdx] = {
			x: hubPos.x + cosT * radius,
			y: hubPos.y + sinT * radius,
		};
	});
}

export function siblingOverlapPack(
	boxes: SizedNode[],
	gap: number,
	opts: SiblingOverlapOpts,
): { positions: { x: number; y: number }[]; width: number; height: number } {
	const seed = shelfPack(boxes, gap);
	if (boxes.length <= 1) return seed;

	const pos = seed.positions.map((p) => ({ x: p.x, y: p.y }));
	const hub = detectHub(boxes, opts);
	if (hub) seedHubRadially(boxes, pos, opts, hub);
	const hubSpokeSet = hub ? new Set(hub.spokes) : null;
	const massOf = (b: SizedNode): number => Math.max(1, b.width * b.height);

	for (let iter = 0; iter < ITERS; iter++) {
		const deltaX = new Array(boxes.length).fill(0);
		const deltaY = new Array(boxes.length).fill(0);
		for (let i = 0; i < boxes.length; i++) {
			for (let j = i + 1; j < boxes.length; j++) {
				const a = boxes[i];
				const b = boxes[j];
				const pa = pos[i];
				const pb = pos[j];
				const halfWSum = a.width / 2 + b.width / 2;
				const halfHSum = a.height / 2 + b.height / 2;
				const dx = pb.x - pa.x;
				const dy = pb.y - pa.y;
				const massA = massOf(a);
				const massB = massOf(b);
				const fracA = massB / (massA + massB); // heavier box moves less
				const fracB = massA / (massA + massB);
				const shared = opts.sharedCount(a.id, b.id);

				// A hub↔spoke pair (one fan-out box sharing independently
				// with several mutually-unrelated siblings) is corrected
				// RADIALLY (move along the hub→spoke vector to hit the
				// target DISTANCE at the pair's CURRENT angle) rather than
				// via the generic per-axis-independent correction below.
				// The per-axis form treats X and Y as two unrelated 1D
				// overlaps and pulls each toward its own half-target
				// unconditionally — for a genuinely diagonal pair (the norm
				// once spokes are spread radially) that squashes BOTH axes
				// toward their target simultaneously, shrinking the actual
				// overlap AREA well below intended (verified by direct
				// repro). Spoke↔spoke pairs (sharing nothing) still use the
				// separation branch below — that one only checks "are they
				// too close," which the per-axis form already handles
				// correctly regardless of angle.
				if (shared > 0 && hubSpokeSet && ((i === hub!.hubIdx && hubSpokeSet.has(j)) || (j === hub!.hubIdx && hubSpokeSet.has(i)))) {
					const sizeA = Math.max(1, opts.sizeOf(a.id));
					const sizeB = Math.max(1, opts.sizeOf(b.id));
					const overlapFrac = Math.min(MAX_OVERLAP_FRAC, shared / Math.min(sizeA, sizeB));
					const dist = Math.hypot(dx, dy) || 0.0001;
					const cosT = dx / dist;
					const sinT = dy / dist;
					const target = touchDistance(cosT, sinT, halfWSum, halfHSum) * (1 - overlapFrac);
					const err = (dist - target) * ATTRACT_RATE;
					deltaX[i] += cosT * err * fracA;
					deltaX[j] -= cosT * err * fracB;
					deltaY[i] += sinT * err * fracA;
					deltaY[j] -= sinT * err * fracB;
				} else if (shared > 0) {
					const sizeA = Math.max(1, opts.sizeOf(a.id));
					const sizeB = Math.max(1, opts.sizeOf(b.id));
					const overlapFrac = Math.min(MAX_OVERLAP_FRAC, shared / Math.min(sizeA, sizeB));
					const targetX = halfWSum * (1 - overlapFrac);
					const targetY = halfHSum * (1 - overlapFrac);
					const curX = Math.abs(dx) || 0.0001;
					const curY = Math.abs(dy) || 0.0001;
					const errX = (curX - targetX) * ATTRACT_RATE;
					const errY = (curY - targetY) * ATTRACT_RATE;
					const signX = dx >= 0 ? 1 : -1;
					const signY = dy >= 0 ? 1 : -1;
					deltaX[i] += signX * errX * fracA;
					deltaX[j] -= signX * errX * fracB;
					deltaY[i] += signY * errY * fracA;
					deltaY[j] -= signY * errY * fracB;
				} else {
					const overlapX = halfWSum + gap - Math.abs(dx);
					const overlapY = halfHSum + gap - Math.abs(dy);
					if (overlapX <= 0 || overlapY <= 0) continue;
					if (overlapX < overlapY) {
						const sign = dx >= 0 ? 1 : -1;
						deltaX[i] -= sign * overlapX * fracA;
						deltaX[j] += sign * overlapX * fracB;
					} else {
						const sign = dy >= 0 ? 1 : -1;
						deltaY[i] -= sign * overlapY * fracA;
						deltaY[j] += sign * overlapY * fracB;
					}
				}
			}
		}
		for (let i = 0; i < boxes.length; i++) {
			if (hub && i === hub.hubIdx) continue; // hub stays fixed as the reference frame
			pos[i].x += deltaX[i];
			pos[i].y += deltaY[i];
		}
	}
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let i = 0; i < boxes.length; i++) {
		const b = boxes[i];
		const p = pos[i];
		minX = Math.min(minX, p.x - b.width / 2);
		minY = Math.min(minY, p.y - b.height / 2);
		maxX = Math.max(maxX, p.x + b.width / 2);
		maxY = Math.max(maxY, p.y + b.height / 2);
	}
	for (const p of pos) {
		p.x -= minX;
		p.y -= minY;
	}
	return { positions: pos, width: maxX - minX, height: maxY - minY };
}
