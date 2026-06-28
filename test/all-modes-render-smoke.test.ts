// Headless render SMOKE tests for EVERY non-bubblesets view mode's DRAW
// pipeline: euler (non-bubblesets enclosures), heatmap, upset, lattice, droste.
//
// Companion to bubblesets-render-smoke.test.ts. The real-Obsidian E2E is
// unrunnable in CI / the agent sandbox (long-lived GUI processes are SIGKILLed;
// inotify watcher limits are exhausted), so this drives the ACTUAL mode draw
// functions — drawEulerEnclosures / drawHeatmap / drawUpsetFooter / drawLattice
// / drawDroste — over layout()'s output with a RECORDING canvas mock, exactly
// as src/view.ts's draw() dispatches them. It exercises the layer the layout
// invariants don't cover: that each mode RENDERS WITHOUT THROWING and emits at
// least one real draw op. Runs in `node test/run.mjs`, sub-second, no GUI.
import { ok } from "./assert";
import { layout, type SizedNode, type LayoutOptions, type LaidOut } from "../src/layout/layout";
import type { GraphData, GraphNode, ViewMode } from "../src/types";
import { setTheme, defaultTheme } from "../src/draw/theme";
import { recordingCtx, drewSomething, mockCanvas } from "./recording-ctx";

import { drawEulerEnclosures } from "../src/draw/draw-enclosures";
import { drawClusterLabels } from "../src/draw/draw-helpers";
import { drawCard } from "../src/draw/draw-card";
import { drawHeatmap } from "../src/draw/draw-heatmap";
import { drawUpsetFooter } from "../src/draw/draw-upset";
import { drawLattice } from "../src/draw/draw-lattice";
import { drawDroste } from "../src/draw/draw-droste";
import type { DrosteGallery } from "../src/layout/droste-layout";

setTheme(defaultTheme()); // headless: theme() must not need getComputedStyle

const DPR = 1;
const ZOOM = 1;
const PAN = 0;
const CANVAS_W = 1200;
const CANVAS_H = 800;

function baseOpts(viewMode: ViewMode): LayoutOptions {
	return {
		clusterSpacing: 80, nodeSpacing: 16, cellW: 270, cellH: 72, minFontPx: 10,
		clusterLabels: new Map<string, string>(), anchorPlacement: "concentric", viewMode,
		// Mode-specific knobs that make each mode produce a non-empty figure with
		// the test dataset. Unused fields are ignored by the other modes.
		heatmapMinTagSize: 1, heatmapCriterion: "size", heatmapSortDir: "desc",
		upsetColumnSort: "size", upsetMinColumnSize: 1,
		latticeNodeLOD: "auto", latticeIndividualMax: 200, latticeDensityMax: 5000,
		latticeDensityCells: 64, latticeShowSubsetLinks: true, latticeNamedMax: 5,
	} as unknown as LayoutOptions;
}

// A dataset rich in multi-tag co-occurrence so heatmap / upset / lattice all
// produce non-empty output: 7 cross-cutting regions over tags A/B/C plus a
// second triad D/E/F, repeated so each intersection has several members.
function richNodes(): GraphNode[] {
	const nodes: GraphNode[] = [];
	let i = 0;
	const add = (tags: string[], copies: number) => {
		for (let k = 0; k < copies; k++) nodes.push({ id: `n${i++}`, label: `note_${i}`, memberships: tags.slice() });
	};
	add(["A"], 3); add(["B"], 3); add(["C"], 3);
	add(["A", "B"], 2); add(["A", "C"], 2); add(["B", "C"], 2); add(["A", "B", "C"], 2);
	add(["D"], 2); add(["E"], 2); add(["D", "E"], 2); add(["D", "E", "F"], 1);
	add(["A", "D"], 2);
	return nodes;
}

function clusterLabels(): Map<string, string> {
	return new Map([
		["A", "Alpha"], ["B", "Beta"], ["C", "Gamma"],
		["D", "Delta"], ["E", "Epsilon"], ["F", "Zeta"],
	]);
}

function runLayout(viewMode: ViewMode): LaidOut {
	const nodes = richNodes();
	const data: GraphData = { nodes, edges: [] };
	const sized: SizedNode[] = nodes.map((n) => ({ ...n, width: 270, height: 72 }));
	const o = baseOpts(viewMode);
	o.clusterLabels = clusterLabels();
	return layout(data, sized, o);
}

// ── euler (non-bubblesets nested-Euler enclosures) ──
// view.ts draw(): the body-tile path calls drawEulerEnclosures, then a card per
// node, then drawClusterLabels (with clampToBox=true for non-bubblesets).
{
	const out = runLayout("euler");
	const { ctx, rec } = recordingCtx();
	let threw: string | null = null;
	try {
		drawEulerEnclosures(ctx, out.clusters, new Set<string>(), undefined, ZOOM, null);
		for (const n of out.nodes) {
			drawCard(ctx, n, { scale: 1, bodyLines: [], showBody: false, highlighted: false, zoom: ZOOM, minFontPx: 10 });
		}
		drawClusterLabels(ctx, out, ZOOM, 10, undefined, true);
	} catch (e) {
		threw = e instanceof Error ? (e.stack ?? e.message) : String(e);
	}
	ok(threw === null, `[euler] draw pipeline threw: ${threw}`);
	ok(out.nodes.length > 0, `[euler] layout produced no nodes`);
	ok(out.clusters.length > 0, `[euler] layout produced no clusters`);
	ok(drewSomething(rec), `[euler] no draw ops emitted (rec=${JSON.stringify(rec)})`);
}

// ── heatmap (tag×tag co-occurrence grid) ──
// view.ts draw(): drawHeatmap(ctx, laid.heatmap, {zoom,panX,panY,canvas,dpr,...}).
{
	const out = runLayout("heatmap");
	ok(out.heatmap != null, `[heatmap] layout produced no heatmap meta`);
	ok((out.heatmap?.n ?? 0) > 0, `[heatmap] heatmap is empty (n=${out.heatmap?.n})`);
	const { ctx, rec } = recordingCtx();
	const canvas = mockCanvas(CANVAS_W, CANVAS_H, DPR, ctx);
	let threw: string | null = null;
	try {
		drawHeatmap(ctx, out.heatmap!, {
			zoom: ZOOM, panX: PAN, panY: PAN, canvas, dpr: DPR, minFontPx: 10,
			jaccard: false, gapFinder: false, gaps: [],
			selected: null, hoverRow: -1, hoverCol: -1,
		});
	} catch (e) {
		threw = e instanceof Error ? (e.stack ?? e.message) : String(e);
	}
	ok(threw === null, `[heatmap] draw pipeline threw: ${threw}`);
	ok(drewSomething(rec), `[heatmap] no draw ops emitted (rec=${JSON.stringify(rec)})`);
}

// ── upset (matrix footer + cards above) ──
// view.ts draw(): drawUpsetFooter(ctx, laid, computeUpsetDrawInput({...})) →
// DrawUpsetOpts { canvasW, canvasH, dpr, zoom, panX, panY, selectedSignatureKey, minFontPx }.
// UpSet leaves laid.nodes empty by design; the figure lives in laid.upset.columns.
{
	const out = runLayout("upset");
	ok(out.upset != null, `[upset] layout produced no upset meta`);
	ok((out.upset?.columns.length ?? 0) > 0, `[upset] no upset columns`);
	const { ctx, rec } = recordingCtx();
	let threw: string | null = null;
	try {
		drawUpsetFooter(ctx, out, {
			canvasW: CANVAS_W,
			canvasH: CANVAS_H,
			dpr: DPR,
			zoom: ZOOM,
			panX: PAN,
			panY: PAN,
			selectedSignatureKey: null,
			minFontPx: 10,
		});
	} catch (e) {
		threw = e instanceof Error ? (e.stack ?? e.message) : String(e);
	}
	ok(threw === null, `[upset] draw pipeline threw: ${threw}`);
	ok(drewSomething(rec), `[upset] no draw ops emitted (rec=${JSON.stringify(rec)})`);
}

// ── lattice (intersection tier grid + subset links) ──
// view.ts draw(): drawLattice(ctx, laid.lattice, {zoom,panX,panY,canvas,dpr,minFontPx,settings,...}).
{
	const out = runLayout("lattice");
	ok(out.lattice != null, `[lattice] layout produced no lattice meta`);
	ok((out.lattice?.nodes.length ?? 0) > 0, `[lattice] no lattice nodes`);
	const { ctx, rec } = recordingCtx();
	const canvas = mockCanvas(CANVAS_W, CANVAS_H, DPR, ctx);
	let threw: string | null = null;
	try {
		drawLattice(ctx, out.lattice!, {
			zoom: ZOOM, panX: PAN, panY: PAN, canvas, dpr: DPR, minFontPx: 10,
			settings: {
				latticeNodeLOD: "auto", latticeIndividualMax: 200, latticeDensityMax: 5000,
				latticeDensityCells: 64, latticeShowSubsetLinks: true,
			},
			selectedKey: null, hoverKey: null,
			namedKeys: new Set<string>(), namedMax: 5,
		});
	} catch (e) {
		threw = e instanceof Error ? (e.stack ?? e.message) : String(e);
	}
	ok(threw === null, `[lattice] draw pipeline threw: ${threw}`);
	ok(drewSomething(rec), `[lattice] no draw ops emitted (rec=${JSON.stringify(rec)})`);
}

// ── droste (Icon Gallery: per-node containment diagrams, tiled) ──
// view.ts draw(): drawDroste(ctx, {canvas,dpr,gallery,cellSize,zoom,panX,panY,hoverId,focusId,hitRegions,hiddenSet}).
{
	const out = runLayout("droste");
	const gallery: DrosteGallery | undefined = out.drosteGallery;
	ok(gallery != null, `[droste] layout produced no drosteGallery`);
	ok((gallery?.cells.length ?? 0) > 0, `[droste] gallery has no cells`);
	const { ctx, rec } = recordingCtx();
	const canvas = mockCanvas(CANVAS_W, CANVAS_H, DPR, ctx);
	const focusId = gallery!.cells[0]?.id ?? "";
	let threw: string | null = null;
	try {
		drawDroste(ctx, {
			canvas, dpr: DPR, gallery: gallery!, cellSize: 240,
			zoom: ZOOM, panX: PAN, panY: PAN,
			hoverId: null, focusId,
			hitRegions: [], hiddenSet: new Set<string>(),
		});
	} catch (e) {
		threw = e instanceof Error ? (e.stack ?? e.message) : String(e);
	}
	ok(threw === null, `[droste] draw pipeline threw: ${threw}`);
	ok(drewSomething(rec), `[droste] no draw ops emitted (rec=${JSON.stringify(rec)})`);
}
