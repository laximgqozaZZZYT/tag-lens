// F4-3 — on-canvas legend layout. Verifies sizing, item placement, shape vs
// colour swatches, quantitative gradient rows, and the "+N more" cap.
import { ok } from "./assert";
import { buildLegendBox } from "../src/draw/legend-layout";
import { shapeForKey } from "../src/encoding/shapes";
import type { BindingLegend } from "../src/encoding/evaluate";

// Fixed-width measurer: 6 px per char (deterministic, no DOM).
const measure = (t: string) => t.length * 6;
const opts = { measure, fontPx: 11, swatch: 10 };

// Empty input → zero-ish box, no sections.
{
	const box = buildLegendBox([], opts);
	ok(box.sections.length === 0, "no sections for empty legends");
	ok(box.height >= 0 && box.width >= 0, "non-negative dims");
}

// Categorical colour channel: one item per entry, each carries its colour.
{
	const legends: BindingLegend[] = [{
		channelId: "color", fieldId: "tag", fieldLabel: "Tag",
		legend: { kind: "categorical", entries: [{ key: "a", output: "#f00" }, { key: "b", output: "#0f0" }] },
	}];
	const box = buildLegendBox(legends, opts);
	ok(box.sections.length === 1, "one section");
	const s = box.sections[0];
	ok(s.title.includes("Color") && s.title.includes("Tag"), "title shows channel + field");
	ok(s.items.length === 2, "two items");
	ok(s.items[0].color === "#f00" && s.items[0].shape === undefined, "colour item, no shape");
	ok(s.items[1].y > s.items[0].y, "items stack downward");
	ok(box.width > 0 && box.height > 0, "box has size");
}

// Shape channel: items carry a shape glyph (no colour), matching shapeForKey.
{
	const legends: BindingLegend[] = [{
		channelId: "shape", fieldId: "maturity", fieldLabel: "Maturity",
		legend: { kind: "categorical", entries: [{ key: "permanent", output: "#abc" }] },
	}];
	const box = buildLegendBox(legends, opts);
	const it = box.sections[0].items[0];
	ok(it.shape === shapeForKey("permanent"), "shape item uses shapeForKey");
	ok(it.color === undefined, "shape item carries no colour swatch");
}

// Quantitative channel: single gradient row with min … max.
{
	const legends: BindingLegend[] = [{
		channelId: "size", fieldId: "degree", fieldLabel: "Degree",
		legend: { kind: "quantitative", min: 0, max: 12, reversed: false },
	}];
	const box = buildLegendBox(legends, opts);
	const s = box.sections[0];
	ok(s.kind === "quantitative" && s.gradient === true, "gradient section");
	ok(s.min === 0 && s.max === 12, "min/max captured");
	ok(s.items.length === 1 && s.items[0].label.includes("12"), "one row showing the range");
}

// Cap: more than maxItemsPerSection entries → truncated + "+N more".
{
	const entries = Array.from({ length: 12 }, (_, i) => ({ key: "k" + i, output: "#000" }));
	const legends: BindingLegend[] = [{
		channelId: "color", fieldId: "tag", fieldLabel: "Tag",
		legend: { kind: "categorical", entries },
	}];
	const box = buildLegendBox(legends, { ...opts, maxItemsPerSection: 5 });
	const s = box.sections[0];
	ok(s.items.length === 6, "5 shown + 1 overflow row");
	ok(s.items[5].label === "+7 more", "overflow row labelled (got " + s.items[5].label + ")");
}

// Two sections stack: the second starts below the first.
{
	const legends: BindingLegend[] = [
		{ channelId: "color", fieldId: "tag", fieldLabel: "Tag", legend: { kind: "categorical", entries: [{ key: "a", output: "#f00" }] } },
		{ channelId: "shape", fieldId: "maturity", fieldLabel: "Maturity", legend: { kind: "categorical", entries: [{ key: "x", output: "#0f0" }] } },
	];
	const box = buildLegendBox(legends, opts);
	ok(box.sections.length === 2, "two sections");
	ok(box.sections[1].titleY > box.sections[0].items[0].y, "second section below the first");
}
