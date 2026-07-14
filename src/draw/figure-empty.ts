import type { LaidOut } from "../layout/layout";

// True when the layout produced NOTHING to draw across every mode, so `draw()`
// shows the "No nodes match current filters" hint instead of a blank canvas.
//
// A figure is empty only when ALL of these are empty at once, because each mode
// stores its content in a different slot of `LaidOut`:
//   • world-positioned cards → `nodes`
//   • UpSet plot             → `upset.columns` (nodes stays empty by design)
//   • co-occurrence heatmap  → `heatmap.n` cells
//   • intersection lattice   → `lattice.nodes`
// The lattice/heatmap/droste branches return earlier in `draw()`, but this
// predicate stays defensive (checks every slot) so it reads correctly in
// isolation.
export function figureIsEmpty(laid: LaidOut): boolean {
	const upsetHasColumns = (laid.upset?.columns.length ?? 0) > 0;
	const heatmapHasCells = (laid.heatmap?.n ?? 0) > 0;
	const latticeHasNodes = (laid.lattice?.nodes.length ?? 0) > 0;
	return (
		laid.nodes.length === 0 &&
		!upsetHasColumns &&
		!heatmapHasCells &&
		!latticeHasNodes
	);
}
