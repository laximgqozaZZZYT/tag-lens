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

export function siblingOverlapPack(
	boxes: SizedNode[],
	gap: number,
	opts: SiblingOverlapOpts,
): { positions: { x: number; y: number }[]; width: number; height: number } {
	const seed = shelfPack(boxes, gap);
	if (boxes.length <= 1) return seed;

	const pos = seed.positions.map((p) => ({ x: p.x, y: p.y }));
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

				if (shared > 0) {
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
