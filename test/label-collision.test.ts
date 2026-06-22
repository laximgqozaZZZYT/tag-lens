// placeClusterLabels: greedy, largest-box-first label de-confliction used by
// bubblesets mode. Each cluster's desired label cell (centre + size) plus its
// enclosure box yield candidate anchor positions (corners / edges / centre);
// the first candidate that does not collide with an already-placed label wins,
// falling back to the desired position if none is clear. Output preserves
// input order and only moves the CENTRE (size is caller-owned).
// See docs/superpowers/specs/2026-06-22-bubblesets-label-collision-design.md.
import { ok } from "./assert";
import { placeClusterLabels, type LabelPlacementInput } from "../src/layout/label-collision";

function aabb(c: { x: number; y: number }, w: number, h: number) {
	return { x1: c.x - w / 2, y1: c.y - h / 2, x2: c.x + w / 2, y2: c.y + h / 2 };
}
function overlap(a: ReturnType<typeof aabb>, b: ReturnType<typeof aabb>): boolean {
	return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

// Empty input -> empty output.
{
	const out = placeClusterLabels([]);
	ok(out.length === 0, "empty input -> empty output");
}

// Single label -> unchanged desired position.
{
	const inp: LabelPlacementInput[] = [
		{ key: "a", x: 50, y: 10, w: 40, h: 12, box: { x: 0, y: 0, w: 200, h: 120 } },
	];
	const out = placeClusterLabels(inp);
	ok(out.length === 1, "single -> one output");
	ok(out[0].x === 50 && out[0].y === 10, "single label keeps its desired centre");
}

// Two clusters whose DESIRED label cells overlap exactly -> outputs must NOT
// overlap after de-confliction (the whole point of the pass).
{
	const box = { x: 0, y: 0, w: 300, h: 200 };
	const inp: LabelPlacementInput[] = [
		// both want the same top-left strip centre -> direct collision
		{ key: "big", x: 40, y: 8, w: 60, h: 14, box: { ...box, w: 300, h: 200 } },
		{ key: "small", x: 42, y: 9, w: 60, h: 14, box: { ...box, w: 180, h: 120 } },
	];
	const out = placeClusterLabels(inp);
	const a = aabb(out[0], inp[0].w, inp[0].h);
	const b = aabb(out[1], inp[1].w, inp[1].h);
	ok(!overlap(a, b), `overlapping desired cells must be separated, got ${JSON.stringify({ a, b })}`);
}

// Largest box keeps its desired position; the smaller one is the one that moves.
{
	const inp: LabelPlacementInput[] = [
		{ key: "big", x: 40, y: 8, w: 60, h: 14, box: { x: 0, y: 0, w: 400, h: 300 } },
		{ key: "small", x: 42, y: 9, w: 60, h: 14, box: { x: 0, y: 0, w: 180, h: 120 } },
	];
	const out = placeClusterLabels(inp);
	ok(out[0].x === 40 && out[0].y === 8, "larger box's label stays at its desired centre");
	ok(!(out[1].x === 42 && out[1].y === 9), "smaller box's label moved away from collision");
}

// Two clusters with DISJOINT desired cells -> both unchanged (already clear).
{
	const inp: LabelPlacementInput[] = [
		{ key: "a", x: 40, y: 8, w: 50, h: 12, box: { x: 0, y: 0, w: 200, h: 120 } },
		// desired centre derived from box B's own top-left strip (origin 1000,1000)
		{ key: "b", x: 1040, y: 1008, w: 50, h: 12, box: { x: 1000, y: 1000, w: 200, h: 120 } },
	];
	const out = placeClusterLabels(inp);
	ok(out[0].x === 40 && out[0].y === 8, "disjoint A keeps desired centre");
	ok(out[1].x === 1040 && out[1].y === 1008, "disjoint B keeps desired centre");
}

// Every chosen label cell stays fully inside its own cluster box.
{
	const inp: LabelPlacementInput[] = [
		{ key: "a", x: 30, y: 7, w: 50, h: 14, box: { x: 0, y: 0, w: 220, h: 140 } },
		{ key: "b", x: 31, y: 7, w: 50, h: 14, box: { x: 0, y: 0, w: 220, h: 140 } },
		{ key: "c", x: 30, y: 7, w: 50, h: 14, box: { x: 0, y: 0, w: 220, h: 140 } },
	];
	const out = placeClusterLabels(inp);
	for (let i = 0; i < inp.length; i++) {
		const c = aabb(out[i], inp[i].w, inp[i].h);
		const bx = inp[i].box;
		const inside =
			c.x1 >= bx.x - 0.01 && c.y1 >= bx.y - 0.01 &&
			c.x2 <= bx.x + bx.w + 0.01 && c.y2 <= bx.y + bx.h + 0.01;
		ok(inside, `label ${inp[i].key} must stay inside its box, got ${JSON.stringify(c)} in ${JSON.stringify(bx)}`);
	}
}
