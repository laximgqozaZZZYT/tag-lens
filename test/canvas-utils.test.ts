import { ok } from "./assert";
import {
	createStripePattern,
	createStripeGradient,
	stripeGradientStops,
	stripeGradientRenderStops,
	stripeHuesForExtent,
	resolveNodeStripe,
	clusterHue,
	membershipStripeHues,
} from "../src/draw/canvas-utils";
import { NONE_BUCKET } from "../src/types";
import { setTheme, defaultTheme, theme } from "../src/draw/theme";

// === membershipStripeHues: which hues stripe a multi-tag NOTE ===
// A multi-tag note is an ∩ node → its card/icon stripes by its tag colours.
{
	const hues = membershipStripeHues(["a", "b", "c"]);
	ok(
		hues.length === 3 &&
			hues[0] === clusterHue("a") &&
			hues[1] === clusterHue("b") &&
			hues[2] === clusterHue("c"),
		"multi-tag note → one cluster hue per tag, in order",
	);
}
// Single-tag note → 1 hue (caller treats length<=1 as SOLID, no stripe).
{
	ok(membershipStripeHues(["only"]).length === 1, "single-tag note → 1 hue (solid)");
}
// NONE_BUCKET is NOT a tag → dropped so an untagged note is never multi-tag.
{
	ok(membershipStripeHues([NONE_BUCKET]).length === 0, "untagged note → 0 hues");
	const mixed = membershipStripeHues([NONE_BUCKET, "real"]);
	ok(
		mixed.length === 1 && mixed[0] === clusterHue("real"),
		"NONE_BUCKET dropped → a note with 1 real tag + (none) stays single-tag",
	);
}
// undefined memberships → empty (defensive).
{
	ok(membershipStripeHues(undefined).length === 0, "undefined memberships → 0 hues");
}

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
		// Render stops separate the coincident boundary by a sub-pixel epsilon so
		// adjacent bands never collapse in the rasteriser: band0 ends at .5, band1
		// STARTS a hair after .5. Widths stay ~equal (1/2) and order is preserved.
		ok(offs.length === 4 && offs[0] === 0 && offs[1] === 0.5 && offs[2] > 0.5 && offs[2] < 0.5001 + 1e-9 && offs[3] === 1,
			"2 hues → bands 0..0.5 and ~0.5..1, boundary separated by epsilon");
		// Bands alternate swatch ROLE (even=fill / odd=fillStrong) so two
		// near-identical-luma hues still read as distinct bands (stripeBandColor).
		// Hues are still applied in order: band 0 → hue[0], band 1 → hue[1].
		ok(
			calls[0].stops[0].color === theme().swatch(10, "fill") &&
				calls[0].stops[3].color === theme().swatch(200, "fillStrong"),
			"stops use the hues in order with alternating fill/fillStrong roles",
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

	// === REGRESSION: 3+ colours must keep ALL bands (the "3色以上→2色" bug) ===
	// A 3-tag (∩) node feeds 3 distinct hues. The gradient must emit a stop per
	// boundary AND every band must keep a strictly-positive width — no interior
	// band may collapse, otherwise the node reads as 2 colours / the 3rd band
	// disappears. We assert: 6 stops, each hue used once per band IN ORDER, the
	// boundary offsets are monotonically NON-decreasing with the duplicated
	// start nudged strictly past the previous end, and band widths stay ~1/3.
	{
		const { ctx, calls } = mkCtx();
		createStripeGradient(ctx as any, 0, 0, 30, 30, [10, 120, 250], /*isVertical=*/ true);
		const stops = calls[0].stops;
		ok(stops.length === 6, "3 hues → 6 render stops (2 per band)");
		// band starts = stops[0],[2],[4]; band ends = stops[1],[3],[5]
		const starts = [stops[0].offset, stops[2].offset, stops[4].offset];
		const ends = [stops[1].offset, stops[3].offset, stops[5].offset];
		ok(starts[0] === 0 && ends[2] === 1, "first band starts at 0, last ends at 1");
		// Every band has strictly-positive, near-1/3 width (no collapse).
		for (let i = 0; i < 3; i++) {
			const wdt = ends[i] - starts[i];
			ok(wdt > 0, `band ${i} has positive width (not collapsed)`);
			ok(Math.abs(wdt - 1 / 3) < 1e-3, `band ${i} width ~1/3`);
		}
		// Interior band STARTS are nudged strictly past the previous band's END,
		// so no two consecutive stops share an identical offset (the canvas
		// duplicate-offset fragility that drops interior bands for N>=3).
		ok(starts[1] > ends[0] && starts[2] > ends[1], "interior band starts separated from previous end");
		// Hues applied in order, alternating fill/fillStrong role per band index.
		ok(
			stops[0].color === theme().swatch(10, "fill") &&
				stops[2].color === theme().swatch(120, "fillStrong") &&
				stops[4].color === theme().swatch(250, "fill"),
			"3 bands → hues 10/120/250 in order with fill/fillStrong/fill roles",
		);
	}

	// 4 colours: same invariants — 8 stops, 4 non-collapsed ~1/4 bands.
	{
		const { ctx, calls } = mkCtx();
		createStripeGradient(ctx as any, 0, 0, 40, 40, [10, 90, 170, 250], /*isVertical=*/ false);
		const stops = calls[0].stops;
		ok(stops.length === 8, "4 hues → 8 render stops");
		for (let i = 0; i < 4; i++) {
			const wdt = stops[i * 2 + 1].offset - stops[i * 2].offset;
			ok(wdt > 0 && Math.abs(wdt - 1 / 4) < 1e-3, `4-colour band ${i} ~1/4 wide, not collapsed`);
		}
	}
}

// === stripeGradientRenderStops: EPS-separated boundaries (pure) =============
// The ideal stop list (stripeGradientStops) has duplicate boundary offsets;
// the RENDER list must separate every coincident boundary so adjacent bands
// never collapse in the canvas rasteriser, while keeping offsets in [0,1],
// monotonically non-decreasing, and band widths ~1/N.
{
	// 0 / 1 colour degenerate cases pass through unchanged.
	ok(stripeGradientRenderStops(0).length === 0, "0 colours → no render stops");
	const one = stripeGradientRenderStops(1);
	ok(one.length === 2 && one[0].offset === 0 && one[1].offset === 1, "1 colour → [0,1]");

	for (const n of [2, 3, 4, 5]) {
		const rs = stripeGradientRenderStops(n);
		ok(rs.length === 2 * n, `${n} colours → ${2 * n} render stops`);
		// Offsets clamped to [0,1] and non-decreasing.
		let prev = -1;
		let okMono = true;
		for (const s of rs) {
			if (s.offset < 0 || s.offset > 1 || s.offset < prev) okMono = false;
			prev = s.offset;
		}
		ok(okMono, `${n} colours → offsets in [0,1], non-decreasing`);
		// Each band keeps positive width and the index sequence is 0,0,1,1,...
		for (let i = 0; i < n; i++) {
			ok(rs[i * 2].index === i && rs[i * 2 + 1].index === i, `${n}: band ${i} uses index ${i}`);
			ok(rs[i * 2 + 1].offset - rs[i * 2].offset > 0, `${n}: band ${i} positive width`);
		}
		// First band starts at 0, last band ends at 1 (full coverage).
		ok(rs[0].offset === 0 && rs[rs.length - 1].offset === 1, `${n}: covers full [0,1]`);
	}
}

// === membershipStripeHues: DISTINCT hues (colliding tags don't dupe a band) ==
// Two different tag keys can hash to the SAME clusterHue; the stripe must list
// each hue once so the band COUNT equals the visible colour count (a 3-tag node
// whose two tags collide shows 2 bands, never a phantom duplicate that reads as
// "fewer colours than expected" / a smeared band).
{
	// Construct two keys that genuinely collide on clusterHue, if findable in a
	// small search; otherwise assert the de-dup contract structurally.
	let a = "", b = "";
	outer: for (let i = 0; i < 200; i++) {
		for (let j = i + 1; j < 200; j++) {
			if (clusterHue("k" + i) === clusterHue("k" + j)) { a = "k" + i; b = "k" + j; break outer; }
		}
	}
	if (a && b) {
		const hues = membershipStripeHues([a, b]);
		ok(hues.length === 1, "two colliding-hue tags → a single distinct band (no phantom dupe)");
	}
	// Three DISTINCT-hue tags stay three bands, in order (the common case).
	const three = membershipStripeHues(["aa", "bb", "cc"]);
	const distinct = new Set(three);
	ok(three.length === distinct.size, "distinct tags → no duplicate hues collapsed");
}

// === stripeHuesForExtent: minimum-band-width degrade =====================
// Icon Gallery ③ cells have no cell-size floor, so a multi-tag stripe can
// shrink until each band is sub-pixel and smears into a solid. This rule keeps
// each surviving band >= minBandPx wide, dropping trailing hues as needed, but
// never below 2 bands while 2 still fit (so a multi-tag cell stays striped),
// and only collapsing to a single hue (solid) when even 2 bands can't fit.
{
	// All bands already wide enough → full list, order preserved.
	ok(
		JSON.stringify(stripeHuesForExtent([10, 200, 300], 30, 2.5)) ===
			JSON.stringify([10, 200, 300]),
		"wide cell → all hues kept (each band 10px >= 2.5px)",
	);
	// Single / empty hue lists pass through untouched (no stripe to degrade).
	ok(JSON.stringify(stripeHuesForExtent([42], 1, 2.5)) === JSON.stringify([42]), "single hue → unchanged");
	ok(JSON.stringify(stripeHuesForExtent([], 1, 2.5)) === JSON.stringify([]), "empty → unchanged");
	// 3 hues across 6px @ minBand 2.5 → only 2 bands of >=2.5px fit → keep prefix of 2.
	ok(
		JSON.stringify(stripeHuesForExtent([10, 200, 300], 6, 2.5)) === JSON.stringify([10, 200]),
		"medium cell → widest visible prefix (2 bands), still striped",
	);
	// 4px @ minBand 2.5 → only 1 band fits → can't show even 2 bands → single hue (solid).
	ok(
		JSON.stringify(stripeHuesForExtent([10, 200, 300], 4, 2.5)) === JSON.stringify([10]),
		"tiny cell → single hue (caller draws solid, no smeared stripe)",
	);
	// Exactly enough for 2 bands → keep 2 (boundary case).
	ok(
		stripeHuesForExtent([10, 200, 300], 5, 2.5).length === 2,
		"5px @2.5 → exactly 2 bands fit → keep 2",
	);
	// Degenerate extent / threshold → no degrade (avoid div-by-zero / negatives).
	ok(
		JSON.stringify(stripeHuesForExtent([10, 200], 0, 2.5)) === JSON.stringify([10, 200]),
		"zero extent → pass through (degrade decided elsewhere)",
	);
}
