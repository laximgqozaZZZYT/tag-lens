// Cluster-label collision avoidance. Used by `bubblesets` mode only, where
// cross-cutting tag enclosures intentionally overlap (siblingOverlapPack /
// degree-cascade region placement). Their label cells — each computed
// independently as the box's top-left strip — then land on top of each other
// and the tag names become unreadable. `drawClusterLabels()` assumes label
// cells never collide (true for euler-true and every non-overlapping mode), so
// the fix happens HERE, at layout time: we hand the renderer label cells that
// are already de-conflicted.
//
// Strategy mirrors the existing `drawOverviewLabels()` convention in
// draw-helpers.ts: greedy, largest-box-first, a fixed list of candidate anchor
// positions tried in order, the first non-colliding candidate wins, and a
// best-effort fallback to the desired position if none is clear (we never drop
// a label — the renderer, not this pass, decides visibility).

export interface LabelPlacementInput {
	key: string;
	// Desired (default) label-cell CENTRE + size, as currently computed by
	// layoutEulerTrue's place() closure.
	x: number;
	y: number;
	w: number;
	h: number;
	// The cluster's MAIN box (top-left origin). Candidate alternative anchors
	// are derived from its corners / edge midpoints / centre.
	box: { x: number; y: number; w: number; h: number };
}

interface Aabb {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

function aabbOf(cx: number, cy: number, w: number, h: number): Aabb {
	return { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
}

function intersects(a: Aabb, b: Aabb): boolean {
	return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

// Clamp a desired CENTRE so an w×h cell stays fully inside `box`. If the box is
// smaller than the cell on an axis, centre on the box (best effort).
function clampInside(
	cx: number,
	cy: number,
	w: number,
	h: number,
	box: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
	const minX = box.x + w / 2;
	const maxX = box.x + box.w - w / 2;
	const minY = box.y + h / 2;
	const maxY = box.y + box.h - h / 2;
	const x = maxX >= minX ? Math.min(Math.max(cx, minX), maxX) : box.x + box.w / 2;
	const y = maxY >= minY ? Math.min(Math.max(cy, minY), maxY) : box.y + box.h / 2;
	return { x, y };
}

// Candidate CENTRES for a label, in preference order.
//
// INSIDE candidates come first: the desired (top-left strip) position, then a
// row of five evenly-spread anchors along the box's top edge, the same five
// along the bottom edge, and the box centre as the last interior resort. Five
// horizontal anchors per edge (vs. the old left/centre/right three) matter when
// several big cross-cutting boxes share nearly the same rect — e.g. `_all`,
// `paradiso` and `timeline` all spanning every node have IDENTICAL boxes, so
// their labels must spread along the shared edge rather than stack.
//
// OUTSIDE candidates come last (flagged `outside`): a vertical LADDER of rows
// stepping progressively ABOVE the box top and BELOW the box bottom. A box
// buried inside a dense overlap (e.g. `sequence`, 2 nodes, or any inner view
// whose title strip sits over a SIBLING box's cards) has no clear interior
// spot — every interior position is covered by cards or another label — so it
// must climb out of the node cloud entirely. One row was not enough: an inner
// box's first row up is still inside the parent's cards, so the ladder keeps
// going (up to `LADDER_ROWS` rows each way) until it clears all cards. The
// caller clamps these on X only (keeping the label horizontally over its box)
// and leaves Y free. INSIDE candidates always win when any is clear, so a box
// with room to spare never sends its label outside (keeps
// test/label-collision.test.ts's "stays inside its box" invariant for the
// non-degenerate cases). Rows alternate up/down so labels prefer the nearest
// clear band rather than all stacking on one side.
const LADDER_ROWS = 40;
interface Candidate {
	x: number;
	y: number;
	outside?: boolean;
}
function candidates(inp: LabelPlacementInput): Candidate[] {
	const { box, w, h } = inp;
	const yOffset = inp.y - box.y; // how far below the box top the strip sits
	const topY = box.y + yOffset;
	// LEFT-ANCHORED: the label is pinned to the box's TOP-LEFT corner (per the
	// user's spec "labels fixed top-left"). When two labels would collide we do
	// NOT slide them sideways along the edge anymore — we step the loser
	// straight UP, stacking labels in a left-aligned column above the cloud.
	// The single inside anchor is the desired top-left strip; everything else
	// is the vertical ladder. The caller then GROWS each box upward to contain
	// its final (possibly lifted) label, so the label always reads as that
	// box's own top-left title and the boxes end up vertically staggered.
	const leftX = box.x + w / 2; // left-aligned anchor X (cell centre at box left)
	// Desired = the caller's top-left strip (already pinned there by box-follow).
	const inside: Candidate[] = [{ x: inp.x, y: inp.y }];
	// Vertical ladder, LEFT-ALIGNED: step straight up (then, as a last resort,
	// down) from the top-left strip, one label-height per rung, so colliding
	// labels stack in a tidy left column rather than fanning across the edge.
	const step = h * 1.1;
	const outside: Candidate[] = [];
	for (let k = 1; k <= LADDER_ROWS; k++) {
		outside.push({ x: leftX, y: topY - k * step, outside: true });
	}
	for (let k = 1; k <= LADDER_ROWS; k++) {
		outside.push({ x: leftX, y: box.y + box.h + h * 0.7 + (k - 1) * step, outside: true });
	}
	return [...inside, ...outside];
}

// Clamp a CENTRE so an w×h cell stays horizontally inside `box`; Y is kept as-is
// (used for the outside escape candidates, which intentionally sit above/below).
function clampX(
	cx: number,
	cy: number,
	w: number,
	box: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
	const minX = box.x + w / 2;
	const maxX = box.x + box.w - w / 2;
	const x = maxX >= minX ? Math.min(Math.max(cx, minX), maxX) : box.x + box.w / 2;
	return { x, y: cy };
}

export function placeClusterLabels(
	inputs: LabelPlacementInput[],
	// Node-card rectangles (or any other content) the labels must also avoid.
	// Seeded as pre-placed obstacles so a label never lands on top of a card —
	// the desired top-strip position is already card-free (box-follow reserves
	// the strip above the cards), so most labels stay put; only labels forced
	// to move (mutual collisions) skip card-covered candidates and prefer the
	// card-free top strip or the above/below-box escapes. Optional — omitting
	// it reproduces the prior label-vs-label-only behavior exactly.
	occupied: Aabb[] = [],
): Array<{ x: number; y: number }> {
	const n = inputs.length;
	const result = new Array<{ x: number; y: number }>(n);
	if (n === 0) return result;

	// Process largest box area first: a bigger enclosure's label is more
	// important to keep at its natural strip; smaller boxes yield.
	const order = inputs
		.map((_, i) => i)
		.sort((a, b) => inputs[b].box.w * inputs[b].box.h - inputs[a].box.w * inputs[a].box.h);

	// Labels avoid each other AND the seeded obstacles (cards). Obstacles are
	// never themselves moved; they only repel labels.
	const labelBoxes: Aabb[] = [];
	const collides = (box: Aabb): boolean =>
		labelBoxes.some((p) => intersects(box, p)) || occupied.some((p) => intersects(box, p));
	for (const i of order) {
		const inp = inputs[i];
		const cands = candidates(inp);
		let chosen: { x: number; y: number } | null = null;
		for (const cand of cands) {
			const c = cand.outside
				? clampX(cand.x, cand.y, inp.w, inp.box)
				: clampInside(cand.x, cand.y, inp.w, inp.h, inp.box);
			const box = aabbOf(c.x, c.y, inp.w, inp.h);
			if (!collides(box)) {
				chosen = c;
				labelBoxes.push(box);
				break;
			}
		}
		if (!chosen) {
			// No fixed candidate was clear — GUARANTEE separation by scanning
			// straight up from the box top until a card- and label-free slot is
			// found. The space above the whole node cloud is always clear, so
			// this terminates; the label ends up stacked above its box rather
			// than overlapping anything. (Replaces the old "fall back to the
			// desired position even though it collides" behavior — that was the
			// source of the residual label-on-label / label-on-card overlaps.)
			const x = inp.box.x + inp.w / 2; // left-aligned
			const stepUp = inp.h * 0.55;
			let y = inp.box.y - inp.h * 0.7;
			for (let g = 0; g < 4000; g++) {
				const b = aabbOf(x, y, inp.w, inp.h);
				if (!collides(b)) {
					chosen = { x, y };
					labelBoxes.push(b);
					break;
				}
				y -= stepUp;
			}
			if (!chosen) {
				chosen = clampInside(inp.x, inp.y, inp.w, inp.h, inp.box);
				labelBoxes.push(aabbOf(chosen.x, chosen.y, inp.w, inp.h));
			}
		}
		result[i] = chosen;
	}
	return result;
}
