// Clamp a fit-computed zoom into a readable [min, max] range.
//
// Every initial view-fit path (upset/lattice/heatmap/panorama/droste) squeezes
// the world into the viewport and then floors/ceils the result so nodes never
// shrink below legibility nor blow up past the max. Since `min <= max` at every
// call site the clamp is order-independent, so this matches the old inline
// `Math.min(max, Math.max(min, x))` and the `Math.max(min, Math.min(max, x))`
// spelling exactly. `max` defaults to 2 (the common upper bound; droste passes 3).
export function clampZoom(value: number, min: number, max = 2): number {
	return Math.min(max, Math.max(min, value));
}
