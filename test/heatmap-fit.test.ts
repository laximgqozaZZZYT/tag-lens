// heatmapFit(h, canvasW, canvasH) — initial fit for the heatmap: fit the n×n
// cell grid into the smaller data-area dimension (canvas minus the frozen
// label band / header band), clamp the zoom up to a low floor, and pin the
// grid origin to the band edges. Behaviour lock for the seam extracted from the
// view's initial-fit path.
import type { HeatmapMeta } from "../src/layout/layout";
import { heatmapFit } from "../src/layout/heatmap-fit";
import { ok } from "./assert";

// Minimal HeatmapMeta stub — heatmapGeom/heatmapFit only read `n` and `cell`.
function meta(n: number, cell: number): HeatmapMeta {
	return {
		tags: [],
		counts: new Uint32Array(0),
		n,
		nodeIds: [],
		maxOff: 0,
		p95: 0,
		cell,
		totalNotes: 0,
	};
}

// labelBand = min(380, max(170, canvasW * 0.27)); headerH = 92 (constant).
function labelBand(canvasW: number): number {
	return Math.min(380, Math.max(170, canvasW * 0.27));
}
const HEADER_H = 92;

// A grid that fits comfortably below the clampZoom ceiling (2) → zoom is the
// raw fit ratio, pans pin to the frozen bands.
{
	const canvasW = 1000;
	const canvasH = 800;
	const h = meta(20, 40);
	const band = labelBand(canvasW); // max(170, 270) = 270
	const availW = canvasW - band; // 730
	const availH = canvasH - HEADER_H; // 708
	const expectFit = Math.min(availW, availH) / (h.n * h.cell); // 708/800 = 0.885
	const fit = heatmapFit(h, canvasW, canvasH);
	ok(fit.zoom === expectFit, "zoom = min(availW, availH) / (n*cell) when in [floor, 2]");
	ok(fit.panX === band, "panX pins to the label band");
	ok(fit.panY === HEADER_H, "panY pins to the header band");
}

// A huge grid on a small canvas whose fit would fall below the 0.05 floor →
// zoom clamps up to the floor.
{
	const canvasW = 300;
	const canvasH = 300;
	const h = meta(100, 40);
	const band = labelBand(canvasW); // max(170, 81) = 170
	const fit = heatmapFit(h, canvasW, canvasH);
	ok(fit.zoom === 0.05, "zoom clamps up to the 0.05 floor for a tiny fit ratio");
	ok(fit.panX === band, "panX pins to the label band even when clamped");
	ok(fit.panY === HEADER_H, "panY pins to the header band even when clamped");
}

// A tiny grid on a large canvas whose fit would exceed the clampZoom ceiling
// (2) → zoom caps at 2, pans still pin to the bands.
{
	const canvasW = 1200;
	const canvasH = 900;
	const h = meta(2, 10);
	const fit = heatmapFit(h, canvasW, canvasH);
	ok(fit.zoom === 2, "zoom caps at the clampZoom ceiling (2) for a huge fit ratio");
	ok(fit.panX === labelBand(canvasW), "panX pins to the label band at the ceiling");
	ok(fit.panY === HEADER_H, "panY pins to the header band at the ceiling");
}

// Degenerate zero-size grid → Math.max(1, …) guards keep zoom finite/positive.
{
	const fit = heatmapFit(meta(0, 0), 800, 600);
	ok(Number.isFinite(fit.zoom) && fit.zoom > 0, "zero grid → finite positive zoom");
	ok(Number.isFinite(fit.panX) && Number.isFinite(fit.panY), "zero grid → finite pans");
}
