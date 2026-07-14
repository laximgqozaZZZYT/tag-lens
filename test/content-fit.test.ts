// contentFit(bounds, visW, visH) — initial fit for the default card figure
// (euler / bubblesets / scatter / panorama): fit the world bounding box into
// the visible area minus asymmetric canvas-pixel padding (side 20, top 36,
// bottom 20), clamp the zoom up to a tiny 0.005 floor, and centre the world
// box in the padded area. Behaviour lock for the seam extracted from the view's
// initial-fit path.
import type { ContentBounds } from "../src/layout/content-bounds";
import { contentFit } from "../src/layout/content-fit";
import { approx, ok } from "./assert";

// Inline re-derivation of the padded-area math, matching the extracted builder.
function expected(bounds: ContentBounds, visW: number, visH: number) {
	const { minX, minY, maxX, maxY } = bounds;
	const padX = 20;
	const padTop = 36;
	const padBottom = 20;
	const fitW = Math.max(1, visW - 2 * padX);
	const fitH = Math.max(1, visH - padTop - padBottom);
	const zx = fitW / Math.max(1, maxX - minX);
	const zy = fitH / Math.max(1, maxY - minY);
	const zoom = Math.min(2, Math.max(0.005, Math.min(zx, zy)));
	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	return { zoom, panX: padX + fitW / 2 - cx * zoom, panY: padTop + fitH / 2 - cy * zoom };
}

// A modest figure that fits comfortably below the clampZoom ceiling (2): zoom
// is the limiting axis fit ratio, pans centre the world box in the padded area.
{
	const bounds: ContentBounds = { minX: 0, minY: 0, maxX: 800, maxY: 400 };
	const visW = 1000;
	const visH = 700;
	const fit = contentFit(bounds, visW, visH);
	const exp = expected(bounds, visW, visH);
	approx(fit.zoom, exp.zoom, 1e-9, "zoom = min(zx, zy) when in [floor, 2]");
	approx(fit.panX, exp.panX, 1e-9, "panX centres the world box in the padded area");
	approx(fit.panY, exp.panY, 1e-9, "panY centres the world box (extra top pad)");
	// Sanity: the padded fit area centre maps to the world box centre.
	const cx = (bounds.minX + bounds.maxX) / 2;
	approx(fit.panX + cx * fit.zoom, 20 + (visW - 40) / 2, 1e-9, "world centre X lands at padded-area centre");
}

// An off-origin box (negative coords) — pans must follow the world centre, not
// assume a 0-anchored box.
{
	const bounds: ContentBounds = { minX: -300, minY: -100, maxX: 100, maxY: 300 };
	const visW = 900;
	const visH = 600;
	const fit = contentFit(bounds, visW, visH);
	const exp = expected(bounds, visW, visH);
	approx(fit.zoom, exp.zoom, 1e-9, "off-origin: zoom from box extent");
	approx(fit.panX, exp.panX, 1e-9, "off-origin: panX from world centre");
	approx(fit.panY, exp.panY, 1e-9, "off-origin: panY from world centre");
}

// A huge figure on a small canvas whose fit would fall below the 0.005 floor →
// zoom clamps up to the floor (huge vaults still frame, user zooms in).
{
	const bounds: ContentBounds = { minX: 0, minY: 0, maxX: 500000, maxY: 500000 };
	const fit = contentFit(bounds, 400, 300);
	ok(fit.zoom === 0.005, "zoom clamps up to the 0.005 floor for a tiny fit ratio");
}

// A tiny figure on a large canvas whose fit would exceed the clampZoom ceiling
// (2) → zoom caps at 2.
{
	const bounds: ContentBounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
	const fit = contentFit(bounds, 1200, 900);
	ok(fit.zoom === 2, "zoom caps at the clampZoom ceiling (2) for a huge fit ratio");
}

// Degenerate zero-size box → Math.max(1, …) guards keep zoom finite/positive
// and pans finite.
{
	const bounds: ContentBounds = { minX: 5, minY: 5, maxX: 5, maxY: 5 };
	const fit = contentFit(bounds, 800, 600);
	ok(Number.isFinite(fit.zoom) && fit.zoom > 0, "zero box → finite positive zoom");
	ok(Number.isFinite(fit.panX) && Number.isFinite(fit.panY), "zero box → finite pans");
}
