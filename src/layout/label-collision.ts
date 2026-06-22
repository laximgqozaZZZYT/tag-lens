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

// Candidate CENTRES for a label, in preference order. The first is always the
// desired (current top-left strip) position; the rest fan out to the other
// corners, the horizontal edge midpoints, then the box centre as a last
// interior resort. All are clamped inside the box by the caller.
function candidates(inp: LabelPlacementInput): Array<{ x: number; y: number }> {
	const { box, w, h } = inp;
	const stripY = inp.y; // the desired top strip centre Y, relative to box top
	const yOffset = stripY - box.y; // how far below the box top the strip sits
	const topY = box.y + yOffset;
	const botY = box.y + box.h - yOffset;
	const leftX = box.x + w / 2;
	const rightX = box.x + box.w - w / 2;
	const midX = box.x + box.w / 2;
	const midY = box.y + box.h / 2;
	return [
		{ x: inp.x, y: inp.y }, // desired (top-left strip)
		{ x: rightX, y: topY }, // top-right
		{ x: leftX, y: botY }, // bottom-left
		{ x: rightX, y: botY }, // bottom-right
		{ x: midX, y: topY }, // top-centre
		{ x: midX, y: botY }, // bottom-centre
		{ x: midX, y: midY }, // box centre (last resort)
	];
}

export function placeClusterLabels(
	inputs: LabelPlacementInput[],
): Array<{ x: number; y: number }> {
	const n = inputs.length;
	const result: Array<{ x: number; y: number }> = new Array(n);
	if (n === 0) return result;

	// Process largest box area first: a bigger enclosure's label is more
	// important to keep at its natural strip; smaller boxes yield.
	const order = inputs
		.map((_, i) => i)
		.sort((a, b) => inputs[b].box.w * inputs[b].box.h - inputs[a].box.w * inputs[a].box.h);

	const placed: Aabb[] = [];
	for (const i of order) {
		const inp = inputs[i];
		const cands = candidates(inp);
		let chosen: { x: number; y: number } | null = null;
		for (const cand of cands) {
			const c = clampInside(cand.x, cand.y, inp.w, inp.h, inp.box);
			const box = aabbOf(c.x, c.y, inp.w, inp.h);
			let hit = false;
			for (const p of placed) {
				if (intersects(box, p)) {
					hit = true;
					break;
				}
			}
			if (!hit) {
				chosen = c;
				placed.push(box);
				break;
			}
		}
		if (!chosen) {
			// No clear candidate — fall back to the desired position (clamped),
			// best effort. Still record it so later (even smaller) labels try to
			// avoid it.
			chosen = clampInside(inp.x, inp.y, inp.w, inp.h, inp.box);
			placed.push(aabbOf(chosen.x, chosen.y, inp.w, inp.h));
		}
		result[i] = chosen;
	}
	return result;
}
