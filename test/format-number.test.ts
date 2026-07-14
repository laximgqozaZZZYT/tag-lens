// formatLegendNumber(n) — the compact legend-label formatter shared by the
// mode-intrinsic legend (draw/mode-legend.ts) and the encoding legend
// (draw/legend-spec.ts), extracted from two byte-identical local `fmt`/`fmtNum`.
import { ok } from "./assert";
import { formatLegendNumber } from "../src/util/format-number";

// Non-finite → em-dash (missing/NaN reads as "no value", not "NaN").
ok(formatLegendNumber(Number.NaN) === "—", "NaN → em-dash");
ok(formatLegendNumber(Number.POSITIVE_INFINITY) === "—", "+Infinity → em-dash");
ok(formatLegendNumber(Number.NEGATIVE_INFINITY) === "—", "-Infinity → em-dash");

// Integers pass through unchanged.
ok(formatLegendNumber(0) === "0", "zero");
ok(formatLegendNumber(42) === "42", "integer");
ok(formatLegendNumber(-7) === "-7", "negative integer");

// Rounds to two decimals.
ok(formatLegendNumber(1.234) === "1.23", "round down to 2dp");
ok(formatLegendNumber(1.235) === "1.24", "round up to 2dp");
ok(formatLegendNumber(0.1) === "0.1", "trailing zero not padded");

// A value that rounds to -0 normalizes to "0" (never "-0").
ok(formatLegendNumber(-0.001) === "0", "rounds to -0 → 0");
ok(Object.is(-0, -0) && formatLegendNumber(-0) === "0", "literal -0 → 0");

// Equivalence with the old inline spelling across a grid of finite samples.
for (const v of [-1000, -0.005, 0, 0.005, 0.999, 3.14159, 1234.5678]) {
	const r = Math.round(v * 100) / 100;
	const inline = Object.is(r, -0) ? "0" : String(r);
	ok(formatLegendNumber(v) === inline, `matches inline at ${v}`);
}
