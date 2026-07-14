import { ok } from "./assert";
import { metaBadges } from "../src/draw/meta-badges";

// Characterization tests for the pure meta-badge descriptors extracted from
// MiniGraphView.drawGlobalDisplayFallbacks(). They lock label/colour/order so
// the extraction can't drift from the original inline drawBadge(...) calls.

// All three gates on → maturity, size, jaccard in that exact stacking order,
// each with its original label + colour; size interpolates rows x cols.
{
	const b = metaBadges(
		{ drawMaturityBadge: true, drawSizeBadge: true, drawJaccardBadge: true },
		2,
		3,
	);
	ok(b.length === 3, "all three badges present");
	ok(b[0].label === "Maturity: ON" && b[0].color === "rgba(0, 150, 0, 0.8)", "maturity first");
	ok(b[1].label === "Size: 2x3" && b[1].color === "rgba(50, 150, 200, 0.8)", "size second, RxC label");
	ok(b[2].label === "Jaccard: ON" && b[2].color === "rgba(100, 100, 100, 0.8)", "jaccard third");
}

// All gates off → no badges.
{
	const b = metaBadges(
		{ drawMaturityBadge: false, drawSizeBadge: false, drawJaccardBadge: false },
		1,
		1,
	);
	ok(b.length === 0, "no gates → no badges");
}

// Order is stable regardless of which gates fire: only maturity + jaccard →
// they keep their positions (maturity before jaccard), size skipped.
{
	const b = metaBadges(
		{ drawMaturityBadge: true, drawSizeBadge: false, drawJaccardBadge: true },
		5,
		5,
	);
	ok(b.length === 2, "two gates → two badges");
	ok(b[0].label === "Maturity: ON", "maturity kept first");
	ok(b[1].label === "Jaccard: ON", "jaccard kept last (size hole closed)");
}
