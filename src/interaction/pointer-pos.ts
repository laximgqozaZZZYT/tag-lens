// Canvas-local pointer coordinates from a mouse/wheel event.
//
// Every input handler in `view.ts` (mousedown/mousemove/mouseup/click/wheel)
// re-derives the same two lines: read the canvas `getBoundingClientRect()`, then
// subtract the rect origin from the event's client coords to get canvas-space
// `(sx, sy)` (`clientX - left`, `clientY - top`). Centralize that subtraction so
// no handler drifts on which axis maps to left vs top. The DOM read
// (`getBoundingClientRect()`) stays at the call site; this consumes only the
// resulting origin so it is pure and testable.
export interface RectOrigin {
	left: number;
	top: number;
}

export interface ClientPoint {
	clientX: number;
	clientY: number;
}

export interface ScreenPoint {
	sx: number;
	sy: number;
}

export function screenPointFromRect(rect: RectOrigin, e: ClientPoint): ScreenPoint {
	return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
}
