// Theme color derivation: pure logic tests.
// Anchors every derived colour to the resolved base background luminance
// (baseLum) so the renderer follows Obsidian's base colour across light,
// dark and custom (grey/sepia) themes. These tests cover the DOM-free
// pieces — colour parsing, relative luminance, and the swatch generator —
// which carry the real decisions. resolveTheme(el) is thin getComputedStyle
// glue and is exercised manually in Obsidian.
import { ok, approx } from "./assert";
import {
	parseColor,
	relativeLuminance,
	makeSwatch,
	makeOverlay,
	colorAlpha,
	type SwatchRole,
} from "../src/theme";

// --- parseColor ---------------------------------------------------------
{
	const a = parseColor("#0f1116");
	ok(!!a && a.r === 15 && a.g === 17 && a.b === 22, "parseColor: 6-digit hex");

	const b = parseColor("#fff");
	ok(!!b && b.r === 255 && b.g === 255 && b.b === 255, "parseColor: 3-digit hex");

	const c = parseColor("rgb(15, 17, 22)");
	ok(!!c && c.r === 15 && c.g === 17 && c.b === 22, "parseColor: rgb()");

	const d = parseColor("rgba(255, 0, 128, 0.5)");
	ok(!!d && d.r === 255 && d.g === 0 && d.b === 128, "parseColor: rgba() ignores alpha");

	ok(parseColor("") === null, "parseColor: empty string → null");
	ok(parseColor("not-a-color") === null, "parseColor: garbage → null");
}

// --- relativeLuminance --------------------------------------------------
{
	approx(relativeLuminance({ r: 255, g: 255, b: 255 }), 1.0, 0.001, "luminance: white ≈ 1");
	approx(relativeLuminance({ r: 0, g: 0, b: 0 }), 0.0, 0.001, "luminance: black = 0");
	const dark = relativeLuminance({ r: 15, g: 17, b: 22 });
	ok(dark < 0.1, "luminance: dark base (#0f1116) is low");
	const light = relativeLuminance({ r: 245, g: 245, b: 245 });
	ok(light > 0.85, "luminance: near-white base is high");
}

// --- makeSwatch: hue preserved -----------------------------------------
{
	const swDark = makeSwatch(0.05);
	ok(/hsl\(123,/.test(swDark(123, "fill")), "swatch: preserves input hue on dark base");
	const swLight = makeSwatch(0.95);
	ok(/hsl\(123,/.test(swLight(123, "fill")), "swatch: preserves input hue on light base");
}

// --- makeSwatch: alpha passthrough -------------------------------------
{
	const sw = makeSwatch(0.05);
	const s = sw(200, "fill", 0.5);
	ok(/^hsla\(200,/.test(s) && /, 0\.5\)$/.test(s), "swatch: alpha → hsla(...,a)");
	ok(/^hsl\(200,/.test(sw(200, "fill")), "swatch: no alpha → hsl()");
}

// helper: pull the L% out of an hsl/hsla string
function lightnessOf(s: string): number {
	const m = s.match(/hsla?\(\s*[\d.]+,\s*[\d.]+%,\s*([\d.]+)%/);
	if (!m) throw new Error(`FAIL: no lightness in "${s}"`);
	return parseFloat(m[1]) / 100;
}

// --- makeSwatch: contrast direction flips with base --------------------
{
	const dark = makeSwatch(0.06);   // dark base → fills must go lighter
	const light = makeSwatch(0.94);  // light base → fills must go darker
	const lFillDark = lightnessOf(dark(40, "fill"));
	const lFillLight = lightnessOf(light(40, "fill"));
	ok(lFillDark > 0.06, "swatch: fill lighter than a dark base");
	ok(lFillLight < 0.94, "swatch: fill darker than a light base");
	// Same hue+role on opposite bases land on opposite sides of mid.
	ok(lFillDark !== lFillLight, "swatch: base polarity changes lightness");
}

// --- makeSwatch: every role keeps a minimum contrast from the base -----
{
	const roles: SwatchRole[] = ["fill", "fillStrong", "stroke", "dim", "label", "tint"];
	// dim/tint are deliberately close to base (subtle); the prominent roles
	// must clearly separate from it.
	const minContrast: Record<SwatchRole, number> = {
		fill: 0.30, fillStrong: 0.40, stroke: 0.35, label: 0.40, dim: 0.10, tint: 0.03,
	};
	for (const base of [0.05, 0.45, 0.55, 0.95]) {
		const sw = makeSwatch(base);
		for (const role of roles) {
			const l = lightnessOf(sw(180, role));
			ok(Math.abs(l - base) >= minContrast[role] - 0.001,
				`swatch: role "${role}" keeps ≥${minContrast[role]} contrast from base ${base} (got |${l}-${base}|)`);
		}
	}
}

// --- makeSwatch: lightness stays in a renderable band ------------------
{
	for (const base of [0.0, 0.02, 0.5, 0.98, 1.0]) {
		const sw = makeSwatch(base);
		const l = lightnessOf(sw(300, "fillStrong"));
		ok(l >= 0.04 && l <= 0.96, `swatch: lightness clamped into [0.04,0.96] at base ${base} (got ${l})`);
	}
}

// --- makeOverlay: flips white/black with base --------------------------
{
	const onDark = makeOverlay(0.05);
	ok(onDark(0.1) === "rgba(255, 255, 255, 0.1)", "overlay: white on dark base");
	const onLight = makeOverlay(0.95);
	ok(onLight(0.1) === "rgba(0, 0, 0, 0.1)", "overlay: black on light base");
	ok(onDark(0.5) === "rgba(255, 255, 255, 0.5)", "overlay: alpha passthrough");
}

// --- colorAlpha: apply alpha to a resolved colour ----------------------
{
	ok(colorAlpha("#ff9d3f", 0.35) === "rgba(255, 157, 63, 0.35)", "colorAlpha: 6-hex → rgba");
	ok(colorAlpha("#fff", 0.5) === "rgba(255, 255, 255, 0.5)", "colorAlpha: 3-hex → rgba");
	ok(colorAlpha("rgb(40, 55, 80)", 0.9) === "rgba(40, 55, 80, 0.9)", "colorAlpha: rgb → rgba");
	ok(colorAlpha("rgba(40, 55, 80, 1)", 0.2) === "rgba(40, 55, 80, 0.2)", "colorAlpha: rgba alpha replaced");
	// Unparseable input (e.g. a CSS var or named colour) is returned untouched
	// so it still renders rather than throwing.
	ok(colorAlpha("var(--x)", 0.5) === "var(--x)", "colorAlpha: unparseable → unchanged");
}

// --- makeSwatch: unknown role falls back to fill -----------------------
{
	const sw = makeSwatch(0.05);
	// @ts-expect-error intentionally passing an invalid role
	const unknown = sw(90, "bogus");
	ok(unknown === sw(90, "fill"), "swatch: unknown role falls back to fill");
}
