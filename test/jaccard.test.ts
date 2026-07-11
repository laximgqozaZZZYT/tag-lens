// jaccardSimilarity(a, b) — |A ∩ B| / |A ∪ B|, the intersection-over-union score
// shared by the related-notes scorer (view.ts) and the redundant-tag-pair finder
// (insight/compute.ts).
import { approx, ok } from "./assert";
import { jaccardSimilarity } from "../src/util/jaccard";

// Two empty sets → empty union → 0 (not NaN). This is the case the old
// size-guard in view.ts protected against, now folded into the helper.
ok(jaccardSimilarity(new Set(), new Set()) === 0, "empty ∪ empty → 0");

// One empty → 0 (nothing shared).
ok(jaccardSimilarity(new Set(["a"]), new Set()) === 0, "empty side → 0");

// Identical sets → 1.
ok(jaccardSimilarity(new Set(["a", "b"]), new Set(["a", "b"])) === 1, "identical → 1");

// Disjoint sets → 0.
ok(jaccardSimilarity(new Set(["a", "b"]), new Set(["c", "d"])) === 0, "disjoint → 0");

// Partial overlap: {a,b,c} ∩ {b,c,d} = {b,c} (2), ∪ = {a,b,c,d} (4) → 0.5.
approx(jaccardSimilarity(new Set(["a", "b", "c"]), new Set(["b", "c", "d"])), 0.5, 1e-9, "half overlap");

// Symmetric: order of args must not matter (helper iterates the smaller set).
{
	const a = new Set(["a"]);
	const b = new Set(["a", "b", "c"]);
	approx(jaccardSimilarity(a, b), jaccardSimilarity(b, a), 1e-9, "symmetric");
	approx(jaccardSimilarity(a, b), 1 / 3, 1e-9, "1 shared / 3 union");
}
