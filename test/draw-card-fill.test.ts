// F4 follow-up — card body fill/stroke PRECEDENCE. The on-canvas legend
// advertises the colour ENCODING channel; if the card body is instead painted
// with the automatic tag-cluster tint, the legend and the canvas disagree
// (the reported "凡例とノードの色が一致しない" bug). These tests pin the
// precedence: highlight > SET > explicit colour encoding > auto tag-tint > default.
import { ok } from "./assert";
import { cardFillStyle } from "../src/draw/draw-card";
import { setTheme } from "../src/draw/theme";
import type { ThemeTokens } from "../src/draw/theme";

// Minimal theme stub: every token returns a string we can recognise.
setTheme({
	warn: "WARN",
	accent: "ACCENT",
	canvasBgAlt: "BG",
	swatch: (hue: number, role: string) => `swatch:${hue}:${role}`,
} as unknown as ThemeTokens);

const ENC = "hsl(118, 65%, 55%)"; // a resolved colour-encoding output (e.g. out-degree)

// 1) THE BUG: an explicit colour encoding must beat the automatic tag-tint, so a
//    note that has BOTH a tint hue and an encoded fill paints the encoded colour.
{
	const cs = cardFillStyle({ highlighted: false, isSet: false, isTint: true, tintHue: 200, encFillColor: ENC });
	ok(cs.fill === ENC, `colour encoding beats tag-tint (got ${cs.fill})`);
	ok(cs.fill !== "swatch:200:tint", "card body is NOT the tag-tint when encoding is bound");
}

// 2) SET (tag-bubble) nodes are tags, not notes — they ignore the per-note encoding.
{
	const cs = cardFillStyle({ highlighted: false, isSet: true, fillHue: 30, isTint: false, encFillColor: ENC });
	ok(cs.fill === "swatch:30:fill", `SET fill wins over encoding (got ${cs.fill})`);
}

// 3) Highlight wins over everything.
{
	const cs = cardFillStyle({ highlighted: true, isSet: true, fillHue: 30, isTint: true, tintHue: 200, encFillColor: ENC });
	ok(cs.fill === "WARN" && cs.stroke === "WARN", "highlight wins");
}

// 4) No encoding bound → the tag-tint still applies (existing behaviour preserved).
{
	const cs = cardFillStyle({ highlighted: false, isSet: false, isTint: true, tintHue: 200 });
	ok(cs.fill === "swatch:200:tint", `tag-tint preserved when no encoding (got ${cs.fill})`);
}

// 5) Plain note (no set / tint / encoding) → default background, accent stroke.
{
	const cs = cardFillStyle({ highlighted: false, isSet: false, isTint: false });
	ok(cs.fill === "BG" && cs.stroke === "ACCENT", "plain note default");
}

// 6) Encoding stroke uses accent (so the outline reads against the encoded fill).
{
	const cs = cardFillStyle({ highlighted: false, isSet: false, isTint: false, encFillColor: ENC });
	ok(cs.fill === ENC && cs.stroke === "ACCENT", "encoded note: fill=enc, stroke=accent");
}

const STRIPE = "STRIPE_PATTERN"; // stand-in for a multi-tag ∩ stripe gradient

// 7) A multi-tag NOTE stripe beats the (tag-based) encFillColor — a solid fill on
//    a multi-tag note would contradict the ∩=striped legend.
{
	const cs = cardFillStyle({ highlighted: false, isSet: false, isTint: false, encFillColor: ENC, multiTagStripe: STRIPE });
	ok(cs.fill === STRIPE, `multi-tag stripe beats encFillColor (got ${cs.fill})`);
}

// 8) ...but SET fill still wins over a (note-only) stripe, and...
{
	const cs = cardFillStyle({ highlighted: false, isSet: true, fillHue: 30, isTint: false, multiTagStripe: STRIPE });
	ok(cs.fill === "swatch:30:fill", `SET fill wins over note stripe (got ${cs.fill})`);
}

// 9) ...highlight still wins over the stripe.
{
	const cs = cardFillStyle({ highlighted: true, isSet: false, isTint: false, multiTagStripe: STRIPE });
	ok(cs.fill === "WARN" && cs.stroke === "WARN", "highlight wins over note stripe");
}

// 10) Single-tag note (caller passes no stripe) keeps the encoding/tint/default
//     precedence unchanged — the stripe field is simply absent.
{
	const cs = cardFillStyle({ highlighted: false, isSet: false, isTint: true, tintHue: 200, encFillColor: ENC });
	ok(cs.fill === ENC, "single-tag note: no stripe → encoding still wins over tint");
}
