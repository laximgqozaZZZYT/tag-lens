// Point-in-rect hit test for screen-space `{x, y, w, h}` rectangles.
//
// The on-canvas legend interactions re-derive the same inclusive-bounds test
// several times in `view.ts` (mousedown legend-drag start + its × button,
// click-to-dismiss ×, wheel-scroll over the panel): a point is inside when it
// sits within `[x, x+w] × [y, y+h]` (both edges inclusive, matching the old
// `px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h`). This is the
// `{x,y,w,h}` sibling of the `{x0,y0,x1,y1}` droste-hit test, which keeps its
// own inline form.
export interface WhRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export function pointInRect(px: number, py: number, r: WhRect): boolean {
	return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}
