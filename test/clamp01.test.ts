// clamp01(n) — the [0, 1] unit-interval clamp shared by the quantitative scale
// normalizer (encoding/scales.ts) and the sequential colour ramps
// (draw/legend-layout.ts, draw/legend-spec.ts, draw/mode-legend.ts).
import { ok } from "./assert";
import { clamp01 } from "../src/util/clamp01";

// In-range passthrough (including both endpoints).
ok(clamp01(0) === 0, "zero passes through");
ok(clamp01(0.5) === 0.5, "mid passes through");
ok(clamp01(1) === 1, "one passes through");

// Below 0 floors at 0; above 1 ceils at 1.
ok(clamp01(-0.3) === 0, "negative → 0");
ok(clamp01(1.7) === 1, "over one → 1");
ok(clamp01(1000) === 1, "large → 1");

// Equivalence with the old inline spelling across a grid of samples.
for (const v of [-10, -0.1, 0, 0.25, 0.5, 0.999, 1, 1.0001, 42]) {
	const inline = Math.max(0, Math.min(1, v));
	ok(clamp01(v) === inline, `matches inline at ${v}`);
}
