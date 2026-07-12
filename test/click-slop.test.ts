// exceedsClickSlop(dx, dy) — the Manhattan click-vs-drag dead-zone view.ts's
// mousemove handler uses to flip `pointerMoved`.
import { ok } from "./assert";
import { CLICK_SLOP_PX, exceedsClickSlop } from "../src/util/click-slop";

// Default slop is the historical 4px.
ok(CLICK_SLOP_PX === 4, "default slop is 4px");

// Inside the dead-zone (Manhattan sum ≤ 4) → not moved.
ok(!exceedsClickSlop(0, 0), "no movement → inside");
ok(!exceedsClickSlop(4, 0), "4px on one axis → inside (boundary, strict >)");
ok(!exceedsClickSlop(2, 2), "2+2 == 4 → inside (boundary)");
ok(!exceedsClickSlop(-4, 0), "sign-independent: -4 → inside");
ok(!exceedsClickSlop(-2, -2), "both negative summing to 4 → inside");

// Beyond the dead-zone → moved.
ok(exceedsClickSlop(5, 0), "5px on one axis → moved");
ok(exceedsClickSlop(3, 2), "3+2 == 5 → moved");
ok(exceedsClickSlop(-3, -3), "both negative summing to 6 → moved");

// Custom slop threshold.
ok(!exceedsClickSlop(10, 0, 10), "10 with slop 10 → inside (boundary)");
ok(exceedsClickSlop(11, 0, 10), "11 with slop 10 → moved");

// Equivalence with the old inline spelling across a grid of samples.
for (const dx of [-10, -4, -1, 0, 1, 4, 10]) {
	for (const dy of [-10, -4, -1, 0, 1, 4, 10]) {
		const inline = Math.abs(dx) + Math.abs(dy) > 4;
		ok(exceedsClickSlop(dx, dy) === inline, `matches inline at (${dx},${dy})`);
	}
}
