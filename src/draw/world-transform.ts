// The canvas `setTransform` 6-tuple that maps WORLD coordinates → device pixels.
// The figure is painted in world space (pan/zoom), then pre-multiplied by the
// device-pixel ratio so a HiDPI display stays crisp. Every world-space draw pass
// in `view.ts`'s `draw()` (the card grid, the tiled body, the post-tile label /
// header restore) must use the SAME matrix or the layers would drift apart, so
// the matrix identity lives here once:
//
//   • uniform scale  `a = d = dpr * zoom`  (no shear/rotation: `b = c = 0`)
//   • translation    `e = dpr * panX`, `f = dpr * panY`
//
// A tile offset is folded in by the caller passing a pre-offset `panX`/`panY`
// (e.g. `panX + zoom * offX`); the scale is unaffected. Kept DOM-free so the
// matrix is unit-testable without a real 2D context.
export function worldTransform(
	dpr: number,
	zoom: number,
	panX: number,
	panY: number,
): [number, number, number, number, number, number] {
	const s = dpr * zoom;
	return [s, 0, 0, s, dpr * panX, dpr * panY];
}
