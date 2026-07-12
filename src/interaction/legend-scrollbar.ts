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
