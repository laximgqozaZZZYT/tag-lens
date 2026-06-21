// siblingOverlapPack: force-relaxes a shelfPack seed so sibling boxes that
// share members pull together/overlap proportional to share, while boxes
// that share nothing stay separated (no overlap). Used by bubblesets mode
// to place cross-cutting tags like an approximate Euler diagram.
import { ok, approx } from "./assert";
import { siblingOverlapPack } from "../src/layout/sibling-overlap-pack";
import type { SizedNode } from "../src/layout/layout";

const box = (id: string, w: number, h: number): SizedNode => ({
	id, label: "", memberships: [], width: w, height: h,
});

function rectOf(pos: { x: number; y: number }, b: SizedNode) {
	return { left: pos.x - b.width / 2, right: pos.x + b.width / 2, top: pos.y - b.height / 2, bottom: pos.y + b.height / 2 };
}

function overlapArea(a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>): number {
	const ow = Math.min(a.right, b.right) - Math.max(a.left, b.left);
	const oh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
	return Math.max(0, ow) * Math.max(0, oh);
}

// Trivial sizes (0 or 1 box) delegate straight to shelfPack-equivalent output.
{
	const r0 = siblingOverlapPack([], 10, { sharedCount: () => 0, sizeOf: () => 1 });
	ok(r0.positions.length === 0, "empty input -> empty positions");
	const single = [box("a", 40, 24)];
	const r1 = siblingOverlapPack(single, 10, { sharedCount: () => 0, sizeOf: () => 1 });
	ok(r1.positions.length === 1, "single box -> one position");
	approx(r1.width, 40, 0.01, "single box width == its own width");
	approx(r1.height, 24, 0.01, "single box height == its own height");
}

// Two boxes that share members must end up overlapping (sharing ⇒ proximity).
{
	const boxes = [box("a", 100, 60), box("b", 100, 60)];
	const sizeOf = () => 10;
	const sharedCount = () => 5; // frac = 5/10 = 0.5
	const r = siblingOverlapPack(boxes, 10, { sharedCount, sizeOf });
	const ra = rectOf(r.positions[0], boxes[0]);
	const rb = rectOf(r.positions[1], boxes[1]);
	const area = overlapArea(ra, rb);
	ok(area > 0, `sharing boxes must overlap, got area=${area}`);
}

// Two boxes that share nothing must NOT overlap and must keep at least `gap`.
{
	const boxes = [box("a", 100, 60), box("b", 100, 60)];
	const gap = 12;
	const r = siblingOverlapPack(boxes, gap, { sharedCount: () => 0, sizeOf: () => 10 });
	const ra = rectOf(r.positions[0], boxes[0]);
	const rb = rectOf(r.positions[1], boxes[1]);
	const area = overlapArea(ra, rb);
	ok(area === 0, `disjoint boxes must not overlap, got area=${area}`);
	const dx = Math.abs(r.positions[1].x - r.positions[0].x);
	const dy = Math.abs(r.positions[1].y - r.positions[0].y);
	const clearX = dx - (boxes[0].width / 2 + boxes[1].width / 2);
	const clearY = dy - (boxes[0].height / 2 + boxes[1].height / 2);
	ok(Math.max(clearX, clearY) >= gap - 0.5, `disjoint boxes must keep >= gap (${gap}) clearance, got clearX=${clearX} clearY=${clearY}`);
}

// Higher sharing fraction -> at least as much overlap area as lower sharing
// fraction, all else equal (monotonicity, not exact proportionality).
{
	const sizeOf = () => 10;
	const low = siblingOverlapPack(
		[box("a", 100, 60), box("b", 100, 60)], 10, { sharedCount: () => 1, sizeOf }, // frac 0.1
	);
	const high = siblingOverlapPack(
		[box("a", 100, 60), box("b", 100, 60)], 10, { sharedCount: () => 6, sizeOf }, // frac 0.6
	);
	const areaLow = overlapArea(rectOf(low.positions[0], box("a", 100, 60)), rectOf(low.positions[1], box("b", 100, 60)));
	const areaHigh = overlapArea(rectOf(high.positions[0], box("a", 100, 60)), rectOf(high.positions[1], box("b", 100, 60)));
	ok(areaHigh > areaLow, `higher sharing fraction must produce >= overlap area (low=${areaLow}, high=${areaHigh})`);
}

// A box never participates in attraction against itself / id not in sharedCount's
// domain (mirrors the OWN pseudo-box: sharedCount always returns 0 for it).
{
	const boxes = [box(" own", 80, 40), box("tag-y", 80, 40)];
	const r = siblingOverlapPack(boxes, 10, { sharedCount: () => 0, sizeOf: () => 5 });
	const area = overlapArea(rectOf(r.positions[0], boxes[0]), rectOf(r.positions[1], boxes[1]));
	ok(area === 0, `OWN-pseudo-box vs sibling tag (no sharing relation) must not overlap, got area=${area}`);
}
