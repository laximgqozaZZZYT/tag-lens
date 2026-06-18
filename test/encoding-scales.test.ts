// Visual Encoding scales: quantitative (linear/log/quantile + clamp/reverse) and
// categorical (palette override + stable auto colour) + missing handling.
import { ok, approx } from "./assert";
import { prepareScale } from "../src/encoding/scales";

// linear: maps [min,max] -> [0,1]
{
	const s = prepareScale({ type: "linear" }, [0, 10, 20]);
	approx(s.apply(0).t, 0, 1e-9, "linear min -> 0");
	approx(s.apply(10).t, 0.5, 1e-9, "linear mid -> 0.5");
	approx(s.apply(20).t, 1, 1e-9, "linear max -> 1");
	ok(s.legend.kind === "quantitative" && s.legend.min === 0 && s.legend.max === 20, "linear legend domain");
}
// reverse flips t
{
	const s = prepareScale({ type: "linear", reverse: true }, [0, 20]);
	approx(s.apply(0).t, 1, 1e-9, "reverse min -> 1");
	approx(s.apply(20).t, 0, 1e-9, "reverse max -> 0");
	ok(s.legend.reversed === true, "legend marks reversed");
}
// clampPctl caps the domain max; values above clamp -> 1
{
	const vals = Array.from({ length: 11 }, (_, i) => i * 10); // 0..100
	const s = prepareScale({ type: "linear", clampPctl: 0.9 }, vals);
	ok(s.legend.max <= 100 && s.legend.max >= 80, "clampPctl lowers max into the p90 region");
	approx(s.apply(100).t, 1, 1e-9, "value above clamp saturates to 1");
}
// log: monotonic, endpoints 0 and 1
{
	const s = prepareScale({ type: "log" }, [1, 10, 100]);
	approx(s.apply(1).t, 0, 1e-9, "log min -> 0");
	approx(s.apply(100).t, 1, 1e-9, "log max -> 1");
	ok(s.apply(10).t > 0 && s.apply(10).t < 1, "log mid strictly between");
}
// quantile: fraction of values <= raw
{
	const s = prepareScale({ type: "quantile" }, [1, 2, 3, 4]);
	approx(s.apply(1).t, 0.25, 1e-9, "quantile of 1 = 1/4");
	approx(s.apply(3).t, 0.75, 1e-9, "quantile of 3 = 3/4");
	approx(s.apply(4).t, 1, 1e-9, "quantile of 4 = 4/4");
}
// quantitative missing: null or non-number -> missing
{
	const s = prepareScale({ type: "linear" }, [0, 10]);
	ok(s.apply(null).missing === true, "null -> missing");
	ok(s.apply("x").missing === true, "non-number -> missing");
}
// categorical: distinct entries, output is a colour, stable per key
{
	const s = prepareScale({ type: "categorical" }, ["a", "b", "a", null]);
	ok(s.legend.kind === "categorical" && s.legend.entries.length === 2, "two distinct categories (null dropped)");
	ok(s.apply("a").category === "a" && typeof s.apply("a").output === "string", "categorical resolves key+output");
	ok(s.apply("a").output === s.apply("a").output, "auto colour stable per key");
	ok(s.apply(null).missing === true, "categorical null -> missing");
}
// HARD INVARIANT: a displayed node's colour MUST equal its legend swatch. Both
// resolve through the same per-key map, so apply(key).output === entry.output
// for every category — otherwise legend and canvas disagree (the reported bug).
{
	const s = prepareScale({ type: "categorical" }, ["1", "2", "3", "2", "4", "5", "6", "7"]);
	for (const e of s.legend.entries) {
		ok(s.apply(e.key).output === e.output, `node colour for ${e.key} matches its legend swatch`);
	}
}
// DISTINGUISHABILITY: numeric keys "0".."6" used to collapse to near-identical
// greens (hue 109-139). They must now be visibly distinct colours.
{
	const keys = ["0", "1", "2", "3", "4", "5", "6"];
	const s = prepareScale({ type: "categorical" }, keys);
	const outs = keys.map((k) => s.apply(k).output);
	ok(new Set(outs).size === keys.length, "every numeric category gets a unique colour");
	const hue = (c: string) => Number(/hsl\((\d+)/.exec(c)?.[1] ?? "0");
	const hues = outs.map(hue);
	ok(Math.max(...hues) - Math.min(...hues) > 120, `hues are spread across the wheel (got ${hues.join(",")})`);
}
// determinism: same input -> same colours.
{
	const a = prepareScale({ type: "categorical" }, ["x", "y", "z"]).legend.entries.map((e) => e.output);
	const b = prepareScale({ type: "categorical" }, ["x", "y", "z"]).legend.entries.map((e) => e.output);
	ok(a.join("|") === b.join("|"), "categorical palette is deterministic");
}
// categorical palette override wins over auto (and still corresponds in legend)
{
	const s = prepareScale({ type: "categorical", palette: { done: "#ffffff" } }, ["done", "wip"]);
	ok(s.apply("done").output === "#ffffff", "palette override applied");
	ok(s.apply("wip").output !== "#ffffff", "unmapped value falls back to auto");
	const doneEntry = s.legend.entries.find((e) => e.key === "done");
	ok(doneEntry?.output === "#ffffff", "legend swatch honours the palette override too");
}
