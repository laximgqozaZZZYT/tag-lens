// hasBidirectionalLink / relatedNoteScore — the drosteFocus neighborhood
// scorer's pure link-predicate + weighted score, extracted from view.ts.
import { approx, ok } from "./assert";
import { hasBidirectionalLink, relatedNoteScore } from "../src/query/related-score";

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
