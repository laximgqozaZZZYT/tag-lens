// Pure scoring helpers for the drosteFocus neighborhood scorer (view.ts).
// Kept DOM/obsidian-free so the graph-relevance rules can be unit-tested.

// Obsidian's metadataCache.resolvedLinks shape: source path → { target path →
// link count }. Missing keys mean "no outgoing links from that source".
export type ResolvedLinks = Record<string, Record<string, number>>;

// True when a resolved link exists in EITHER direction between `a` and `b`.
// Mirrors the asymmetric guard the scorer inlined (`resolvedLinks[a]?.[b]` OR
// `resolvedLinks[b] && resolvedLinks[b][a]`): a missing source key or a
// zero/absent count is treated as no link.
export function hasBidirectionalLink(resolvedLinks: ResolvedLinks, a: string, b: string): boolean {
	const forward = resolvedLinks[a]?.[b] ? true : false;
	const backward = resolvedLinks[b]?.[a] ? true : false;
	return forward || backward;
}

// Related-notes relevance score: weighted sum of the bidirectional-link flag
// (0/1) and the tag Jaccard similarity, using the W_link / W_tag weights.
export function relatedNoteScore(hasLink: boolean, jaccard: number, wLink: number, wTag: number): number {
	return wLink * (hasLink ? 1 : 0) + wTag * jaccard;
}

// A node paired with its relevance score. Generic over the node type so the
// module stays obsidian-free.
export interface ScoredNode<T> {
	node: T;
	score: number;
}

// Sort scored nodes by descending score, then split into the top `maxSize`
// (kept visible) and the remainder (filtered out). Mirrors the scorer's inline
// `sort((a,b)=>b.score-a.score)` + `i < maxNeighborhoodSize` index cutoff, but
// pure and non-mutating: the caller flips each node's `filtered` flag. Sort is
// stable (Node/V8), so ties keep their scored-list order. `maxSize <= 0` filters
// everything; `maxSize >= length` keeps all.
export function partitionNeighborhood<T>(
	scored: ScoredNode<T>[],
	maxSize: number,
): { visible: T[]; filtered: T[] } {
	const sorted = [...scored].sort((a, b) => b.score - a.score);
	const visible: T[] = [];
	const filtered: T[] = [];
	sorted.forEach((s, i) => {
		(i < maxSize ? visible : filtered).push(s.node);
	});
	return { visible, filtered };
}
