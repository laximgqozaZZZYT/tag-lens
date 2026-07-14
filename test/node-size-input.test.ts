// "Size (m × n)" parse + descriptor (extracted from settings-sections.ts
// renderNodeDisplaySection). Unlike the Min-font clamp, this REJECTS (returns
// null) instead of snapping: only finite integers in the closed [1, max] range
// are accepted; the caller picks max per scope (8 layer / 12 global).
import { ok } from "./assert";
import { nodeSizeInput, parseNodeSize } from "../src/panel/node-size-input";

// In-range integers pass through unchanged (including both bounds).
{
	ok(parseNodeSize("1", 8) === 1, "1 accepted (lower bound)");
	ok(parseNodeSize("8", 8) === 8, "8 accepted (layer upper bound)");
	ok(parseNodeSize("4", 8) === 4, "mid value unchanged");
	ok(parseNodeSize("12", 12) === 12, "12 accepted (global upper bound)");
}

// Out-of-range / below-1 rejects to null (no snapping).
{
	ok(parseNodeSize("0", 8) === null, "0 rejected (below 1)");
	ok(parseNodeSize("-3", 8) === null, "negative rejected");
	ok(parseNodeSize("9", 8) === null, "above layer max rejected");
	ok(parseNodeSize("13", 12) === null, "above global max rejected");
}

// The two scopes differ only in max: 9 is rejected at 8 but accepted at 12.
{
	ok(parseNodeSize("9", 8) === null, "9 rejected in layer scope");
	ok(parseNodeSize("9", 12) === 9, "9 accepted in global scope");
}

// parseInt semantics: fractions truncate, junk / empty rejects.
{
	ok(parseNodeSize("3.9", 8) === 3, "fraction truncated by parseInt");
	ok(parseNodeSize("", 8) === null, "empty string → null");
	ok(parseNodeSize("abc", 8) === null, "non-numeric → null");
}

// The number-input descriptor: min/max/step attributes whose bounds mirror the
// per-layer parseNodeSize range ([1, 8] integer).
{
	const d = nodeSizeInput();
	ok(d.attr.min === "1", "descriptor min mirrors lower bound");
	ok(d.attr.max === "8", "descriptor max mirrors layer upper bound");
	ok(d.attr.step === "1", "descriptor step is integer");
	// The min/max bounds are themselves accepted by the parser at that max.
	ok(
		parseNodeSize(d.attr.min, 8) === 1 && parseNodeSize(d.attr.max, 8) === 8,
		"bounds round-trip through the parser",
	);
}
