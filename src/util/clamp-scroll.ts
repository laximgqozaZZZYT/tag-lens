// Clamp a scrollbar offset into `[0, max]`.
//
// The on-canvas legend scrollbar re-derives the same lower-bound-zero /
// upper-bound-`max` clamp several times in `view.ts`: the track click-to-jump
// thumb-Y offset (`[0, maxThumbY]`), the thumb-drag scroll position and the
// wheel-scroll position (both `[0, maxScrollY]`). All three matched the inline
// `Math.max(0, Math.min(max, value))`, which this centralizes. Distinct from
// `clampZoom` (two-sided readable-zoom clamp with a default max) — this always
// floors at 0 and takes the ceiling explicitly.
export function clampScroll(value: number, max: number): number {
	return Math.max(0, Math.min(max, value));
}
