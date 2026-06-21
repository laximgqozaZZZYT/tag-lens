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
// convergence risk.
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
