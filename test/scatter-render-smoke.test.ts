// Headless render SMOKE test for the SCATTER (F2) DRAW pipeline.
//
// Like bubblesets-render-smoke, the real-Obsidian E2E is unrunnable in CI / the
// agent sandbox, so this drives the ACTUAL draw functions over the scatter
// layout + axis placement with a RECORDING canvas mock. Scatter has no
// enclosures / edges / cluster labels (one card per note on quantitative axes),
// so the figure IS: the axis grid (drawCardGrid, reading laid.axes) + one card
// per node (drawCard). It asserts the pipeline renders WITHOUT THROWING, that
// the axes are actually populated (the F2.5 reflection point — scatter axes are
// always on), and that grid + cards emit their expected draw ops.
import { ok } from "./assert";
import { layout, type SizedNode, type LayoutOptions } from "../src/layout/layout";
import type { GraphData, GraphNode } from "../src/types";
import { axisLayout, type AxisSpec, type AxisBand, type AxisTick } from "../src/layout/axis-layout";
import { scatterAxisDefaults } from "../src/encoding/scatter-axis-defaults";
import type { EncContext } from "../src/encoding/types";
import { drawCardGrid } from "../src/draw/draw-helpers";
import { drawCard } from "../src/draw/draw-card";
import { setTheme, defaultTheme } from "../src/draw/theme";
import { recordingCtx, mockCanvas } from "./recording-ctx";

setTheme(defaultTheme()); // headless: theme() must not need getComputedStyle

// drawCardGrid reads window.devicePixelRatio (the live view's DPR source); the
// node test bundle has no DOM, so stub it for the duration of this file.
(globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };

function opts(): LayoutOptions {
	return {
		clusterSpacing: 80, nodeSpacing: 1, cellW: 270, cellH: 72, minFontPx: 10,
		clusterLabels: new Map<string, string>(), anchorPlacement: "concentric", viewMode: "scatter",
	} as LayoutOptions;
}

// Mirror view.ts applyAxisLayout: place each node by its quantitative axis,
// re-centre the world on (0,0), and shift the axis specs to match.
function placeScatterAxes(laidNodes: ReturnType<typeof layout>["nodes"], slotW: number, slotH: number, ctx: EncContext) {
	const def = scatterAxisDefaults(undefined, undefined); // → degree (x) / ageDays (y)
	let nSpan = Math.max(20, Math.ceil(Math.sqrt(laidNodes.length)) * 4);
	if (nSpan % 2 !== 0) nSpan += 1;
	const { positions, axes, width, height } = axisLayout(laidNodes, ctx, {
		bindingX: def.x,
		bindingY: def.y,
		width: nSpan * slotW,
		height: nSpan * slotH,
		cell: { w: slotW, h: slotH },
		measureText: (t) => t.length * 6,
	});
	const cx = width / 2;
	const cy = height / 2;
	for (const n of laidNodes) {
		const p = positions.get(n.id);
		if (p) { n.x = p.x - cx; n.y = p.y - cy; }
	}
	const shift = (spec: AxisSpec | undefined, off: number): AxisSpec | undefined => {
		if (!spec) return undefined;
		const out = { ...spec };
		if (out.bands) out.bands = out.bands.map((b: AxisBand) => ({ ...b, start: b.start - off, end: b.end - off, center: b.center - off }));
		if (out.ticks) out.ticks = out.ticks.map((t: AxisTick) => ({ ...t, pos: t.pos - off }));
		return out;
	};
	return { x: shift(axes.x, cx), y: shift(axes.y, cy) };
}

function renderSmoke(label: string, nodes: GraphNode[]): void {
	const data: GraphData = { nodes, edges: [] };
	const sized: SizedNode[] = nodes.map((n) => ({ ...n, width: 270, height: 72 }));
	const out = layout(data, sized, opts());

	// Scatter keeps one positioned node per note and no clusters / edges.
	ok(out.nodes.length === nodes.length, `[${label}] scatter must keep one node per note (got ${out.nodes.length}/${nodes.length})`);
	ok(out.clusters.length === 0, `[${label}] scatter must have no clusters (got ${out.clusters.length})`);
	ok(out.edges.length === 0, `[${label}] scatter must have no edges (got ${out.edges.length})`);

	// Degree drives the X axis; give each note a distinct degree so the axis has spread.
	const degMap = new Map<string, number>();
	nodes.forEach((n, i) => { degMap.set(n.id, i % 7); });
	const encCtx: EncContext = {
		nowMs: 1_700_000_000_000,
		degreeOf: (id) => { const d = degMap.get(id) ?? 0; return { inDeg: d, outDeg: 0, degree: d }; },
	};
	out.axes = placeScatterAxes(out.nodes, out.slotW, out.slotH, encCtx);

	// F2.5 reflection: scatter axes are ALWAYS on (default degree/ageDays), so
	// both specs must be populated with tick positions — not undefined.
	ok(!!out.axes.x, `[${label}] scatter X axis spec missing`);
	ok(!!out.axes.y, `[${label}] scatter Y axis spec missing`);
	ok((out.axes.x?.ticks?.length ?? 0) > 0, `[${label}] scatter X axis has no ticks`);
	ok((out.axes.y?.ticks?.length ?? 0) > 0, `[${label}] scatter Y axis has no ticks`);

	const { ctx, rec } = recordingCtx();
	const canvas = mockCanvas(2000, 2000, 1, ctx);
	let threw: string | null = null;
	try {
		// World centred on (0,0): pan the origin to the canvas centre so the
		// axis ticks + cards fall inside the visible world rect.
		drawCardGrid(ctx, out, canvas, 1, 1000, 1000);
		for (const n of out.nodes) {
			drawCard(ctx, n, { scale: 1, bodyLines: [], showBody: false, highlighted: false, zoom: 1, minFontPx: 10 });
		}
	} catch (e) {
		threw = e instanceof Error ? (e.stack ?? e.message) : String(e);
	}
	ok(threw === null, `[${label}] scatter draw pipeline threw: ${threw}`);
	// drawCardGrid + drawCard both paint with path ops (stroke/fill) + text;
	// the grid alone always calls ctx.stroke(), each card strokes its outline.
	ok(rec.stroke > 0, `[${label}] axis grid + card outlines drew no stroked paths (stroke=0)`);
	ok(rec.fill > 0, `[${label}] no card fills drawn (fill=0) for ${out.nodes.length} cards`);
	ok(rec.fillText > 0, `[${label}] no card text drawn (fillText=0) for ${out.nodes.length} cards`);
}

// Dataset A: notes spread over a few tags with varying recency (ageDays drives Y).
{
	const nodes: GraphNode[] = [];
	for (let k = 0; k < 24; k++) {
		nodes.push({
			id: `s${k}`,
			label: `note_${k}`,
			memberships: ["_all", k % 2 === 0 ? "act" : "drama"],
			ageDays: (k * 13) % 200,
		});
	}
	renderSmoke("scatter-24", nodes);
}

// Dataset B: a single tag, tight cluster of notes (smallest non-trivial figure).
{
	const nodes: GraphNode[] = [];
	for (let k = 0; k < 5; k++) {
		nodes.push({ id: `t${k}`, label: `n_${k}`, memberships: ["solo"], ageDays: k * 30 });
	}
	renderSmoke("scatter-5", nodes);
}
