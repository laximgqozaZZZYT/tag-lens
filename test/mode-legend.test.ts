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
	const specs = buildModeLegend("heatmap", { ...base, heatmap: { jaccard: true } });
	ok(specs.length === 2 && specs.every((s) => s.kind === "gradient"), "two gradient ramps");
	ok(specs[1].title.includes("Jaccard"), "jaccard title");
	ok(specs[0].ramp!.stops.length >= 11, "smooth ramp (>=11 stops)");
}
// stream -> tag key + size key.
{
	const specs = buildModeLegend("stream", base);
	ok(specs[0].kind === "categorical" && specs[1].kind === "size", "tag + size");
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
