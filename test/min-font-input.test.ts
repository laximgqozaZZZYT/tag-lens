// "Min font size (px)" clamp + descriptor (extracted from settings-sections.ts
// renderMinFontSection). Unlike the Jaccard parser, this never rejects: any raw
// input is floored and snapped into the closed [0, 48] integer range.
import { ok } from "./assert";
import { clampMinFont, minFontInput } from "../src/panel/min-font-input";

// In-range integers pass through unchanged (including both bounds).
{
	ok(clampMinFont("0") === 0, "0 stays 0 (lower bound)");
	ok(clampMinFont("48") === 48, "48 stays 48 (upper bound)");
	ok(clampMinFont("12") === 12, "mid value unchanged");
}

// Fractions floor toward zero; out-of-range snaps to the nearest bound.
{
	ok(clampMinFont("11.9") === 11, "fraction floored");
	ok(clampMinFont("-5") === 0, "below 0 clamps to 0");
	ok(clampMinFont("100") === 48, "above 48 clamps to 48");
}

// Junk / empty input falls back to 0 (Number(...) || 0).
{
	ok(clampMinFont("") === 0, "empty string → 0");
	ok(clampMinFont("abc") === 0, "non-numeric → 0");
}

// The number-input descriptor: min/max/step attributes whose bounds mirror
// clampMinFont's closed [0, 48] integer range.
{
	const d = minFontInput();
	ok(d.attr.min === "0", "descriptor min mirrors lower bound");
	ok(d.attr.max === "48", "descriptor max mirrors upper bound");
	ok(d.attr.step === "1", "descriptor step is integer");
	// The min/max bounds are themselves fixed points of the clamp.
	ok(
		clampMinFont(d.attr.min) === 0 && clampMinFont(d.attr.max) === 48,
		"bounds round-trip through the clamp",
	);
}
