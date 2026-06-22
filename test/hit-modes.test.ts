// L5/L6 — pure frozen-pane hit-testing for the co-occurrence heatmap,
// extracted from view.ts. heatmapGeom: labelBand = clamp(cssW*0.27, 170..380),
// headerH = 92, cellPx = max(4, cell*zoom).
import { ok } from "./assert";
import { hitHeatmapCell } from "../src/interaction/hit-modes";
import type { HeatmapMeta } from "../src/layout/layout";

const CSSW = 1000;

// ── heatmap cells ──
const heatmap: HeatmapMeta = {
	tags: [
		{ key: "a", label: "A", size: 1 },
		{ key: "b", label: "B", size: 1 },
		{ key: "c", label: "C", size: 1 },
	],
	counts: new Uint32Array(9),
	n: 3,
	nodeIds: [[], [], []],
	maxOff: 0,
	p95: 0,
	cell: 30,
	totalNotes: 0,
};
// cssW 1000 → labelBand 270, headerH 92; zoom 1 → cellPx max(4,30)=30.
{
	ok(hitHeatmapCell(heatmap, 1, 0, 0, CSSW, 100, 200) === null, "sx in label band → null");
	ok(hitHeatmapCell(heatmap, 1, 0, 0, CSSW, 300, 50) === null, "sy in header band → null");
	// sx 300 panX 270 → j=floor(30/30)=1; sy 122 panY 92 → i=floor(30/30)=1.
	const c = hitHeatmapCell(heatmap, 1, 270, 92, CSSW, 300, 122);
	ok(c != null && c.i === 1 && c.j === 1, "valid cell (1,1) (got " + JSON.stringify(c) + ")");
	// j past n: sx 480 panX 270 → j=7 → out of range → null.
	ok(hitHeatmapCell(heatmap, 1, 270, 92, CSSW, 480, 122) === null, "j past n → null");
}
