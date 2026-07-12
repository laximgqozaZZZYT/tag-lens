// clampScroll(value, max) — the [0, max] scrollbar-offset clamp shared by the
// on-canvas legend scrollbar (thumb-Y jump + thumb-drag/wheel scroll position)
// in view.ts.
import { ok } from "./assert";
import { clampScroll } from "../src/util/clamp-scroll";

// In-range passthrough.
ok(clampScroll(50, 100) === 50, "in-range value unchanged");
ok(clampScroll(0, 100) === 0, "zero passes through");
ok(clampScroll(100, 100) === 100, "at max passes through");

// Below 0 floors at 0; above max ceils at max.
ok(clampScroll(-5, 100) === 0, "negative → 0");
ok(clampScroll(150, 100) === 100, "over max → max");

// Degenerate max (nothing to scroll): everything collapses to 0.
ok(clampScroll(0, 0) === 0, "max 0 → 0");
ok(clampScroll(25, 0) === 0, "positive with max 0 → 0");
ok(clampScroll(-25, 0) === 0, "negative with max 0 → 0");

// Equivalence with the old inline spelling across a grid of samples.
for (const max of [0, 40, 350]) {
	for (const v of [-10, 0, 20, 350, 500]) {
		const inline = Math.max(0, Math.min(max, v));
		ok(clampScroll(v, max) === inline, `matches inline at (${v}, ${max})`);
	}
}
