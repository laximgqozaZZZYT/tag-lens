import { ok } from "./assert";
import { createStripePattern, resolveNodeStripe, clusterHue } from "../src/draw/canvas-utils";
import { setTheme, defaultTheme, theme } from "../src/draw/theme";

// These run in plain Node (no `document`), so createStripePattern must take the
// flat-colour fallback path and NEVER throw. The DOM/CanvasPattern branch is
// exercised by the live renderer + E2E; here we lock the SSR/test contract.
setTheme(defaultTheme());

// Empty hue list → neutral "gray" sentinel (no set membership to colour).
{
	ok(createStripePattern([], true) === "gray", "no hues → gray");
	ok(createStripePattern([], false) === "gray", "no hues → gray (horizontal)");
}

// Single hue → that hue's solid fill swatch (orientation irrelevant).
{
	const expected = theme().swatch(120, "fill");
	ok(createStripePattern([120], true) === expected, "single hue → solid fill swatch (vertical)");
	ok(createStripePattern([120], false) === expected, "single hue → solid fill swatch (horizontal)");
	// alpha is forwarded to the swatch.
	const expectedA = theme().swatch(120, "fill", 0.5);
	ok(createStripePattern([120], true, 0.5) === expectedA, "single hue forwards alpha to swatch");
}

// Multiple hues with NO DOM → flat fallback = FIRST hue's fill swatch, never a
// throw. (In the browser this returns a CanvasPattern instead.)
{
	const v = createStripePattern([10, 200, 300], true);
	const h = createStripePattern([10, 200], false);
	ok(typeof v === "string", "multi-hue vertical → string fallback in non-DOM env");
	ok(typeof h === "string", "multi-hue horizontal → string fallback in non-DOM env");
	ok(v === theme().swatch(10, "fill"), "multi-hue fallback uses first hue's fill swatch");
	ok(typeof document === "undefined", "test env genuinely has no document (guard is real)");
}

// === resolveNodeStripe: orientation decision (∩ vertical / ∪ horizontal) ===
// Pure decision, DOM-free. The renderer feeds {hues, isVertical} straight into
// createStripePattern, so locking the orientation here guarantees:
//   • intersection / overlap node  → vertical bars
//   • union / set-core node        → horizontal bars
{
	// INTERSECTION (overlap) node — isUnionCore=false → VERTICAL.
	const inter = resolveNodeStripe(["a", "b"], /*isUnionCore=*/ false);
	ok(inter.isVertical === true, "intersection node → vertical stripes (isVertical=true)");
	ok(
		inter.hues.length === 2 &&
			inter.hues[0] === clusterHue("a") &&
			inter.hues[1] === clusterHue("b"),
		"intersection node → distinct cluster hues in membership order",
	);

	// UNION (set-core) node — isUnionCore=true → HORIZONTAL.
	const uni = resolveNodeStripe(["a", "b", "c"], /*isUnionCore=*/ true);
	ok(uni.isVertical === false, "union node → horizontal stripes (isVertical=false)");
	ok(uni.hues.length === 3, "union node → one hue per membership");

	// Orientation flips purely on the union/intersection flag for the SAME tags.
	const sameTags = ["x", "y"];
	ok(
		resolveNodeStripe(sameTags, false).isVertical !==
			resolveNodeStripe(sameTags, true).isVertical,
		"same tags: intersection and union resolve to opposite orientations",
	);

	// End-to-end: a union node's hues + orientation drive a HORIZONTAL pattern
	// request, an intersection node's a VERTICAL one. Non-DOM → flat fallback,
	// but the (hues,isVertical) contract is what the live renderer rasterises.
	const u = resolveNodeStripe(["a", "b"], true);
	const i = resolveNodeStripe(["a", "b"], false);
	ok(
		createStripePattern(u.hues, u.isVertical) ===
			createStripePattern(i.hues, i.isVertical),
		"non-DOM: both collapse to first hue's fill swatch (orientation only matters with a real canvas)",
	);

	// Single-membership node → one hue → createStripePattern collapses to a SOLID
	// fill (no visible stripe), so plain single-tag nodes are visually untouched.
	const solo = resolveNodeStripe(["a"], true);
	ok(
		createStripePattern(solo.hues, solo.isVertical) ===
			theme().swatch(clusterHue("a"), "fill"),
		"single-membership node → solid fill (no stripe)",
	);
}
