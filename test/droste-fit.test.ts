// drosteFit(cell, cw, ch, cellSize) — centre-on-cell fit for the Icon Gallery:
// zoom to ~55% of the smaller canvas dimension per cell (clamped to [0.05, 3]),
// then pan the cell's world centre to the canvas centre. Behaviour lock for the
// seam extracted from the view's `centerDrosteOn`.
import { drosteFit } from "../src/layout/droste-fit";
import { approx, ok } from "./assert";

const CELL = 240;

// Inline-equivalence with the original view code, across a grid of cases.
function expected(cell: { col: number; row: number }, cw: number, ch: number) {
	const w = cw || 1;
	const h = ch || 1;
	const zoom = Math.min(3, Math.max(0.05, (Math.min(w, h) * 0.55) / CELL));
	const wx = (cell.col + 0.5) * CELL;
	const wy = (cell.row + 0.5) * CELL;
	return { zoom, panX: w / 2 - wx * zoom, panY: h / 2 - wy * zoom };
}

for (const [cw, ch, col, row] of [
	[1000, 800, 0, 0],
	[1200, 900, 3, 5],
	[600, 600, 10, 2],
	[1920, 1080, 7, 7],
] as const) {
	const e = expected({ col, row }, cw, ch);
	const f = drosteFit({ col, row }, cw, ch, CELL);
	approx(f.zoom, e.zoom, 1e-9, `zoom ${cw}x${ch} @(${col},${row})`);
	approx(f.panX, e.panX, 1e-9, `panX ${cw}x${ch} @(${col},${row})`);
	approx(f.panY, e.panY, 1e-9, `panY ${cw}x${ch} @(${col},${row})`);
}

// Zoom ceiling: a tiny canvas dimension relative to CELL still clamps up to 3.
{
	// min(cw,ch)*0.55/240 = 3 → min dim = 3*240/0.55 ≈ 1309; go above it.
	const f = drosteFit({ col: 0, row: 0 }, 2000, 2000, CELL);
	approx(f.zoom, 3, 1e-9, "zoom clamps to ceiling 3");
}

// Zoom floor: a very small canvas clamps down to 0.05.
{
	const f = drosteFit({ col: 0, row: 0 }, 10, 10, CELL);
	approx(f.zoom, 0.05, 1e-9, "zoom clamps to floor 0.05");
}

// Zero canvas dims fall back to 1 (no NaN/Infinity), matching the `|| 1` guard.
{
	const f = drosteFit({ col: 0, row: 0 }, 0, 0, CELL);
	ok(Number.isFinite(f.zoom) && Number.isFinite(f.panX) && Number.isFinite(f.panY), "zero dims stay finite");
	approx(f.zoom, 0.05, 1e-9, "zero dims → floor zoom");
}

// The focused cell's world centre lands at the canvas centre.
{
	const cw = 1000;
	const ch = 800;
	const f = drosteFit({ col: 4, row: 2 }, cw, ch, CELL);
	const wx = (4 + 0.5) * CELL;
	const wy = (2 + 0.5) * CELL;
	approx(wx * f.zoom + f.panX, cw / 2, 1e-9, "cell centre X → canvas centre");
	approx(wy * f.zoom + f.panY, ch / 2, 1e-9, "cell centre Y → canvas centre");
}
