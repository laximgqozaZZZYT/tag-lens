// "Min tag size" clamp + descriptor (extracted from settings-sections.ts
// renderHeatmapMinTagControl). Like clampMinFont, this never rejects: any raw
// input is floored and snapped to a minimum of 1, with no upper bound.
import { ok } from "./assert";
import { clampHeatmapMinTag, heatmapMinTagInput } from "../src/panel/heatmap-min-tag-input";

// In-range integers pass through unchanged (including the lower bound).
{
	ok(clampHeatmapMinTag("1") === 1, "1 stays 1 (lower bound)");
	ok(clampHeatmapMinTag("12") === 12, "mid value unchanged");
	ok(clampHeatmapMinTag("9999") === 9999, "large value unchanged (no upper bound)");
}

// Fractions floor toward zero; below 1 snaps to 1.
{
	ok(clampHeatmapMinTag("11.9") === 11, "fraction floored");
	ok(clampHeatmapMinTag("0") === 1, "0 clamps to 1");
	ok(clampHeatmapMinTag("-5") === 1, "below 1 clamps to 1");
}

// Junk / empty input falls back to 1 (Number(...) || 1).
{
	ok(clampHeatmapMinTag("") === 1, "empty string → 1");
	ok(clampHeatmapMinTag("abc") === 1, "non-numeric → 1");
}

// The number-input descriptor: a min attribute whose bound mirrors the clamp's
// lower bound of 1 (no max — unbounded above).
{
	const d = heatmapMinTagInput();
	ok(d.attr.min === "1", "descriptor min mirrors lower bound");
	// The min bound is itself a fixed point of the clamp.
	ok(clampHeatmapMinTag(d.attr.min) === 1, "min bound round-trips through the clamp");
}
