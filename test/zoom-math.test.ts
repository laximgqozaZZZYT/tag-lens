// L3 — pure pan/zoom math (extracted from view.ts wheel handler + zoomBy).
import { ok, approx } from "./assert";
import { zoomAroundPointer, fitTransform, ZOOM_MIN, ZOOM_MAX, type Transform } from "../src/interaction/zoom-math";

// The pixel under the anchor must map to the same world point before & after.
function worldAt(t: Transform, sx: number, sy: number) {
	return { wx: (sx - t.panX) / t.zoom, wy: (sy - t.panY) / t.zoom };
}

// Zoom in around a point: the world coordinate under (sx,sy) is preserved.
{
	const t0: Transform = { zoom: 1, panX: 100, panY: 50 };
	const before = worldAt(t0, 300, 200);
	const t1 = zoomAroundPointer(t0, 2, 300, 200);
	ok(t1.zoom === 2, `zoom doubled (got ${t1.zoom})`);
	const after = worldAt(t1, 300, 200);
	approx(after.wx, before.wx, 1e-9, "anchor world-x preserved on zoom-in");
	approx(after.wy, before.wy, 1e-9, "anchor world-y preserved on zoom-in");
}

// Zoom out preserves the anchor too.
{
	const t0: Transform = { zoom: 4, panX: -20, panY: 80 };
	const before = worldAt(t0, 640, 360);
	const t1 = zoomAroundPointer(t0, 0.5, 640, 360);
	approx(t1.zoom, 2, 1e-9, "zoom halved");
	const after = worldAt(t1, 640, 360);
	approx(after.wx, before.wx, 1e-9, "anchor world-x preserved on zoom-out");
	approx(after.wy, before.wy, 1e-9, "anchor world-y preserved on zoom-out");
}

// Clamp to ZOOM_MAX: a huge factor cannot exceed the ceiling.
{
	const t1 = zoomAroundPointer({ zoom: 5, panX: 0, panY: 0 }, 1000, 10, 10);
	ok(t1.zoom === ZOOM_MAX, `clamped to ZOOM_MAX (got ${t1.zoom})`);
}

// Clamp to ZOOM_MIN: a tiny factor cannot go below the floor.
{
	const t1 = zoomAroundPointer({ zoom: 0.01, panX: 0, panY: 0 }, 0.0001, 10, 10);
	ok(t1.zoom === ZOOM_MIN, `clamped to ZOOM_MIN (got ${t1.zoom})`);
}

// factor 1 is a no-op (same transform).
{
	const t0: Transform = { zoom: 1.5, panX: 33, panY: 77 };
	const t1 = zoomAroundPointer(t0, 1, 200, 200);
	approx(t1.zoom, t0.zoom, 1e-9, "factor 1 keeps zoom");
	approx(t1.panX, t0.panX, 1e-9, "factor 1 keeps panX");
	approx(t1.panY, t0.panY, 1e-9, "factor 1 keeps panY");
}

// fitTransform: a centred square world fits a wider canvas (height-bound) and
// the rect midpoint lands at the canvas centre.
{
	const world = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
	const t = fitTransform(world, 1000, 400, 24);
	// height is the binding axis: z = (400-48)/100 = 3.52
	approx(t.zoom, (400 - 48) / 100, 1e-9, "height-bound fit zoom");
	approx(t.panX, 1000 / 2 - 50 * t.zoom, 1e-9, "rect midpoint centred X");
	approx(t.panY, 400 / 2 - 50 * t.zoom, 1e-9, "rect midpoint centred Y");
}

// fitTransform clamps zoom to ZOOM_MAX for a tiny rect in a big canvas.
{
	const t = fitTransform({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 2000, 2000, 24);
	ok(t.zoom === ZOOM_MAX, `tiny rect clamped to ZOOM_MAX (got ${t.zoom})`);
}

// fitTransform clamps zoom to ZOOM_MIN for a huge rect in a small canvas.
{
	const t = fitTransform({ minX: 0, minY: 0, maxX: 1e7, maxY: 1e7 }, 300, 300, 24);
	ok(t.zoom === ZOOM_MIN, `huge rect clamped to ZOOM_MIN (got ${t.zoom})`);
}

// fitTransform guards a degenerate (zero-area) rect via the max(1, …) floor.
{
	const t = fitTransform({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 400, 400, 0);
	ok(Number.isFinite(t.zoom) && t.zoom > 0, "degenerate rect yields finite positive zoom");
	approx(t.panX, 200 - 5 * t.zoom, 1e-9, "degenerate rect still centres X");
}
