// Characterization tests for the pure Droste (Icon Gallery) cell hit-test
// extracted from MiniGraphView.drosteHitTest(). The scan runs in REVERSE so a
// later-painted (on top) rect wins over an earlier overlapping one; bounds are
// inclusive on all four edges; a miss returns null. These lock that behaviour
// so the extraction can't drift from the original inline loop.
import { ok } from "./assert";
import { hitDrosteRect, type DrosteHitRect } from "../src/interaction/hit-test";

function rect(id: string, x0: number, y0: number, x1: number, y1: number): DrosteHitRect {
	return { id, x0, y0, x1, y1 };
}

// Empty list → always a miss.
ok(hitDrosteRect(0, 0, []) === null, "empty rects → null");

// A single rect: inside hits, outside misses.
const one = [rect("a", 10, 10, 20, 20)];
ok(hitDrosteRect(15, 15, one) === "a", "inside single rect → id");
ok(hitDrosteRect(5, 15, one) === null, "left of rect → null");
ok(hitDrosteRect(25, 15, one) === null, "right of rect → null");
ok(hitDrosteRect(15, 5, one) === null, "above rect → null");
ok(hitDrosteRect(15, 25, one) === null, "below rect → null");

// All four edges are inclusive.
ok(hitDrosteRect(10, 10, one) === "a", "top-left corner inclusive");
ok(hitDrosteRect(20, 20, one) === "a", "bottom-right corner inclusive");
ok(hitDrosteRect(20, 10, one) === "a", "top-right corner inclusive");
ok(hitDrosteRect(10, 20, one) === "a", "bottom-left corner inclusive");

// Overlapping rects: the LAST one in the array (painted on top) wins.
const stacked = [rect("under", 0, 0, 100, 100), rect("over", 40, 40, 60, 60)];
ok(hitDrosteRect(50, 50, stacked) === "over", "topmost (last) rect wins in overlap");
// A point only inside the earlier rect still resolves to it.
ok(hitDrosteRect(10, 10, stacked) === "under", "point outside top rect falls to under rect");

// Disjoint rects resolve to whichever contains the point.
const two = [rect("a", 0, 0, 10, 10), rect("b", 20, 20, 30, 30)];
ok(hitDrosteRect(25, 25, two) === "b", "second disjoint rect");
ok(hitDrosteRect(5, 5, two) === "a", "first disjoint rect");
ok(hitDrosteRect(15, 15, two) === null, "gap between disjoint rects → null");

console.log("hit-droste-rect: ok");
