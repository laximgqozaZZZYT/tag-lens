// Pure clamp + descriptor for the "Min tag size" number input
// (Settings > Heatmap). Extracted from renderHeatmapMinTagControl so the clamp
// rule is unit-testable without a DOM: any raw input string is floored and
// clamped to a minimum of 1 (there is no upper bound — a heatmap cell can be
// arbitrarily large). Like clampMinFont this never rejects: junk / out-of-range
// input snaps to 1 (NaN → 1). The view applies the value and keeps the
// save/rebuild wiring.
export function clampHeatmapMinTag(raw: string): number {
	return Math.max(1, Math.floor(Number(raw) || 1));
}

// Static <input type="number"> attributes for the same Min-tag row, extracted
// from renderHeatmapMinTagControl so the descriptor lives next to its clamp. The
// min bound mirrors clampHeatmapMinTag's lower bound of 1 (no max — unbounded
// above); the view applies the attr and keeps the DOM + handler wiring.
export interface HeatmapMinTagInputDescriptor {
	attr: { min: string };
}

export function heatmapMinTagInput(): HeatmapMinTagInputDescriptor {
	return { attr: { min: "1" } };
}
