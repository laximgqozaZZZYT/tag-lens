// jaccardSimilarity(a, b) — |A ∩ B| / |A ∪ B|, the intersection-over-union score
// shared by the related-notes scorer (view.ts) and the redundant-tag-pair finder
// (insight/compute.ts).
import { approx, ok } from "./assert";
import { jaccardFromCounts, jaccardSimilarity } from "../src/util/jaccard";

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

// jaccardFromCounts(sizeA, sizeB, intersection) — the count-based variant shared by
// the heatmap cell colour (draw-heatmap.ts) and its hover tooltip (view.ts).

// Zero co-occurrence between two non-empty tags → 0 (union = both sizes, inter 0).
ok(jaccardFromCounts(5, 3, 0) === 0, "no overlap → 0");

// Two size-0 tags → empty union → 0 (not NaN); this is what the old `uni > 0` guard protected.
ok(jaccardFromCounts(0, 0, 0) === 0, "empty union → 0");

// |A|=3, |B|=3, ∩=2 → union = 3+3-2 = 4 → 0.5. Mirrors the set-based half-overlap case.
approx(jaccardFromCounts(3, 3, 2), 0.5, 1e-9, "half overlap from counts");

// Fully nested / identical (|A|=|B|=∩) → union = size → 1.
ok(jaccardFromCounts(4, 4, 4) === 1, "identical counts → 1");

// Agrees with the set-based helper on the same data.
approx(
	jaccardFromCounts(3, 3, 2),
	jaccardSimilarity(new Set(["a", "b", "c"]), new Set(["b", "c", "d"])),
	1e-9,
	"count variant matches set variant",
);
