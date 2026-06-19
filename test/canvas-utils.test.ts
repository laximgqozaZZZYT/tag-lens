import { ok } from "./assert";
import { createStripePattern } from "../src/draw/canvas-utils";
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
