// Headless render SMOKE test for the bubblesets DRAW pipeline.
//
// The real-Obsidian E2E is unrunnable in CI / the agent sandbox (long-lived GUI
// processes are SIGKILLed; and even with the sandbox disabled the system's
// inotify watcher limit is exhausted with no headroom and raising it needs root
// — confirmed by direct repro). So this drives the ACTUAL draw functions —
// drawBubbleSetsEnclosures, drawCard, drawClusterLabels — over layout()'s output
// with a RECORDING canvas mock, exercising the layer the layout invariants don't
// cover: that the figure renders WITHOUT THROWING and emits the expected draw
// ops (box outlines, card fills, label text). Runs in `node test/run.mjs`, no
// GUI / inotify / sudo needed, sub-second.
import { ok } from "./assert";
import { layout, type SizedNode, type LayoutOptions } from "../src/layout/layout";
import type { GraphData, GraphNode } from "../src/types";
import { drawBubbleSetsEnclosures } from "../src/draw/draw-bubblesets";
import { drawClusterLabels } from "../src/draw/draw-helpers";
import { drawCard } from "../src/draw/draw-card";
import { setTheme, defaultTheme } from "../src/draw/theme";
import { recordingCtx } from "./recording-ctx";

setTheme(defaultTheme()); // headless: theme() must not need getComputedStyle

function opts(): LayoutOptions {
	return {
		clusterSpacing: 80, nodeSpacing: 1, cellW: 270, cellH: 72, minFontPx: 10,
		clusterLabels: new Map<string, string>(), anchorPlacement: "concentric", viewMode: "bubblesets",
	} as LayoutOptions;
}

// Drive the bubblesets draw pipeline exactly as view.ts does (enclosures, then a
// card per node, then the cluster labels) and assert it renders cleanly.
function renderSmoke(label: string, nodes: GraphNode[], clusterLabels: Map<string, string>): void {
	const data: GraphData = { nodes, edges: [] };
	const sized: SizedNode[] = nodes.map((n) => ({ ...n, width: 270, height: 72 }));
	const o = opts();
	o.clusterLabels = clusterLabels;
	const out = layout(data, sized, o);
	const { ctx, rec } = recordingCtx();
	let threw: string | null = null;
	try {
		drawBubbleSetsEnclosures(ctx, out.clusters, new Set<string>(), undefined, 1, null);
		for (const n of out.nodes) {
			drawCard(ctx, n, { scale: 1, bodyLines: [], showBody: false, highlighted: false, zoom: 1, minFontPx: 10 });
		}
		drawClusterLabels(ctx, out, 1, 10, undefined, false);
	} catch (e) {
		threw = e instanceof Error ? (e.stack ?? e.message) : String(e);
	}
	ok(threw === null, `[${label}] bubblesets draw pipeline threw: ${threw}`);
	ok(out.nodes.length > 0, `[${label}] layout produced no nodes`);
	ok(out.clusters.length > 0, `[${label}] layout produced no clusters`);
	ok(rec.strokeRect > 0, `[${label}] no box outlines drawn (strokeRect=0)`);
	ok(rec.fillText > 0, `[${label}] no text drawn (fillText=0) for ${out.nodes.length} cards + ${out.clusters.length} labels`);
	ok(rec.fill + rec.fillRect > 0, `[${label}] no fills drawn (fill=${rec.fill} fillRect=${rec.fillRect})`);
}

// Dataset A: universal + laminar (the user's filtered-view shape).
{
	const nodes: GraphNode[] = [];
	let i = 0;
	const mk = (extra: string[]) => nodes.push({ id: `a${i++}`, label: `note_${i}`, memberships: ["_all", "timeline", "act", ...extra] });
	for (let k = 0; k < 44; k++) mk([]);
	for (let k = 0; k < 6; k++) mk(["drama"]);
	for (let k = 0; k < 2; k++) mk(["drama", "wisdom"]);
	renderSmoke("universal+laminar", nodes, new Map([["_all", "_all"], ["timeline", "timeline"], ["act", "act"], ["drama", "drama"], ["wisdom", "wisdom"]]));
}

// Dataset B: genuine 3-way Venn (A,B,C cross-cutting, all 7 regions).
{
	const nodes: GraphNode[] = [];
	let i = 0;
	const add = (tags: string[]) => { for (let k = 0; k < 4; k++) nodes.push({ id: `b${i++}`, label: `n_${i}`, memberships: tags.slice() }); };
	add(["A"]); add(["B"]); add(["C"]); add(["A", "B"]); add(["A", "C"]); add(["B", "C"]); add(["A", "B", "C"]);
	renderSmoke("3-way-venn", nodes, new Map([["A", "A"], ["B", "B"], ["C", "C"]]));
}
