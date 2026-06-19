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

// tag entry with explicit label renders that label (LAYERS & OVERRIDES suffix).
{
	const withLabel: ModeLegendInput = {
		encodingSpecs: [],
		tags: [{ key: "greek", color: "#a00", label: "greek — Size 2×3 · 5 nodes · Aggregate (3-card stack)" }],
		counts: { min: 1, max: 20 },
	};
	const specs = buildModeLegend("matrix", withLabel);
	ok(specs[0].entries![0].label === "greek — Size 2×3 · 5 nodes · Aggregate (3-card stack)", "tag label renders verbatim");
	ok(specs[0].entries![0].color === "#a00", "tag colour still carried with label");
}
// suffix format mirrors the Settings ▸ "Layers & Overrides" panel vocabulary:
// ` — Size R×C · N nodes [· Aggregate (3-card stack)] [· Inherit from X]`.
// view.ts builds these labels; mode-legend renders them verbatim (above).
{
	const R = 2, C = 3, n = 5;
	const base = ` — Size ${R}×${C} · ${n} nodes`;
	ok(base === " — Size 2×3 · 5 nodes", "suffix uses panel terms: Size R×C · N nodes");
	ok(`greek${base} · Aggregate (3-card stack)` === "greek — Size 2×3 · 5 nodes · Aggregate (3-card stack)", "aggregate part matches panel label");
	ok(`greek${base} · Inherit from latin` === "greek — Size 2×3 · 5 nodes · Inherit from latin", "inherit part matches panel 'Inherit from'");
	ok(` — Size ${R}×${C} · 1 node` === " — Size 2×3 · 1 node", "singular 'node' for count 1");
}
// droste keeps intrinsic tag legend (encoding specs do not override).
{
	const enc = [{ title: "Color · Out-degree", kind: "categorical" as const, entries: [{ label: "1", color: "#111" }] }];
	const specs = buildModeLegend("droste", {
		...base,
		encodingSpecs: enc,
		droste: {
			focusColor: "#3366ff",
			intersectionColor: "#ccaa22",
			unionColor: "#33bb88",
		},
	});
	ok(specs !== enc, "droste ignores encoding override");
	ok(specs.length === 2, "droste includes tag + set-ops legends");
	ok(specs[0].kind === "categorical" && specs[0].title === "Color · Tag", "droste tag key");
	ok(specs[1].title === "Gallery key", "droste set-ops title");
	ok(specs[1].entries?.some((e) => e.label.includes("Intersection") && e.color === "#ccaa22"), "intersection color legend");
	ok(specs[1].entries?.some((e) => e.label.includes("Union") && e.color === "#33bb88"), "union color legend");
}
// CLOSEUP enclosure mode: ∪/∩ are listed ALONGSIDE the single-tag "Groups & overlap"
// spec, acting as a single unified cluster legend. The independent section
// is suppressed to keep them visually together.
{
	const specs = buildModeLegend("bubblesets", {
		...base,
		closeup: true,
		groups: [{ key: "greek", label: "Group: greek — Size 1×1 · 5 nodes", color: "#abc" }],
		setLayers: [
			{ key: "__union__", label: "∪ Union — Size 1×1 · 12 nodes", color: "#0a0" },
			{ key: "__intersection__", label: "∩ Intersection — Size 2×2 · 3 nodes · Aggregate (3-card stack)", color: "#cc0" },
		],
	});
	// ∪/∩ NO LONGER live in their OWN section.
	const sl = specs.find((s) => s.title.includes("Union / Intersection layers"));
	ok(!sl, "closeup enclosure: independent set-layers section is suppressed");

	// Single-tag cluster frames and ∪/∩ stay in "Groups & overlap".
	const grp = specs.find((s) => s.title.includes("Groups & overlap"));
	ok(!!grp, "single-tag groups spec still present in closeup");
	ok(grp!.entries!.some((e) => e.label.includes("greek")), "single-set group frame kept");
	
	// Check that ∪/∩ are folded inside the groups spec.
	ok(grp!.entries!.some((e) => e.label === "∪ Union — Size 1×1 · 12 nodes" && e.color === "#0a0"), "folded union row in groups spec");
	ok(grp!.entries!.some((e) => e.label === "∩ Intersection — Size 2×2 · 3 nodes · Aggregate (3-card stack)" && e.color === "#cc0"), "folded intersection row in groups spec");
	ok(!grp!.entries!.some((e) => e.label.includes("Overlap:")), "descriptive overlap row replaced by explicit set layers");

	// Exactly one occurrence of each ∪/∩ row across ALL specs (display-unit unique).
	const allLabels = specs.flatMap((s) => s.entries?.map((e) => e.label) ?? []);
	ok(allLabels.filter((l) => l.includes("∪ Union")).length === 1, "∪ row appears exactly once");
	ok(allLabels.filter((l) => l.includes("∩ Intersection")).length === 1, "∩ row appears exactly once");
}
// PANORAMA enclosure (no closeup, no setLayers): keeps the plain folded layout
// with the descriptive overlap row; no separate set-layers section.
{
	const specs = buildModeLegend("bubblesets", {
		...base,
		groups: [{ key: "greek", label: "greek (5)", color: "#abc" }],
	});
	ok(!specs.some((s) => s.title.includes("Union / Intersection layers")), "panorama enclosure: no separate set-layers section");
	const enc = specs.find((s) => s.title.includes("Groups & overlap"));
	ok(!!enc, "enclosure spec present (panorama)");
	ok(enc!.entries!.some((e) => e.label === "Overlap: note shared by 2+ groups"), "descriptive overlap row kept in panorama");
	ok(!enc!.entries!.some((e) => e.label.includes("Union") && e.label.includes("·")), "no addressable union row in panorama");
}
// INTRINSIC PRESERVATION (closeup enclosure): rendering an enclosure mode with setLayers
// only ADDS the ∪/∩ items to the "Groups & overlap" spec; the number of
// specs stays the same, and the colour key stays verbatim.
{
	const groups = [{ key: "greek", label: "Group: greek — Size 1×1 · 5 nodes", color: "#abc" }];
	const closeup = buildModeLegend("bubblesets", {
		...base,
		closeup: true,
		groups,
		setLayers: [{ key: "__union__", label: "∪ Union — Size 1×1 · 12 nodes", color: "#0a0" }],
	});
	// A closeup run with NO ∪/∩ at all: pure intrinsic specs (groups + colour key).
	const intrinsic = buildModeLegend("bubblesets", { ...base, closeup: true, groups });
	// The number of specs is identical (∪/∩ are folded, not appended as a new spec).
	ok(closeup.length === intrinsic.length, "closeup enclosure: no new specs added for set-layers");
	
	const closeupGrp = closeup.find((s) => s.title.includes("Groups & overlap"))!;
	const intrinsicGrp = intrinsic.find((s) => s.title.includes("Groups & overlap"))!;
	ok(closeupGrp.entries!.length === intrinsicGrp.entries!.length, "closeup enclosure: set-layers replaces the default overlap row");
	ok(closeupGrp.entries!.some((e) => e.label.includes("∪ Union")), "closeup enclosure: union row in groups spec");
	
	ok(
		JSON.stringify(closeup.filter((s) => !s.title.includes("Groups & overlap"))) === JSON.stringify(intrinsic.filter((s) => !s.title.includes("Groups & overlap"))),
		"closeup enclosure: other intrinsic specs (colour key) preserved verbatim",
	);
}
// ALL VIEW MODES: setLayers render as their own ∪/∩ legend spec even when the
// mode is NOT an enclosure mode (matrix/stream/upset/droste/lattice/bipartite).
// "表示する要素の方針は変えず": the mode's intrinsic specs stay intact and the
// set-layers are an ADDED, unified spec — never folded into another legend.
{
	const setLayers = [
		{ key: "__union__", label: "∪ Union — Size 1×1 · 12 nodes", color: "#0a0" },
		{ key: "__intersection__", label: "∩ Intersection — Size 2×2 · 3 nodes · Aggregate (3-card stack)", color: "#cc0" },
	];
	for (const mode of ["matrix", "stream", "upset", "droste", "bipartite"] as const) {
		const input: ModeLegendInput = {
			...base,
			setLayers,
			droste: { focusColor: "#1", intersectionColor: "#2", unionColor: "#3" },
			lattice: { lod: "overview", individualMax: 60, densityMax: 2000, densityCells: 100 },
		};
		const withSet = buildModeLegend(mode, input);
		const withoutSet = buildModeLegend(mode, { ...input, setLayers: undefined });
		const sl = withSet.find((s) => s.title.includes("Union / Intersection layers"));
		ok(!!sl, `${mode}: set-layers spec appended`);
		ok(sl!.entries!.some((e) => e.label === "∪ Union — Size 1×1 · 12 nodes" && e.color === "#0a0"), `${mode}: union row`);
		ok(sl!.entries!.some((e) => e.label === "∩ Intersection — Size 2×2 · 3 nodes · Aggregate (3-card stack)" && e.color === "#cc0"), `${mode}: intersection row`);
		// Intrinsic specs are unchanged: removing setLayers leaves exactly the
		// same intrinsic specs (the set-layers spec is purely additive).
		ok(withSet.length === withoutSet.length + 1, `${mode}: set-layers is the only added spec`);
		ok(
			JSON.stringify(withSet.slice(0, withoutSet.length)) === JSON.stringify(withoutSet),
			`${mode}: intrinsic specs preserved verbatim`,
		);
	}
}
// PANORAMA enclosure modes keep folding setLayers into the Group
// enclosures spec (NOT a separate spec) — the prior panorama behaviour is
// unchanged. Closeup behaves identically now.
{
	const specs = buildModeLegend("bubblesets", {
		...base,
		groups: [{ key: "greek", label: "greek (5)", color: "#abc" }],
		setLayers: [{ key: "__union__", label: "∪ Union — Size 1×1 · 12 nodes", color: "#0a0" }],
	});
	ok(!specs.some((s) => s.title.includes("Union / Intersection layers")), "panorama enclosure mode does not add a separate Set layers spec");
	const enc = specs.find((s) => s.title.includes("Groups & overlap"));
	ok(enc!.entries!.some((e) => e.label === "∪ Union — Size 1×1 · 12 nodes"), "panorama enclosure mode folds set-layers into enclosures");
}
// CLOSEUP applies to the whole enclosure family (euler / euler-true / euler-venn
// / bubblesets): each gets the ∪/∩ folded into the groups spec.
{
	for (const mode of ["euler", "euler-true", "euler-venn", "bubblesets"] as const) {
		const specs = buildModeLegend(mode, {
			...base,
			closeup: true,
			groups: [{ key: "greek", label: "Group: greek", color: "#abc" }],
			setLayers: [
				{ key: "__union__", label: "∪ Union — Size 1×1 · 12 nodes", color: "#0a0" },
				{ key: "__intersection__", label: "∩ Intersection — Size 2×2 · 3 nodes", color: "#cc0" },
			],
		});
		const sl = specs.find((s) => s.title.includes("Union / Intersection layers"));
		ok(!sl, `${mode}: closeup independent set-layers section suppressed`);
		const grp = specs.find((s) => s.title.includes("Groups & overlap"));
		ok(grp!.entries!.some((e) => e.label.includes("Union")), `${mode}: ∪ folded in groups spec`);
		ok(grp!.entries!.some((e) => e.label.includes("Intersection")), `${mode}: ∩ folded in groups spec`);
		ok(!grp!.entries!.some((e) => e.label.includes("Overlap:")), `${mode}: no overlap descriptive row`);
	}
}
// No setLayers anywhere -> no Set layers spec leaks into any mode.
{
	for (const mode of ["matrix", "stream", "upset", "bipartite"] as const) {
		const specs = buildModeLegend(mode, base);
		ok(!specs.some((s) => s.title.includes("Union / Intersection layers")), `${mode}: no set-layers spec without input`);
	}
}
// tag overflow is no longer truncated.
{
	const many = { ...base, tags: Array.from({ length: 12 }, (_, i) => ({ key: "t" + i, color: "#000" })), maxItems: 8 };
	const specs = buildModeLegend("matrix", many);
	ok(specs[0].entries!.length === 12, "all items shown, maxItems ignored");
}
// anchors clear fixed bands.
{
	ok(legendAnchor("matrix") === "bottom-right", "matrix avoids left label band");
	ok(legendAnchor("upset") === "bottom-right", "upset avoids footer corner");
	ok(legendAnchor("euler") === "bottom-left", "euler default");
}
