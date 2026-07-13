// hasBidirectionalLink / relatedNoteScore — the drosteFocus neighborhood
// scorer's pure link-predicate + weighted score, extracted from view.ts.
import { approx, ok } from "./assert";
import { hasBidirectionalLink, partitionNeighborhood, relatedNoteScore } from "../src/query/related-score";

// Forward link only (a → b) counts.
ok(hasBidirectionalLink({ a: { b: 1 } }, "a", "b"), "forward link → true");

// Backward link only (b → a) counts (the asymmetric-guard branch).
ok(hasBidirectionalLink({ b: { a: 1 } }, "a", "b"), "backward link → true");

// Both directions present → true.
ok(hasBidirectionalLink({ a: { b: 1 }, b: { a: 1 } }, "a", "b"), "both → true");

// No link either way → false.
ok(!hasBidirectionalLink({ a: { c: 1 } }, "a", "b"), "unrelated targets → false");

// Missing source keys must not throw (the `?.` / `&&` guard) and → false.
ok(!hasBidirectionalLink({}, "a", "b"), "empty map → false");

// Zero-count entry is falsy → treated as no link.
ok(!hasBidirectionalLink({ a: { b: 0 } }, "a", "b"), "zero count → false");

// Score formula: wLink * (hasLink?1:0) + wTag * jaccard.
approx(relatedNoteScore(true, 0.5, 3, 2), 3 * 1 + 2 * 0.5, 1e-9, "linked + jaccard");
approx(relatedNoteScore(false, 0.5, 3, 2), 2 * 0.5, 1e-9, "unlinked → link term drops");
approx(relatedNoteScore(true, 0, 3, 2), 3, 1e-9, "linked, no tag overlap");
approx(relatedNoteScore(false, 0, 3, 2), 0, 1e-9, "no relation → 0");

// partitionNeighborhood — sort desc + top-`maxSize` cutoff.
const scored = [
	{ node: "low", score: 1 },
	{ node: "high", score: 5 },
	{ node: "mid", score: 3 },
];
{
	const { visible, filtered } = partitionNeighborhood(scored, 2);
	ok(JSON.stringify(visible) === JSON.stringify(["high", "mid"]), "top-2 by score desc → visible");
	ok(JSON.stringify(filtered) === JSON.stringify(["low"]), "remainder → filtered");
}

// maxSize >= length keeps all; nothing filtered.
{
	const { visible, filtered } = partitionNeighborhood(scored, 10);
	ok(JSON.stringify(visible) === JSON.stringify(["high", "mid", "low"]), "maxSize ≥ length → all visible");
	ok(filtered.length === 0, "maxSize ≥ length → none filtered");
}

// maxSize <= 0 filters everything.
{
	const { visible, filtered } = partitionNeighborhood(scored, 0);
	ok(visible.length === 0, "maxSize 0 → none visible");
	ok(JSON.stringify(filtered) === JSON.stringify(["high", "mid", "low"]), "maxSize 0 → all filtered (sorted)");
}

// Ties keep scored-list order (stable sort).
{
	const tied = [
		{ node: "a", score: 2 },
		{ node: "b", score: 2 },
		{ node: "c", score: 2 },
	];
	const { visible } = partitionNeighborhood(tied, 2);
	ok(JSON.stringify(visible) === JSON.stringify(["a", "b"]), "ties keep input order");
}

// Input array is not mutated.
{
	const input = [
		{ node: "x", score: 1 },
		{ node: "y", score: 9 },
	];
	partitionNeighborhood(input, 1);
	ok(input[0].node === "x" && input[1].node === "y", "input order preserved (non-mutating)");
}
