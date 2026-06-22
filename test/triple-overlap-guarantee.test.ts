// guaranteeTripleOverlaps: deterministic construction that guarantees any
// 3 boxes whose tags genuinely share members (hasTripleShare) end up with a
// non-degenerate common rectangle, even if pairwise force-relaxation alone
// wouldn't produce one (classic failure: A∩B and B∩C non-empty, A∩C empty).
import { ok } from "./assert";
import { guaranteeTripleOverlaps } from "../src/layout/triple-overlap-guarantee";
import type { SizedNode } from "../src/layout/layout";

const box = (id: string, w: number, h: number): SizedNode => ({
	id, label: "", memberships: [], width: w, height: h,
});

function rectOf(pos: { x: number; y: number }, b: SizedNode) {
	return { left: pos.x - b.width / 2, right: pos.x + b.width / 2, top: pos.y - b.height / 2, bottom: pos.y + b.height / 2 };
}
function aabbIntersect3(r1: ReturnType<typeof rectOf>, r2: ReturnType<typeof rectOf>, r3: ReturnType<typeof rectOf>) {
	const left = Math.max(r1.left, r2.left, r3.left);
	const right = Math.min(r1.right, r2.right, r3.right);
	const top = Math.max(r1.top, r2.top, r3.top);
	const bottom = Math.min(r1.bottom, r2.bottom, r3.bottom);
	return { w: right - left, h: bottom - top };
}

// Classic failure case: A is far left, B in the middle (overlapping A), C
// far right (overlapping B but NOT A). Pairwise: A∩B>0, B∩C>0, A∩C=0 -> no
// triple region without correction.
{
	const boxes = [box("A", 100, 60), box("B", 100, 60), box("C", 100, 60)];
	const positions = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 160, y: 0 }];
	// Sanity: confirm the input is indeed the failure case before fixing it.
	const before = aabbIntersect3(rectOf(positions[0], boxes[0]), rectOf(positions[1], boxes[1]), rectOf(positions[2], boxes[2]));
	ok(before.w <= 0 || before.h <= 0, `expected the unfixed input to have no triple overlap, got w=${before.w} h=${before.h}`);

	guaranteeTripleOverlaps(boxes, positions, () => true, 10);
	const after = aabbIntersect3(rectOf(positions[0], boxes[0]), rectOf(positions[1], boxes[1]), rectOf(positions[2], boxes[2]));
	ok(after.w > 0 && after.h > 0, `expected a guaranteed triple overlap after the fix, got w=${after.w} h=${after.h}`);
}

// hasTripleShare === false -> no correction applied, positions untouched.
{
	const boxes = [box("A", 100, 60), box("B", 100, 60), box("C", 100, 60)];
	const positions = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 160, y: 0 }];
	const snapshot = positions.map((p) => ({ ...p }));
	guaranteeTripleOverlaps(boxes, positions, () => false, 10);
	ok(
		positions.every((p, i) => p.x === snapshot[i].x && p.y === snapshot[i].y),
		"positions must be untouched when hasTripleShare is false for every triple",
	);
}

// Already-overlapping triple (relaxation already solved it) -> left alone
// (no unnecessary perturbation of a good layout).
{
	const boxes = [box("A", 100, 60), box("B", 100, 60), box("C", 100, 60)];
	const positions = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -10, y: 0 }];
	const before = aabbIntersect3(rectOf(positions[0], boxes[0]), rectOf(positions[1], boxes[1]), rectOf(positions[2], boxes[2]));
	ok(before.w > 0 && before.h > 0, "precondition: this input already has a triple overlap");
	const snapshot = positions.map((p) => ({ ...p }));
	guaranteeTripleOverlaps(boxes, positions, () => true, 10);
	ok(
		positions.every((p, i) => p.x === snapshot[i].x && p.y === snapshot[i].y),
		"already-overlapping triple must be left untouched",
	);
}

// Small boxes: eps must clamp down to feasibility (never push a box's
// target region wider than the box itself).
{
	const boxes = [box("A", 20, 20), box("B", 20, 20), box("C", 20, 20)];
	const positions = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
	guaranteeTripleOverlaps(boxes, positions, () => true, 10000); // huge minEps
	const after = aabbIntersect3(rectOf(positions[0], boxes[0]), rectOf(positions[1], boxes[1]), rectOf(positions[2], boxes[2]));
	ok(after.w > 0 && after.h > 0, `expected feasible guaranteed overlap even with an oversized minEps, got w=${after.w} h=${after.h}`);
}

// Multiple independent needed triples among >3 boxes: each gets fixed
// without the function crashing or skipping later triples.
{
	const boxes = [box("A", 80, 50), box("B", 80, 50), box("C", 80, 50), box("D", 80, 50)];
	const positions = [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 140, y: 0 }, { x: 500, y: 500 }];
	const needed = new Set(["A|B|C"]);
	const key = (a: string, b: string, c: string) => [a, b, c].sort().join("|");
	guaranteeTripleOverlaps(boxes, positions, (a, b, c) => needed.has(key(a, b, c)), 10);
	const after = aabbIntersect3(rectOf(positions[0], boxes[0]), rectOf(positions[1], boxes[1]), rectOf(positions[2], boxes[2]));
	ok(after.w > 0 && after.h > 0, "the one needed triple (A,B,C) must end up overlapping");
	ok(positions[3].x === 500 && positions[3].y === 500, "box D (not part of any needed triple) must be untouched");
}

// Very small boxes (non-zero but tiny): eps must not go negative.
// The guarantee should still hold (positive area intersection).
{
	const boxes = [box("A", 0.1, 0.1), box("B", 0.1, 0.1), box("C", 0.1, 0.1)];
	const positions = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
	guaranteeTripleOverlaps(boxes, positions, () => true, 10);
	const after = aabbIntersect3(rectOf(positions[0], boxes[0]), rectOf(positions[1], boxes[1]), rectOf(positions[2], boxes[2]));
	ok(after.w > 0 && after.h > 0, `expected positive-area guaranteed overlap even with tiny boxes, got w=${after.w} h=${after.h}`);
}

// Degenerate minEps: minEps <= 0 should also produce a positive-area intersection
// (eps floored to 1e-6 ensures this).
{
	const boxes = [box("A", 100, 60), box("B", 100, 60), box("C", 100, 60)];
	const positions = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 160, y: 0 }];
	guaranteeTripleOverlaps(boxes, positions, () => true, 0); // minEps = 0
	const after = aabbIntersect3(rectOf(positions[0], boxes[0]), rectOf(positions[1], boxes[1]), rectOf(positions[2], boxes[2]));
	ok(after.w > 0 && after.h > 0, `expected positive-area guaranteed overlap even with minEps=0, got w=${after.w} h=${after.h}`);
}

// guaranteeKWayOverlap: generalization of the eps-square trick to an
// arbitrary k-box combo and an explicit target W×H (not just a token
// non-degenerate point). The triple region must end up AT LEAST
// targetW × targetH, not just > 0.
import { guaranteeKWayOverlap } from "../src/layout/triple-overlap-guarantee";

// Three 200x200 boxes, currently barely overlapping (a sliver) — must be
// grown to a 80x60 guaranteed overlap.
{
	const boxes = [box("A", 200, 200), box("B", 200, 200), box("C", 200, 200)];
	const positions = [{ x: 0, y: 0 }, { x: 195, y: 0 }, { x: 390, y: 0 }];
	guaranteeKWayOverlap(boxes, positions, [0, 1, 2], 80, 60);
	const after = aabbIntersect3(rectOf(positions[0], boxes[0]), rectOf(positions[1], boxes[1]), rectOf(positions[2], boxes[2]));
	ok(after.w >= 80 - 1e-6 && after.h >= 60 - 1e-6, `expected >=80x60 overlap, got w=${after.w} h=${after.h}`);
}

// Already big enough -> left untouched (no unnecessary perturbation).
{
	const boxes = [box("A", 200, 200), box("B", 200, 200), box("C", 200, 200)];
	const positions = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -10, y: 0 }];
	const snapshot = positions.map((p) => ({ ...p }));
	guaranteeKWayOverlap(boxes, positions, [0, 1, 2], 50, 50);
	ok(
		positions.every((p, i) => p.x === snapshot[i].x && p.y === snapshot[i].y),
		"already-big-enough overlap must be left untouched",
	);
}

// Target larger than a participating box's own extent -> capped by that
// box's own half-size (geometrically unfixable beyond that; caller's
// degree-cascade is the fallback for this case), never crashes/NaNs.
{
	const boxes = [box("A", 30, 30), box("B", 200, 200), box("C", 200, 200)];
	const positions = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: -5, y: 0 }];
	guaranteeKWayOverlap(boxes, positions, [0, 1, 2], 500, 500);
	const after = aabbIntersect3(rectOf(positions[0], boxes[0]), rectOf(positions[1], boxes[1]), rectOf(positions[2], boxes[2]));
	ok(after.w > 0 && after.h > 0, "must still produce a positive-area overlap even when target exceeds a box's own size");
	ok(after.w <= 30 + 1e-6 && after.h <= 30 + 1e-6, `overlap must be capped by the smallest box's own extent (30x30), got w=${after.w} h=${after.h}`);
}

// Works for k=2 (pairs) and k=4 (quads), not just triples.
{
	const boxes = [box("A", 200, 200), box("B", 200, 200)];
	const positions = [{ x: 0, y: 0 }, { x: 195, y: 0 }];
	guaranteeKWayOverlap(boxes, positions, [0, 1], 60, 60);
	const left = Math.max(positions[0].x - boxes[0].width / 2, positions[1].x - boxes[1].width / 2);
	const right = Math.min(positions[0].x + boxes[0].width / 2, positions[1].x + boxes[1].width / 2);
	ok(right - left >= 60 - 1e-6, `expected >=60 width pair overlap, got ${right - left}`);
}
{
	const boxes = [box("A", 200, 200), box("B", 200, 200), box("C", 200, 200), box("D", 200, 200)];
	const positions = [{ x: 0, y: 0 }, { x: 195, y: 0 }, { x: 0, y: 195 }, { x: 195, y: 195 }];
	guaranteeKWayOverlap(boxes, positions, [0, 1, 2, 3], 40, 40);
	const left = Math.max(...[0, 1, 2, 3].map((i) => positions[i].x - boxes[i].width / 2));
	const right = Math.min(...[0, 1, 2, 3].map((i) => positions[i].x + boxes[i].width / 2));
	const top = Math.max(...[0, 1, 2, 3].map((i) => positions[i].y - boxes[i].height / 2));
	const bottom = Math.min(...[0, 1, 2, 3].map((i) => positions[i].y + boxes[i].height / 2));
	ok(right - left >= 40 - 1e-6 && bottom - top >= 40 - 1e-6, `expected >=40x40 quad overlap, got w=${right - left} h=${bottom - top}`);
}
