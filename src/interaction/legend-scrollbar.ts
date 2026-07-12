// Geometry of the on-canvas legend panel's scrollbar thumb, shared by the
// mousedown (click-to-jump / thumb-drag start) and mousemove (drag) handlers
// in `view.ts` so the two can never drift. Pure: derives the track + thumb
// metrics from the panel height, the total scroll overflow, and whether the
// wide (close-button) top gap applies.
//
// NOTE: `draw/legend-layout.ts` paints the thumb with the same rule but in its
// own render-space variables (`showClose`, `box.height`); unifying that third
// site would need the draw layer to import this — deferred as a follow-up.

export interface LegendScrollbarGeom {
	// Top offset of the scroll track inside the panel.
	trackTop: number;
	// Usable track height (panel height minus top gap and a 4px bottom gap).
	trackH: number;
	// Thumb height (proportional to the visible fraction, floored at 20px).
	thumbH: number;
	// Maximum thumb travel (track height minus thumb height).
	maxThumbY: number;
}

const THUMB_MIN_H = 20;

// `panelH` is the panel's on-screen height (`legendPanelRect.h`), `maxScrollY`
// the total hidden overflow, and `showClose` whether the close button reserves
// the wider 20px top gap (view passes `exportDprMul === 1`).
export function legendScrollbarGeom(
	panelH: number,
	maxScrollY: number,
	showClose: boolean,
): LegendScrollbarGeom {
	const trackTop = showClose ? 20 : 4;
	const trackH = panelH - trackTop - 4;
	const boxH = panelH + maxScrollY;
	const thumbH = Math.max(THUMB_MIN_H, trackH * (panelH / boxH));
	const maxThumbY = trackH - thumbH;
	return { trackTop, trackH, thumbH, maxThumbY };
}

// Convert a thumb-Y travel (0..`maxThumbY`) into a scroll offset (0..`maxScrollY`).
// Guards on `maxThumbY` (no travel → offset 0); `legendScrollbarGeom` only yields
// `maxThumbY > 0` when there is real overflow, so `maxScrollY > 0` at every call.
// Shared by the mousedown click-to-jump and the mousemove drag handlers in `view.ts`.
export function thumbYToScroll(thumbY: number, maxThumbY: number, maxScrollY: number): number {
	return maxThumbY > 0 ? (thumbY / maxThumbY) * maxScrollY : 0;
}

// Inverse of `thumbYToScroll`: map a scroll offset back onto the thumb's Y travel,
// used by mousedown to find the thumb's current position (thumb-drag vs track-jump).
export function scrollToThumbY(scrollY: number, maxScrollY: number, maxThumbY: number): number {
	return maxThumbY > 0 ? (scrollY / maxScrollY) * maxThumbY : 0;
}
