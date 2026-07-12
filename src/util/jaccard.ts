// Jaccard set similarity: |A ∩ B| / |A ∪ B|, returning 0 for two empty sets
// (an empty union). The intersection-over-union formula was re-derived inline in
// the related-notes scorer (view.ts) and the redundant-tag-pair finder
// (insight/compute.ts); this is the single pure source for the score. See
// `jaccardWithShared` below for the bridge-finder variant that also returns the
// shared elements.
export function jaccardSimilarity<T>(a: Set<T>, b: Set<T>): number {
	// Iterate the smaller set so the intersection scan is O(min(|A|,|B|)).
	const [small, large] = a.size <= b.size ? [a, b] : [b, a];
	let inter = 0;
	for (const el of small) if (large.has(el)) inter++;
	const union = a.size + b.size - inter;
	return union === 0 ? 0 : inter / union;
}

// Jaccard similarity that also returns the shared elements collected during the
// intersection scan, in `a`'s iteration order. The bridge-finder (query/
// bridge-finder.ts) needs both the score and the concrete `sharedTags` list, so
// unlike `jaccardSimilarity` it can't iterate the smaller set (that would reorder
// the shared elements). Empty union (both sets empty) → score 0 with an empty
// shared list, matching the bridge-finder's old `unionSize === 0` skip guard.
export function jaccardWithShared<T>(a: Set<T>, b: Set<T>): { jaccard: number; shared: T[] } {
	const shared: T[] = [];
	for (const el of a) if (b.has(el)) shared.push(el);
	const union = a.size + b.size - shared.length;
	return { jaccard: union === 0 ? 0 : shared.length / union, shared };
}

// Jaccard from precomputed co-occurrence counts: |A ∩ B| / (|A| + |B| - |A ∩ B|),
// returning 0 when the union is empty. Used where the two sets are never
// materialised — the heatmap cell colour (draw-heatmap.ts) and its hover tooltip
// (view.ts) both have `sizeA`, `sizeB`, and the intersection `count` in hand.
export function jaccardFromCounts(sizeA: number, sizeB: number, intersection: number): number {
	const union = sizeA + sizeB - intersection;
	return union > 0 ? intersection / union : 0;
}
