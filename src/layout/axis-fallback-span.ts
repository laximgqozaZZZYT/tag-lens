// Pre-axis fallback world span for the card modes (euler/bubblesets/scatter).
// Before `axisLayout` spreads the dots along the bound X/Y channels it needs a
// default figure box to fall back to (unbound axis, or the degenerate no-spread
// case). The box is a square grid of `nSpan` cells per side sized off the node
// count — enough room that the fallback grid never overlaps — forced EVEN so the
// figure-centre `cx = width/2` / `cy = height/2` (used to re-anchor the axis into
// world space via `shiftAxisSpec`) land on integer cell boundaries. Pure.
export function axisFallbackSpan(
	nodeCount: number,
	slotW: number,
	slotH: number,
): { nSpan: number; width: number; height: number } {
	let nSpan = Math.max(20, Math.ceil(Math.sqrt(nodeCount)) * 4);
	if (nSpan % 2 !== 0) nSpan += 1; // Force even to ensure integer cx/cy
	return { nSpan, width: nSpan * slotW, height: nSpan * slotH };
}
