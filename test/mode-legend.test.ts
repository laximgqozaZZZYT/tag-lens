import { ok } from "./assert";
import { buildModeLegend, legendAnchor, type ModeLegendInput } from "../src/draw/mode-legend";

const base: ModeLegendInput = { encodingSpecs: [], tags: [{ key: "greek", color: "#a00" }, { key: "norse", color: "#0a0" }], counts: { min: 1, max: 20 } };

// bound encoding wins over intrinsic.
{
	const enc = [{ title: "Color · Out-degree", kind: "categorical" as const, entries: [{ label: "1", color: "#111" }] }];
	const specs = buildModeLegend("bipartite", { ...base, encodingSpecs: enc });
	ok(specs === enc, "bound encoding returned verbatim");
}
// heatmap -> two gradients incl. co-occurrence; jaccard renames it; many stops.
{
	const specs = buildModeLegend("heatmap", {
		...base,
		heatmap: { jaccard: true, tagMin: 2, tagMax: 11, coMax: 9 },
	});
	ok(specs.length === 2 && specs.every((s) => s.kind === "gradient"), "two gradient ramps");
	ok(specs[1].title.includes("Jaccard"), "jaccard title");
	ok(specs[0].ramp!.stops.length >= 11, "smooth ramp (>=11 stops)");
	ok(specs[0].ramp!.stops[0] === "hsl(42, 85%, 28%)", "heatmap diagonal min color matches draw formula");
	ok(specs[0].ramp!.stops.at(-1) === "hsl(42, 85%, 62%)", "heatmap diagonal max color matches draw formula");
	ok(specs[1].ramp!.stops[0] === "hsl(210, 72%, 16%)", "heatmap co-occurrence min color matches draw formula");
	ok(specs[1].ramp!.stops.at(-1) === "hsl(210, 72%, 72%)", "heatmap co-occurrence max color matches draw formula");
	ok(specs[0].ramp!.minLabel === "2" && specs[0].ramp!.maxLabel === "11", "heatmap tag labels use real min/max");
	ok(specs[1].ramp!.minLabel === "0" && specs[1].ramp!.maxLabel === "1", "jaccard scale labels 0..1");
}

// heatmap raw-count legend labels use provided clamp upper bound (p95/max).
{
	const specs = buildModeLegend("heatmap", {
		...base,
		heatmap: { jaccard: false, tagMin: 3, tagMax: 20, coMax: 17 },
	});
	ok(specs[1].title === "Co-occurrence", "raw mode title");
	ok(specs[1].ramp!.minLabel === "0" && specs[1].ramp!.maxLabel === "17", "raw co-occurrence labels use coMax");
}
// stream -> tag key + size key.
{
	const specs = buildModeLegend("stream", base);
	ok(specs[0].kind === "categorical" && specs[1].kind === "size", "tag + size");
}

// lattice uses intrinsic LOD legend (not encoding override).
{
	const enc = [{ title: "Color · Out-degree", kind: "categorical" as const, entries: [{ label: "1", color: "#111" }] }];
	const specs = buildModeLegend("lattice", {
		...base,
		encodingSpecs: enc,
		lattice: {
			lod: "overview",
			individualMax: 60,
			densityMax: 2000,
			densityCells: 100,
		},
	});
	ok(specs !== enc, "lattice ignores encoding override");
	ok(specs[0].title === "Bar ∝ notes" && specs[0].kind === "size", "overview legend is bar-size key");
}

// lattice density legend explains cell mapping.
{
	const specs = buildModeLegend("lattice", {
		...base,
		counts: { min: 2, max: 220 },
		lattice: {
			lod: "density",
			individualMax: 60,
			densityMax: 2000,
			densityCells: 100,
		},
	});
	ok(specs[0].title === "Waffle density", "density title");
	ok(specs[0].entries![0].label.includes("1 cell ≈"), "density explains per-cell notes");
	ok(specs[0].entries![1].label === "Max 100 cells / node", "density cap label");
}

// lattice individual legend explains 1-cell semantics and overflow.
{
	const specs = buildModeLegend("lattice", {
		...base,
		counts: { min: 1, max: 520 },
		lattice: {
			lod: "individual",
			individualMax: 60,
			densityMax: 2000,
			densityCells: 100,
		},
	});
	ok(specs[0].title === "Cells", "individual title");
	ok(specs[0].entries![0].label === "1 cell = 1 note", "individual cell meaning");
	ok(specs[0].entries![2].label === "Overflow shown as +N", "individual overflow semantics");
}

// lattice shows per-class color lists when classColors is provided.
{
	const specs = buildModeLegend("lattice", {
		...base,
		lattice: {
			lod: "auto",
			individualMax: 60,
			densityMax: 2000,
			densityCells: 100,
			lodMix: { individual: 4, density: 12, overview: 8 },
			classColors: {
				overview: [{ label: "#root", color: "#111111" }],
				density: [{ label: "#heat", color: "#222222" }],
				individual: [{ label: "#act", color: "#333333" }],
			},
		},
	});
	ok(specs.length === 3, "one categorical legend per class");
	ok(specs[0].title === "Overview (bar) · 8 nodes", "overview title + count");
	ok(specs[1].title === "Density (waffle) · 12 nodes", "density title + count");
	ok(specs[2].title === "Individual (cells) · 4 nodes", "individual title + count");
	ok(specs[0].entries![0].color === "#111111", "overview color is preserved");
}

// lattice falls back to effectiveLod view when classColors is absent.
{
	const specs = buildModeLegend("lattice", {
		...base,
		counts: { min: 1, max: 220 },
		lattice: {
			lod: "auto",
			effectiveLod: "mixed",
			individualMax: 60,
			densityMax: 2000,
			densityCells: 100,
			lodMix: { individual: 4, density: 12, overview: 8 },
		},
	});
	ok(specs[0].title === "LOD (current zoom)", "fallback mixed title");
	ok(specs[0].entries!.some((e) => e.label === "Overview (bar): 8"), "fallback mixed counts");
}
// card mode with no encoding -> one categorical tag key with the tag colours.
{
	const specs = buildModeLegend("euler", base);
	ok(specs.length === 1 && specs[0].kind === "categorical" && specs[0].title === "Color · Tag", "euler tag key");
	ok(specs[0].entries![0].color === "#a00", "tag colour carried");
}
// tag overflow "+N more".
{
	const many = { ...base, tags: Array.from({ length: 12 }, (_, i) => ({ key: "t" + i, color: "#000" })), maxItems: 8 };
	const specs = buildModeLegend("matrix", many);
	ok(specs[0].entries!.length === 9 && specs[0].entries![8].label === "+4 more", "overflow row");
}
// anchors clear fixed bands.
{
	ok(legendAnchor("matrix") === "bottom-right", "matrix avoids left label band");
	ok(legendAnchor("upset") === "bottom-right", "upset avoids footer corner");
	ok(legendAnchor("euler") === "bottom-left", "euler default");
}
