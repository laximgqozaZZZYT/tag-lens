// pointInRect(px, py, {x,y,w,h}) — the inclusive-bounds screen-space hit test
// shared by the on-canvas legend interactions in view.ts.
import { ok } from "./assert";
import { pointInRect } from "../src/util/point-in-rect";

const r = { x: 10, y: 20, w: 100, h: 40 }; // covers [10,110] × [20,60]

// Interior + centre.
ok(pointInRect(50, 40, r), "interior point → inside");
ok(pointInRect(60, 40, r), "centre → inside");

// All four edges are inclusive.
ok(pointInRect(10, 40, r), "left edge x → inside");
ok(pointInRect(110, 40, r), "right edge x+w → inside");
ok(pointInRect(50, 20, r), "top edge y → inside");
ok(pointInRect(50, 60, r), "bottom edge y+h → inside");

// The four corners are inside.
ok(pointInRect(10, 20, r), "top-left corner → inside");
ok(pointInRect(110, 60, r), "bottom-right corner → inside");

// Just outside each edge → outside.
ok(!pointInRect(9, 40, r), "left of x → outside");
ok(!pointInRect(111, 40, r), "right of x+w → outside");
ok(!pointInRect(50, 19, r), "above y → outside");
ok(!pointInRect(50, 61, r), "below y+h → outside");

// Zero-size rect only contains its own point.
const z = { x: 5, y: 5, w: 0, h: 0 };
ok(pointInRect(5, 5, z), "zero-size rect contains its own point");
ok(!pointInRect(6, 5, z), "zero-size rect excludes any other point");

// Equivalence with the old inline spelling across a grid of samples.
for (const px of [0, 10, 55, 110, 200]) {
	for (const py of [0, 20, 45, 60, 200]) {
		const inline = px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
		ok(pointInRect(px, py, r) === inline, `matches inline at (${px},${py})`);
	}
}
