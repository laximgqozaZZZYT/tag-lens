// Pure interpretation of raw `WheelEvent` deltas, extracted from view.ts's
// `wheel` handler so the magic multipliers/sensitivity live in one place and
// are unit-testable. No DOM, no `this` — the handler reads `e.deltaY`/
// `e.deltaMode` and feeds them here.

// A WheelEvent reports its delta in one of three units (`deltaMode`): pixels
// (0), lines (1), or pages (2). Normalize any of them to a pixel-ish quantity
// so the legend scroll offset advances by a comparable amount regardless of the
// device/browser reporting mode. The line/page multipliers match the values the
// wheel handler used inline before this extraction.
export const WHEEL_LINE_PX = 20;
export const WHEEL_PAGE_PX = 300;

export function normalizeWheelDelta(deltaY: number, deltaMode: number): number {
	if (deltaMode === 1) return deltaY * WHEEL_LINE_PX; // DOM_DELTA_LINE
	if (deltaMode === 2) return deltaY * WHEEL_PAGE_PX; // DOM_DELTA_PAGE
	return deltaY; // DOM_DELTA_PIXEL (or unknown) — already pixels
}

// Convert a raw wheel delta into a multiplicative zoom factor. Scrolling up
// (negative deltaY) zooms in (factor > 1); scrolling down zooms out (factor < 1).
// The exponential keeps zoom perceptually uniform across the whole range; the
// sensitivity constant is the inline `0.0015` the wheel handler used.
export const WHEEL_ZOOM_SENSITIVITY = 0.0015;

export function wheelZoomFactor(deltaY: number, sensitivity = WHEEL_ZOOM_SENSITIVITY): number {
	return Math.exp(-deltaY * sensitivity);
}
