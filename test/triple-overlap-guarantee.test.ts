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
