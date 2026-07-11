// Jaccard set similarity: |A ∩ B| / |A ∪ B|, returning 0 for two empty sets
// (an empty union). The intersection-over-union formula was re-derived inline in
// the related-notes scorer (view.ts) and the redundant-tag-pair finder
// (insight/compute.ts); this is the single pure source for the score. The
// bridge-finder keeps its own loop because it also collects the shared elements.
export function jaccardSimilarity<T>(a: Set<T>, b: Set<T>): number {
	// Iterate the smaller set so the intersection scan is O(min(|A|,|B|)).
	const [small, large] = a.size <= b.size ? [a, b] : [b, a];
	let inter = 0;
	for (const el of small) if (large.has(el)) inter++;
	const union = a.size + b.size - inter;
	return union === 0 ? 0 : inter / union;
}
