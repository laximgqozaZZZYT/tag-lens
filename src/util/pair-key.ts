// Canonical key for an UNORDERED pair of ids. The two endpoints are sorted
// into dictionary order and joined with `|`, so `(a, b)` and `(b, a)` collapse
// to the same string. Used to dedup/match undirected relations without caring
// which end is the "source" — the ghost-edge linked-pair set (view.ts) and the
// bridge-finder's seen-pair guard both key on this identical idiom.
export function undirectedPairKey(a: string, b: string): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}
