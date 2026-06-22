export interface RegionResult {
	tags: string[];
	rect: { x: number; y: number; w: number; h: number };
}

// All size-`d` combinations of `items`, as arrays preserving `items`' order.
function combinations<T>(items: T[], d: number): T[][] {
	const out: T[][] = [];
	const cur: T[] = [];
	const recur = (start: number): void => {
		if (cur.length === d) {
			out.push([...cur]);
			return;
		}
		for (let i = start; i < items.length; i++) {
			cur.push(items[i]);
			recur(i + 1);
			cur.pop();
		}
	};
	recur(0);
	return out;
}

// AABB intersection of a list of rects (sequential reduce). Returns null if
// any rect is missing or the running intersection degenerates (non-positive
// width or height) at any step.
function intersectAll(
	tags: string[],
	mainRectOf: (tag: string) => { x: number; y: number; w: number; h: number } | null,
): { x: number; y: number; w: number; h: number } | null {
	let left = -Infinity, top = -Infinity, right = Infinity, bottom = Infinity;
	for (const t of tags) {
		const r = mainRectOf(t);
		if (!r) return null;
		left = Math.max(left, r.x);
		top = Math.max(top, r.y);
		right = Math.min(right, r.x + r.w);
		bottom = Math.min(bottom, r.y + r.h);
		if (right - left <= 0 || bottom - top <= 0) return null;
	}
	return { x: left, y: top, w: right - left, h: bottom - top };
}

// Cascading degree search: try the node's full signature first (highest
// degree); if its intersection isn't drawable, drop one tag at a time
// (every combination, at each decreasing degree) until one is. Degree 1 is
// the guaranteed base case (a tag's own rect, assumed always present for
// any tag actually in the signature).
export function resolveNodeRegion(
	signature: string[],
	mainRectOf: (tag: string) => { x: number; y: number; w: number; h: number } | null,
	minSize?: { w: number; h: number },
): RegionResult | null {
	const k = signature.length;
	if (k === 0) return null;
	if (k === 1) {
		const r = mainRectOf(signature[0]);
		return r ? { tags: [...signature], rect: r } : null;
	}

	const degrees: number[] = [];
	if (k > 8) {
		degrees.push(k, k - 1, k - 2, 1);
	} else {
		for (let d = k; d >= 1; d--) degrees.push(d);
	}

	for (const d of degrees) {
		const combos = combinations(signature, d);
		let best: RegionResult | null = null;
		let bestArea = -1;
		for (const combo of combos) {
			const rect = intersectAll(combo, mainRectOf);
			if (!rect) continue;
			// Degree 1 is the unconditional guaranteed floor: never gated by
			// minSize, even if undersized — there is nowhere left to cascade.
			if (d > 1 && minSize && (rect.w < minSize.w || rect.h < minSize.h)) continue;
			const area = rect.w * rect.h;
			const sortedTags = [...combo].sort();
			const key = sortedTags.join("");
			if (
				area > bestArea ||
				(area === bestArea && best !== null && key < best.tags.join(""))
			) {
				bestArea = area;
				best = { tags: sortedTags, rect };
			}
		}
		if (best) return best;
	}
	return null;
}
