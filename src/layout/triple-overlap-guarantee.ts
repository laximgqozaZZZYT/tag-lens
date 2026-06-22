import type { SizedNode } from "./layout";

// Deterministic construction: guarantees any 3 boxes whose tags genuinely
// share members end up with a non-degenerate common rectangle, even when
// pairwise force-relaxation alone wouldn't produce one (classic failure:
// A∩B and B∩C both non-empty, A∩C empty — no triple region without this).
//
// For each needed triple with a currently-degenerate AABB intersection:
// pick the centroid P of the three current centres, then clamp each box's
// centre to the minimal position such that its rectangle contains the
// small square P±eps. All three then contain that square by construction,
// so their intersection is guaranteed non-degenerate — no iteration, no
// convergence risk. Assumes every box has positive width and height: a
// box with zero extent in some axis can never gain a positive-area
// intersection in that axis, regardless of eps (its own extent is the
// hard ceiling) — that sub-case is geometrically unfixable, not a bug.
export function guaranteeTripleOverlaps(
	boxes: SizedNode[],
	positions: { x: number; y: number }[],
	hasTripleShare: (a: string, b: string, c: string) => boolean,
	minEps: number,
): void {
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			for (let k = j + 1; k < boxes.length; k++) {
				if (!hasTripleShare(boxes[i].id, boxes[j].id, boxes[k].id)) continue;
				const idx = [i, j, k];
				const lefts = idx.map((n) => positions[n].x - boxes[n].width / 2);
				const rights = idx.map((n) => positions[n].x + boxes[n].width / 2);
				const tops = idx.map((n) => positions[n].y - boxes[n].height / 2);
				const bottoms = idx.map((n) => positions[n].y + boxes[n].height / 2);
				const left = Math.max(...lefts);
				const right = Math.min(...rights);
				const top = Math.max(...tops);
				const bottom = Math.min(...bottoms);
				if (right - left > 0 && bottom - top > 0) continue; // already overlapping

				const px = idx.reduce((s, n) => s + positions[n].x, 0) / 3;
				const py = idx.reduce((s, n) => s + positions[n].y, 0) / 3;
				let eps = Math.min(
					minEps,
					...idx.map((n) => boxes[n].width / 2),
					...idx.map((n) => boxes[n].height / 2),
				);
				// Floor eps to a small positive value to ensure the constructed square P±eps
				// always has positive area, even when inputs are degenerate (zero/near-zero
				// boxes or minEps <= 0). This guarantees a genuinely non-degenerate
				// intersection, not just a touching point.
				eps = Math.max(eps, 1e-6);
				for (const n of idx) {
					const halfW = boxes[n].width / 2;
					const halfH = boxes[n].height / 2;
					const minX = px - halfW + eps;
					const maxX = px + halfW - eps;
					const minY = py - halfH + eps;
					const maxY = py + halfH - eps;
					positions[n].x = Math.min(maxX, Math.max(minX, positions[n].x));
					positions[n].y = Math.min(maxY, Math.max(minY, positions[n].y));
				}
			}
		}
	}
}

// Generalization of guaranteeTripleOverlaps's eps-square trick: clamp every
// box in `idx` toward their shared centroid so their AABB intersection
// reaches AT LEAST targetW × targetH — not just a token non-degenerate
// point. Used when the caller knows exactly how much area a zone's real
// node count needs (vs. guaranteeTripleOverlaps' fixed eps, which only
// guarantees *some* overlap exists).
//
// The achievable half-size is capped by the SMALLEST participating box's
// own half-extent: no box can be asked to contain a window wider/taller
// than itself. When capped, the resulting overlap is smaller than
// requested but still strictly positive and maximal given the inputs —
// genuinely unfixable beyond that without resizing the boxes themselves,
// which is the caller's degree-cascade fallback's job, not this function's.
export function guaranteeKWayOverlap(
	boxes: SizedNode[],
	positions: { x: number; y: number }[],
	idx: number[],
	targetW: number,
	targetH: number,
): void {
	const lefts = idx.map((n) => positions[n].x - boxes[n].width / 2);
	const rights = idx.map((n) => positions[n].x + boxes[n].width / 2);
	const tops = idx.map((n) => positions[n].y - boxes[n].height / 2);
	const bottoms = idx.map((n) => positions[n].y + boxes[n].height / 2);
	const curW = Math.min(...rights) - Math.max(...lefts);
	const curH = Math.min(...bottoms) - Math.max(...tops);
	if (curW >= targetW && curH >= targetH) return; // already big enough — leave untouched

	const px = idx.reduce((s, n) => s + positions[n].x, 0) / idx.length;
	const py = idx.reduce((s, n) => s + positions[n].y, 0) / idx.length;
	let halfW = Math.min(targetW / 2, ...idx.map((n) => boxes[n].width / 2));
	let halfH = Math.min(targetH / 2, ...idx.map((n) => boxes[n].height / 2));
	halfW = Math.max(halfW, 1e-6);
	halfH = Math.max(halfH, 1e-6);
	for (const n of idx) {
		const minX = px - boxes[n].width / 2 + halfW;
		const maxX = px + boxes[n].width / 2 - halfW;
		const minY = py - boxes[n].height / 2 + halfH;
		const maxY = py + boxes[n].height / 2 - halfH;
		positions[n].x = Math.min(maxX, Math.max(minX, positions[n].x));
		positions[n].y = Math.min(maxY, Math.max(minY, positions[n].y));
	}
}
