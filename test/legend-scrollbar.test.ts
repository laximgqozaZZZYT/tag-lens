// legendScrollbarGeom(panelH, maxScrollY, showClose) — the scrollbar thumb
// geometry shared by the mousedown + mousemove legend handlers in view.ts.
import { approx, ok } from "./assert";
import {
	legendScrollbarGeom,
	scrollToThumbY,
	thumbYToScroll,
} from "../src/interaction/legend-scrollbar";

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

// thumbYToScroll / scrollToThumbY — the proportional thumb-travel ↔ scroll-offset
// maps shared by the mousedown (click-to-jump) + mousemove (drag) handlers.
{
	// thumb halfway down its travel → scroll halfway through the overflow.
	approx(thumbYToScroll(50, 100, 400), 200, 1e-9, "thumbY→scroll: half travel = half overflow");
	approx(thumbYToScroll(0, 100, 400), 0, 1e-9, "thumbY→scroll: top → 0");
	approx(thumbYToScroll(100, 100, 400), 400, 1e-9, "thumbY→scroll: bottom → full overflow");
	// scroll halfway → thumb halfway (the exact inverse mapping).
	approx(scrollToThumbY(200, 400, 100), 50, 1e-9, "scroll→thumbY: half overflow = half travel");
	approx(scrollToThumbY(0, 400, 100), 0, 1e-9, "scroll→thumbY: 0 → top");
	approx(scrollToThumbY(400, 400, 100), 100, 1e-9, "scroll→thumbY: full overflow → bottom");
}

// maxThumbY 0 (no travel: thumb fills the track) → both maps collapse to 0,
// exactly the old inline `maxThumbY > 0 ? … : 0` guard (never divides by 0).
{
	approx(thumbYToScroll(37, 0, 400), 0, 0, "thumbY→scroll: no travel → 0");
	approx(scrollToThumbY(37, 400, 0), 0, 0, "scroll→thumbY: no travel → 0");
}

// Round-trip: scroll → thumbY → scroll recovers the offset whenever there is travel.
{
	const maxScrollY = 640;
	const maxThumbY = 120;
	for (const s of [0, 90, 320, 640]) {
		const back = thumbYToScroll(scrollToThumbY(s, maxScrollY, maxThumbY), maxThumbY, maxScrollY);
		approx(back, s, 1e-9, `round-trip preserves scroll ${s}`);
	}
}

ok(true, "legend-scrollbar cases done");
