// L5/L6 — pure frozen-pane hit-testing (matrix + heatmap), extracted from
// view.ts. matrixGeom/heatmapGeom: labelBand = clamp(cssW*0.27, 170..380),
// headerH = 92, matrix rowScreenH = max(18, rowH*zoom), colScreenW = colW*zoom,
// heatmap cellPx = max(4, cell*zoom).
import { ok } from "./assert";
import { hitMatrixLine, hitMatrixCol, hitHeatmapCell } from "../src/interaction/hit-modes";
import type { MatrixMeta, HeatmapMeta } from "../src/layout/layout";

const matrix: MatrixMeta = {
	rows: [{ id: "r0", label: "R0" }, { id: "r1", label: "R1" }, { id: "r2", label: "R2" }],
	cols: [
		{ key: "a", label: "A", size: 1 },
		{ key: "b", label: "B", size: 1 },
		{ key: "c", label: "C", size: 1 },
	],
	bits: [],
	rowH: 40,
	colW: 50,
	blocks: [],
};
// cssW 1000 → labelBand = clamp(270, 170..380) = 270; headerH = 92.
// zoom 1 → rowScreenH = max(18, 40) = 40; colScreenW = 50.
const CSSW = 1000;

// ── matrix lines ──
{
	// sy below header → -1.
	ok(hitMatrixLine(matrix, 3, 1, 0, CSSW, 50) === -1, "sy in header band → -1");
	// panY 0, headerH 92, rowScreenH 40: sy 92 → floor((92-0)/40)=2.
	ok(hitMatrixLine(matrix, 3, 1, 0, CSSW, 92) === 2, "first line below header (got " + hitMatrixLine(matrix, 3, 1, 0, CSSW, 92) + ")");
	// sy past last line (lineCount 3): floor((212)/40)=5 → out of range → -1.
	ok(hitMatrixLine(matrix, 3, 1, 0, CSSW, 212) === -1, "below last line → -1");
	// panY shifts the line mapping: panY 40 → sy 132 → floor((132-40)/40)=2.
	ok(hitMatrixLine(matrix, 3, 1, 40, CSSW, 132) === 2, "panY offset applied");
}

// ── matrix columns ──
{
	// sx in label band (<270) → -1.
	ok(hitMatrixCol(matrix, 1, 0, CSSW, 100) === -1, "sx in label band → -1");
	// panX 0, labelBand 270, colScreenW 50: sx 270 → floor(270/50)=5 → ≥cols.length(3) → -1.
	ok(hitMatrixCol(matrix, 1, 0, CSSW, 270) === -1, "col index past cols → -1");
	// sx 30 with panX -250: passes labelBand? sx 280 ≥ 270 ✓; floor((280-(-250))? no:
	// helper checks sx<labelBand on raw sx. Use sx 280, panX 130 → floor((280-130)/50)=3 → -1.
	ok(hitMatrixCol(matrix, 1, 130, CSSW, 280) === -1, "col 3 out of range");
	// sx 280, panX 180 → floor((280-180)/50)=2 → valid col 2.
	ok(hitMatrixCol(matrix, 1, 180, CSSW, 280) === 2, "valid column index (got " + hitMatrixCol(matrix, 1, 180, CSSW, 280) + ")");
}

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
