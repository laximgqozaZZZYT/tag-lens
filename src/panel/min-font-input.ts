// Pure clamp + descriptor for the "Min font size (px)" number input
// (Settings > Display). Extracted from renderMinFontSection so the clamp rule is
// unit-testable without a DOM: any raw input string is floored and clamped into
// the closed [0, 48] range (0 = no floor; 48 caps the floor at a sane label
// size). Unlike the Jaccard parser this never rejects — out-of-range / junk
// input snaps to the nearest bound (NaN → 0). The view applies the value and
// keeps the save/requestDraw wiring.
export function clampMinFont(raw: string): number {
	return Math.max(0, Math.min(48, Math.floor(Number(raw) || 0)));
}

// Static <input type="number"> attributes for the same Min-font row, extracted
// from renderMinFontSection so the descriptor lives next to its clamp. The
// min/max/step bounds mirror clampMinFont's closed [0, 48] integer range; the
// view applies the attrs and keeps the DOM + handler wiring. Behaviour-preserving.
export interface MinFontInputDescriptor {
	attr: { min: string; max: string; step: string };
}

export function minFontInput(): MinFontInputDescriptor {
	return { attr: { min: "0", max: "48", step: "1" } };
}
