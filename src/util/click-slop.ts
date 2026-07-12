// Click-vs-drag slop: has the pointer moved far enough since mousedown to count
// as a drag (pan) rather than a click? `view.ts`'s mousemove handler flips
// `pointerMoved` once the pointer leaves a small dead-zone around the press
// point, so a released drag is never mistaken for a click that jumps to a file.
//
// The dead-zone is a Manhattan (L1) radius: the pointer counts as moved when
// `|dx| + |dy|` exceeds the slop (strict `>`, matching the old inline
// `Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4`).
export const CLICK_SLOP_PX = 4;

export function exceedsClickSlop(dx: number, dy: number, slop = CLICK_SLOP_PX): boolean {
	return Math.abs(dx) + Math.abs(dy) > slop;
}
