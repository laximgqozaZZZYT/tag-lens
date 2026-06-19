import { ok } from "./assert";
import {
	createStripePattern,
	createStripeGradient,
	stripeGradientStops,
	resolveNodeStripe,
	clusterHue,
} from "../src/draw/canvas-utils";
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

// === stripeGradientStops: equal HARD-edged bands ========================
// Pure stop-list maths for the ONE-CYCLE enclosure/node gradient. N colours
// → 2N stops; band i spans [i/N, (i+1)/N] and is emitted twice (start+end)
// so the colour holds flat and flips abruptly at every boundary.
{
	ok(stripeGradientStops(0).length === 0, "0 colours → no stops");

	const one = stripeGradientStops(1);
	ok(
		one.length === 2 && one[0].offset === 0 && one[1].offset === 1 &&
			one[0].index === 0 && one[1].index === 0,
		"1 colour → [0,1] both index 0 (whole box)",
	);

	const three = stripeGradientStops(3);
	ok(three.length === 6, "3 colours → 6 stops (2 per band)");
	// Band boundaries are exactly i/3, equal width, hard (duplicated) edges.
	const offs = three.map((s) => s.offset);
	const idxs = three.map((s) => s.index);
	ok(
		JSON.stringify(offs) === JSON.stringify([0, 1 / 3, 1 / 3, 2 / 3, 2 / 3, 1]),
		"3 colours → equal 1/3-width bands with duplicated boundary offsets",
	);
	ok(
		JSON.stringify(idxs) === JSON.stringify([0, 0, 1, 1, 2, 2]),
		"3 colours → each index used for one contiguous band",
	);
	// Every band is exactly 1/N wide.
	for (let i = 0; i < 3; i++) {
		const start = three[i * 2].offset;
		const end = three[i * 2 + 1].offset;
		ok(Math.abs(end - start - 1 / 3) < 1e-9, `band ${i} is 1/3 wide`);
	}
}

// === createStripeGradient: orientation + equal bands via a mock ctx =====
// The gradient branch needs a real ctx.createLinearGradient; tests run in
// plain Node, so we feed a minimal recording mock. This locks:
//   • ∩ (isVertical=true)  → gradient laid along X (x → x+w, y constant)
//   • ∪ (isVertical=false) → gradient laid along Y (y → y+h, x constant)
//   • N colours → 2N equal hard stops, in hue order
{
	type Stop = { offset: number; color: string };
	const mkCtx = () => {
		const calls: { coords: number[]; stops: Stop[] }[] = [];
		const ctx = {
			createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
				const rec = { coords: [x0, y0, x1, y1], stops: [] as Stop[] };
				calls.push(rec);
				return {
					addColorStop(offset: number, color: string) {
						rec.stops.push({ offset, color });
					},
				};
			},
		};
		return { ctx, calls };
	};

	// Empty → "gray"; single hue → solid swatch (no gradient created).
	{
		const { ctx, calls } = mkCtx();
		ok(createStripeGradient(ctx as any, 0, 0, 10, 10, [], true) === "gray", "no hues → gray");
		ok(
			createStripeGradient(ctx as any, 0, 0, 10, 10, [120], true) ===
				theme().swatch(120, "fill"),
			"single hue → solid swatch (no stripe)",
		);
		ok(calls.length === 0, "degenerate cases create no gradient");
	}

	// Zero-area box → solid fallback even with multiple hues (can't draw a band).
	{
		const { ctx, calls } = mkCtx();
		ok(
			createStripeGradient(ctx as any, 0, 0, 0, 10, [10, 200], true) ===
				theme().swatch(10, "fill"),
			"zero-width box → first-hue solid fallback",
		);
		ok(calls.length === 0, "zero-area box creates no gradient");
	}

	// ∩ vertical: bands run along X. 2 hues → 4 stops at 0,0.5,0.5,1.
	{
		const { ctx, calls } = mkCtx();
		createStripeGradient(ctx as any, 5, 7, 20, 30, [10, 200], /*isVertical=*/ true);
		ok(calls.length === 1, "vertical → one gradient");
		ok(
			JSON.stringify(calls[0].coords) === JSON.stringify([5, 7, 25, 7]),
			"∩ vertical → gradient along X (x→x+w, y constant)",
		);
		const offs = calls[0].stops.map((s) => s.offset);
		ok(JSON.stringify(offs) === JSON.stringify([0, 0.5, 0.5, 1]), "2 hues → equal hard stops 0,.5,.5,1");
		ok(
			calls[0].stops[0].color === theme().swatch(10, "fill") &&
				calls[0].stops[3].color === theme().swatch(200, "fill"),
			"stops use the hues in order (first band hue[0], last band hue[1])",
		);
	}

	// ∪ horizontal: bands run along Y.
	{
		const { ctx, calls } = mkCtx();
		createStripeGradient(ctx as any, 5, 7, 20, 30, [10, 200, 300], /*isVertical=*/ false, 0.5);
		ok(
			JSON.stringify(calls[0].coords) === JSON.stringify([5, 7, 5, 37]),
			"∪ horizontal → gradient along Y (y→y+h, x constant)",
		);
		ok(calls[0].stops.length === 6, "3 hues → 6 stops");
		ok(
			calls[0].stops[0].color === theme().swatch(10, "fill", 0.5),
			"alpha forwarded to swatch",
		);
	}
}
