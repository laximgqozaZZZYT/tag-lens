// legendScrollbarGeom(panelH, maxScrollY, showClose) — the scrollbar thumb
// geometry shared by the mousedown + mousemove legend handlers in view.ts.
import { approx, ok } from "./assert";
import { legendScrollbarGeom } from "../src/interaction/legend-scrollbar";

// Wide (close-button) top gap = 20; the 4px bottom gap is always subtracted.
{
	const g = legendScrollbarGeom(200, 100, true);
	approx(g.trackTop, 20, 0, "showClose → trackTop 20");
	approx(g.trackH, 176, 0, "trackH = 200 - 20 - 4");
	// thumbH = trackH * panelH/boxH = 176 * 200/300.
	approx(g.thumbH, 176 * (200 / 300), 1e-9, "thumbH proportional to visible fraction");
	approx(g.maxThumbY, g.trackH - g.thumbH, 1e-9, "maxThumbY = trackH - thumbH");
}

// Narrow top gap = 4 when the close button is absent.
{
	const g = legendScrollbarGeom(200, 100, false);
	approx(g.trackTop, 4, 0, "no close → trackTop 4");
	approx(g.trackH, 192, 0, "trackH = 200 - 4 - 4");
}

// Thumb height is floored at 20px even for huge overflow.
{
	const g = legendScrollbarGeom(40, 100000, false);
	// Unclamped thumbH would be ~0.01px; the floor wins.
	approx(g.thumbH, 20, 0, "thumbH floored at 20");
	approx(g.maxThumbY, g.trackH - 20, 1e-9, "maxThumbY tracks the floored thumb");
}

// No overflow → boxH == panelH → thumb fills the whole track (maxThumbY 0).
{
	const g = legendScrollbarGeom(200, 0, false);
	approx(g.thumbH, g.trackH, 1e-9, "no overflow → thumb == track");
	approx(g.maxThumbY, 0, 1e-9, "no overflow → no travel");
}

ok(true, "legendScrollbarGeom cases done");
