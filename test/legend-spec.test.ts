import { ok } from "./assert";
import { sequentialColorRamp, encodingToSpecs } from "../src/draw/legend-spec";
import type { BindingLegend } from "../src/encoding/evaluate";

// ramp: low is darker than high (monotone), matches channel direction.
{
	const lo = Number(/(\d+)%\)$/.exec(sequentialColorRamp(0))![1]);
	const hi = Number(/(\d+)%\)$/.exec(sequentialColorRamp(1))![1]);
	ok(lo < hi, `ramp goes dark(low)->light(high) (got ${lo} -> ${hi})`);
	ok(sequentialColorRamp(-5) === sequentialColorRamp(0) && sequentialColorRamp(9) === sequentialColorRamp(1), "ramp clamps");
}
// categorical encoding -> categorical spec with swatches + overflow.
{
	const entries = Array.from({ length: 10 }, (_, i) => ({ key: String(i), output: `c${i}` }));
	const lg: BindingLegend = { channelId: "color", fieldId: "tag", fieldLabel: "Tag", legend: { kind: "categorical", entries } };
	const specs = encodingToSpecs([lg], 8);
	ok(specs.length === 1 && specs[0].kind === "categorical", "one categorical spec");
	ok(specs[0].entries!.length === 9, "8 shown + 1 overflow row");
	ok(specs[0].entries![8].label === "+2 more", "overflow label");
	ok(specs[0].entries![0].color === "c0", "swatch colour carried");
}
// quantitative encoding -> gradient spec with 5 stops + min/max labels.
{
	const lg: BindingLegend = { channelId: "color", fieldId: "age", fieldLabel: "Age", legend: { kind: "quantitative", min: 1, max: 9 } };
	const specs = encodingToSpecs([lg]);
	ok(specs[0].kind === "gradient" && specs[0].ramp!.stops.length === 5, "gradient with 5 stops");
	ok(specs[0].ramp!.minLabel === "1" && specs[0].ramp!.maxLabel === "9", "min/max labels");
}
// shape encoding -> categorical spec carrying shape glyphs.
{
	const lg: BindingLegend = { channelId: "shape", fieldId: "maturity", fieldLabel: "Maturity", legend: { kind: "categorical", entries: [{ key: "a", output: "x" }] } };
	const specs = encodingToSpecs([lg]);
	ok(specs[0].entries![0].shape != null && specs[0].entries![0].color == null, "shape spec carries a glyph, not a colour");
}
