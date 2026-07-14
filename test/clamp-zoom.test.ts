// clampZoom(value, min, max=2) — the two-sided fit-zoom clamp shared by every
// initial view-fit path (upset/lattice/heatmap/panorama/droste).
import { ok } from "./assert";
import { clampZoom } from "../src/util/clamp-zoom";

// In-range values pass through untouched.
ok(clampZoom(1, 0.05) === 1, "in-range → itself");
ok(clampZoom(0.5, 0.05) === 0.5, "in-range → itself");

// Below min snaps up to min (each real call site's floor).
ok(clampZoom(0.01, 0.05) === 0.05, "below 0.05 floor → 0.05");
ok(clampZoom(0.001, 0.005) === 0.005, "below 0.005 floor → 0.005 (panorama)");
ok(clampZoom(0.1, 0.45) === 0.45, "below MIN_READABLE 0.45 → 0.45 (lattice)");

// Above max snaps down to the default ceiling 2.
ok(clampZoom(5, 0.05) === 2, "above 2 → 2");
ok(clampZoom(3, 0.05) === 2, "above 2 → 2");

// Explicit max override (droste centres at up to 3×).
ok(clampZoom(5, 0.05, 3) === 3, "above 3 → 3 (droste)");
ok(clampZoom(2.5, 0.05, 3) === 2.5, "in [0.05,3] → itself (droste)");

// Equivalence: both old inline spellings fold into clampZoom because min <= max
// makes the clamp order-independent.
for (const x of [-1, 0.001, 0.05, 0.3, 1, 2, 3, 100]) {
	const viaMinMax = Math.min(2, Math.max(0.05, x));
	const viaMaxMin = Math.max(0.05, Math.min(2, x));
	ok(clampZoom(x, 0.05) === viaMinMax, `matches Math.min(2,Math.max(0.05,${x}))`);
	ok(clampZoom(x, 0.05) === viaMaxMin, `matches Math.max(0.05,Math.min(2,${x}))`);
}
