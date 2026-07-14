// The <canvas> BACKING STORE (its device-pixel buffer) is sized independently
// of its CSS layout box: the buffer must be `clientPx * devicePixelRatio` so a
// HiDPI display gets crisp (non-blurred) rendering, and the render transform
// then pre-multiplies by the same `dpr`. This is the pure rule for that buffer
// size, kept DOM-free so the floor + min-1 guard is unit-testable without a
// real canvas.
//
//   • `Math.floor` — a backing store is an INTEGER pixel buffer; a fractional
//     `clientW * dpr` (fractional CSS size × fractional dpr) is truncated.
//   • `Math.max(1, …)` — a 0- or negative-sized element (detached / collapsed
//     layout, or a bogus dpr) must never yield a 0-width buffer: a 0-dimension
//     canvas throws / paints nothing, so clamp to a minimum 1×1 buffer.
export interface CanvasBackingSize {
	width: number;
	height: number;
}

export function canvasBackingSize(
	clientW: number,
	clientH: number,
	dpr: number,
): CanvasBackingSize {
	return {
		width: Math.max(1, Math.floor(clientW * dpr)),
		height: Math.max(1, Math.floor(clientH * dpr)),
	};
}
