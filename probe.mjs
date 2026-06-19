// Offscreen real-render probe: drives the ACTUAL source modules (buildGallery/
// buildIcon/drawIcon via drawDroste, and layoutEulerTrue + drawEnclosures) with
// a logging mock CanvasRenderingContext2D, and inspects the literal fillStyle/
// gradient-stop values used to paint intersection pieces/cells. No unit-test
// framework, no bundle grep — this is the real draw call graph.
import { build } from "esbuild";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "/home/ubuntu/obsidian-plugins/tag-lens/src";

const entry = `
import { buildGallery, buildIcon } from "${SRC}/layout/droste-layout.ts";
import { drawDroste } from "${SRC}/draw/draw-droste.ts";
import { layout } from "${SRC}/layout/layout.ts";
import { drawEnclosures } from "${SRC}/draw/draw-enclosures.ts";
import { computeClusterBBoxes } from "${SRC}/layout/cluster-bbox.ts";

globalThis.__PROBE__ = { buildGallery, buildIcon, drawDroste, layout, drawEnclosures, computeClusterBBoxes };
`;

const result = await build({
	stdin: { contents: entry, resolveDir: SRC, loader: "ts" },
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: { obsidian: "/home/ubuntu/obsidian-plugins/tag-lens/test/obsidian.mock.ts" },
});
const dir = mkdtempSync(join(tmpdir(), "stripe-probe-"));
const out = join(dir, "bundle.mjs");
writeFileSync(out, result.outputFiles[0].text);
await import(pathToFileURL(out).href);
const { buildGallery, buildIcon, drawDroste, layout, drawEnclosures, computeClusterBBoxes } = globalThis.__PROBE__;

// ---------------------------------------------------------------------------
// Logging mock 2D context. Records every fillRect/fill/createLinearGradient
// call with the CURRENT fillStyle (snapshotted at call time) and gradient
// stops, plus the active transform/clip bbox in DEVICE px, so we can verify
// the gradient coordinate range actually overlaps the painted rect.
// ---------------------------------------------------------------------------
function makeCtx() {
	const log = [];
	let fillStyle = "#000";
	let transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
	const clipStack = [];
	const apply = (x, y) => ({
		x: transform.a * x + transform.c * y + transform.e,
		y: transform.b * x + transform.d * y + transform.f,
	});
	const ctx = {
		canvas: { width: 4000, height: 4000 },
		measureText: (t) => ({ width: t.length * 6 }),
		save() { clipStack.push(transform); },
		restore() { transform = clipStack.pop() ?? transform; },
		setTransform(a, b, c, d, e, f) { transform = { a, b, c, d, e, f }; },
		translate(x, y) { const p = apply(x, y); transform = { ...transform, e: p.x, f: p.y }; },
		scale() {},
		rotate() {},
		clearRect() {},
		beginPath() {},
		moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
		rect(x, y, w, h) { this._lastRect = { x, y, w, h }; },
		clip() {},
		stroke() {},
		strokeRect() {},
		fillText() {},
		setLineDash() {},
		get fillStyle() { return fillStyle; },
		set fillStyle(v) { fillStyle = v; },
		fillRect(x, y, w, h) {
			const p0 = apply(x, y);
			log.push({ op: "fillRect", x, y, w, h, devX: p0.x, devY: p0.y, fillStyle });
		},
		fill() {
			const r = this._lastRect;
			log.push({ op: "fill(rect)", ...r, fillStyle });
		},
		createLinearGradient(x0, y0, x1, y1) {
			const stops = [];
			const grad = {
				addColorStop(offset, color) { stops.push({ offset, color }); },
				__isGradient: true, x0, y0, x1, y1, stops,
			};
			log.push({ op: "createLinearGradient", x0, y0, x1, y1, stopsRef: stops });
			return grad;
		},
		createPattern() { return null; },
	};
	Object.defineProperty(ctx, "lineWidth", { value: 1, writable: true });
	Object.defineProperty(ctx, "strokeStyle", { value: "#000", writable: true });
	Object.defineProperty(ctx, "font", { value: "10px sans-serif", writable: true });
	Object.defineProperty(ctx, "textAlign", { value: "left", writable: true });
	Object.defineProperty(ctx, "textBaseline", { value: "alphabetic", writable: true });
	return { ctx, log };
}

const node = (id, memberships) => ({ id, label: id, memberships });

// ===========================================================================
// SCENARIO A: Icon Gallery (droste). Build a small graph where a node N has
// TWO tags {beat, drama}; the ③ level for the OTHER tag's members sharing
// both tags should produce a striped cell (set.keys.length>1).
// ===========================================================================
console.log("=== SCENARIO A: Icon Gallery (drawDroste -> drawIcon, intersection ③ cell) ===");
{
	const nodes = [
		node("N0", ["beat", "drama"]),     // focus
		node("N1", ["beat", "drama"]),     // ② exact match peer
		node("N2", ["beat"]),              // ③ subset {beat}
		node("N3", ["drama"]),             // ③ subset {drama}
		node("N4", ["beat", "drama", "timeline"]), // shares >=2 of T -> exclusive O={beat,drama}
	];
	const data = { nodes, edges: [] };
	const gallery = buildGallery(data);
	const icon = buildIcon(gallery, "N0");
	console.log("icon.levels:", JSON.stringify(icon.levels.map(l => ({ n: l.n, sets: l.sets.map(s => ({ keys: s.keys, members: s.members.map(m=>m.id), hue: s.hue })) })), null, 2));

	const { ctx, log } = makeCtx();
	const canvasStub = { width: 4000, height: 4000 };
	drawDroste(ctx, {
		canvas: canvasStub, dpr: 2, gallery, cellSize: 400, zoom: 1, panX: 0, panY: 0,
		hoverId: null, focusId: "N0",
	});
	const grads = log.filter((l) => l.op === "createLinearGradient");
	console.log(`\ntotal fillRect calls: ${log.filter(l=>l.op==='fillRect').length}, gradients created: ${grads.length}`);
	for (const g of grads) {
		console.log("gradient:", JSON.stringify({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, stops: g.stopsRef }));
	}
	// Find the fillRect calls whose fillStyle IS one of those gradient objects.
	const stripedFills = log.filter((l) => l.op === "fillRect" && l.fillStyle && l.fillStyle.__isGradient);
	console.log(`fillRect calls painted with a gradient fillStyle: ${stripedFills.length}`);
	for (const f of stripedFills) {
		const g = f.fillStyle;
		console.log(`  rect devicepx=(${f.x.toFixed(1)},${f.y.toFixed(1)},${f.w.toFixed(1)},${f.h.toFixed(1)})  gradient-line=(${g.x0.toFixed(1)},${g.y0.toFixed(1)})->(${g.x1.toFixed(1)},${g.y1.toFixed(1)})  colors=${g.stops.map(s=>s.color).join(" | ")}`);
		// Does the gradient line actually lie within/along the rect's span?
		const within = g.x0 >= f.x - 0.5 && g.x1 <= f.x + f.w + 0.5 && g.y0 >= f.y - 0.5 && g.y1 <= f.y + f.h + 0.5;
		console.log(`    gradient line within rect bounds: ${within}`);
	}
	if (stripedFills.length === 0) {
		console.log("  >>> NO gradient-striped fillRect found for Icon Gallery intersection cell <<<");
	}
}

console.log("\n=== which Item produced the gradient? add hue/hues introspection ===");
{
	const nodes = [
		node("N0", ["beat", "drama"]),
		node("N1", ["beat", "drama"]),
		node("N2", ["beat"]),
		node("N3", ["drama"]),
		node("N4", ["beat", "drama", "timeline"]),
	];
	const data = { nodes, edges: [] };
	const gallery = buildGallery(data);
	const icon = buildIcon(gallery, "N0");
	// Re-derive buildItems logic inline (mirrors draw-droste.ts buildItems) to label which set/member emits hues.
	for (const lvl of icon.levels) {
		for (const set of lvl.sets) {
			const hueDefined = set.hue !== undefined;
			const wouldStripe = !hueDefined && lvl.n !== 2 && set.keys.length > 1;
			console.log(`level n=${lvl.n} set.keys=${JSON.stringify(set.keys)} members=${JSON.stringify(set.members.map(m=>m.id))} set.hue=${set.hue} -> stripe? ${wouldStripe}`);
		}
	}
}

console.log("\n=== Scenario A2: check N4's OWN icon (T has 3 tags -> real >=2-key subset at n>=3) ===");
{
	const nodes = [
		node("N0", ["beat", "drama"]),
		node("N1", ["beat", "drama"]),
		node("N2", ["beat"]),
		node("N3", ["drama"]),
		node("N4", ["beat", "drama", "timeline"]),
		node("N5", ["beat", "drama"]), // shares 2-of-3 of N4's T -> populates the {beat,drama} subset at n=4 (d=1)
	];
	const data = { nodes, edges: [] };
	const gallery = buildGallery(data);
	const icon = buildIcon(gallery, "N4");
	for (const lvl of icon.levels) {
		for (const set of lvl.sets) {
			const hueDefined = set.hue !== undefined;
			const wouldStripe = !hueDefined && lvl.n !== 2 && set.keys.length > 1;
			console.log(`level n=${lvl.n} set.keys=${JSON.stringify(set.keys)} members=${JSON.stringify(set.members.map(m=>m.id))} set.hue=${set.hue} -> stripe? ${wouldStripe}`);
		}
	}
}

console.log("\n=== Scenario A3: render N4's icon directly and verify the striped fillRect ===");
{
	const nodes = [
		node("N0", ["beat", "drama"]),
		node("N1", ["beat", "drama"]),
		node("N2", ["beat"]),
		node("N3", ["drama"]),
		node("N4", ["beat", "drama", "timeline"]),
		node("N5", ["beat", "drama"]),
	];
	const data = { nodes, edges: [] };
	const gallery = buildGallery(data);
	const { ctx, log } = makeCtx();
	drawDroste(ctx, {
		canvas: { width: 4000, height: 4000 }, dpr: 2, gallery, cellSize: 400, zoom: 1, panX: 0, panY: 0,
		hoverId: null, focusId: "N4",
	});
	const grads = log.filter((l) => l.op === "createLinearGradient");
	console.log(`gradients created across whole gallery paint: ${grads.length}`);
	const stripedFills = log.filter((l) => l.op === "fillRect" && l.fillStyle && l.fillStyle.__isGradient);
	for (const f of stripedFills) {
		const g = f.fillStyle;
		console.log(`  STRIPED rect devicepx=(${f.x.toFixed(1)},${f.y.toFixed(1)},${f.w.toFixed(1)},${f.h.toFixed(1)}) colors=${g.stops.map(s=>s.color).join(" | ")}`);
	}
}

console.log("\n=== SCENARIO B: BubbleSets / Enclosures (layoutEulerTrue -> drawEnclosures) ===");
{
	const nodes = [
		node("M0", ["alpha"]),
		node("M1", ["alpha"]),
		node("M2", ["beta"]),
		node("M3", ["beta"]),
		node("M4", ["alpha", "beta"]), // exclave: lives in alpha's nested box but tagged with both
	];
	const data = { nodes, edges: [] };
	const laidOut = layout(data, nodes.map(n => ({ ...n, width: 80, height: 24 })), {
		viewMode: "bubblesets",
		cellW: 80, cellH: 24, nodeSpacing: 1,
		clusterLabels: new Map([["alpha","alpha"],["beta","beta"]]),
	});
	console.log("clusters:", JSON.stringify(laidOut.clusters.map(c => ({
		groupKey: c.groupKey, pieces: c.pieces?.map(p => ({ kind: p.kind, hueKey: p.hueKey, hueKeys: p.hueKeys, x: p.x, y: p.y, w: p.w, h: p.h })),
	})), null, 2));

	const { ctx, log } = makeCtx();
	drawEnclosures(ctx, laidOut.clusters, new Set(), undefined, 1, null, true);
	const grads = log.filter((l) => l.op === "createLinearGradient");
	console.log(`gradients created: ${grads.length}`);
	for (const g of grads) console.log("  gradient:", JSON.stringify({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, colors: g.stopsRef.map(s=>s.color) }));
	const stripedFills = log.filter((l) => l.op === "fill(rect)" && l.fillStyle && l.fillStyle.__isGradient);
	console.log(`fill(rect) calls painted with a gradient: ${stripedFills.length}`);
	for (const f of stripedFills) {
		console.log(`  STRIPED rect=(${f.x},${f.y},${f.w},${f.h}) colors=${f.fillStyle.stops.map(s=>s.color).join(" | ")}`);
	}
	if (stripedFills.length === 0) console.log("  >>> NO gradient-striped fill found for BubbleSets/Enclosures sub-piece <<<");
}

console.log("\n=== SCENARIO C: computeClusterBBoxes (Encode axis-bound path) -> drawEnclosures ===");
{
	// Re-bundle to also expose computeClusterBBoxes.
}

console.log("\n=== SCENARIO C: Encode-axis path (computeClusterBBoxes) -> drawEnclosures ===");
{
	// Mirror the M0..M4 scenario, but positioned cards as computeClusterBBoxes expects
	// (this is what applyAxisLayout in view.ts calls after axisLayout() repositions nodes).
	const slotW = 100, slotH = 30, channelW = 20, channelH = 6;
	const positionedNodes = [
		{ id: "M0", label: "M0", memberships: ["alpha"], x: 0, y: 0, width: 80, height: 24 },
		{ id: "M1", label: "M1", memberships: ["alpha"], x: 100, y: 0, width: 80, height: 24 },
		{ id: "M2", label: "M2", memberships: ["beta"], x: 0, y: 100, width: 80, height: 24 },
		{ id: "M3", label: "M3", memberships: ["beta"], x: 100, y: 100, width: 80, height: 24 },
		// M4: tagged both alpha+beta, but POSITIONED on the axis grid OUTSIDE beta's own AABB
		// (axis binding scatters it by its bound field, e.g. by mtime/word-count, landing it
		// far from beta's other cards) -> becomes beta's "sub"/exclave piece, same as Scenario B.
		{ id: "M4", label: "M4", memberships: ["alpha", "beta"], x: 0, y: 0, width: 80, height: 24 },
	];
	// Place M4 inside alpha's main AABB region (so it's an exclave for "beta").
	positionedNodes[4].x = 100; positionedNodes[4].y = 0;

	const { clusters } = computeClusterBBoxes(positionedNodes, {
		clusterKeys: ["alpha", "beta"],
		labels: new Map([["alpha","alpha"],["beta","beta"]]),
		slotW, slotH, channelW, channelH,
		clusterSpacing: 24,
	});
	console.log("clusters (from computeClusterBBoxes):", JSON.stringify(clusters.map(c => ({
		groupKey: c.groupKey,
		pieces: c.pieces?.map(p => ({ kind: p.kind, hueKey: p.hueKey, hueKeys: p.hueKeys, x: p.x, y: p.y, w: p.w, h: p.h })),
	})), null, 2));

	const { ctx, log } = makeCtx();
	drawEnclosures(ctx, clusters, new Set(), undefined, 1, null, true);
	const grads = log.filter((l) => l.op === "createLinearGradient");
	console.log(`gradients created: ${grads.length}`);
	const subFills = log.filter((l) => l.op === "fill(rect)");
	console.log(`total fill(rect) calls: ${subFills.length}`);
	for (const f of subFills) {
		const isGrad = f.fillStyle && f.fillStyle.__isGradient;
		console.log(`  fill rect=(${f.x},${f.y},${f.w},${f.h}) fillStyle=${isGrad ? "GRADIENT:"+f.fillStyle.stops.map(s=>s.color).join("|") : f.fillStyle}`);
	}
	if (grads.length === 0) console.log("  >>> NO gradient created at all on the computeClusterBBoxes path — sub-pieces have no hueKeys <<<");
}
