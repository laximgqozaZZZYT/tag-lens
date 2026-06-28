// Pure parse + descriptor for the "Size (m × n)" number inputs in the Node
// display section (Settings). Extracted from renderNodeDisplaySection so the
// accept/reject rule is unit-testable without a DOM.
//
// Unlike the Min-font clamp this *rejects* (returns null) rather than snapping:
// a raw input string is parsed with parseInt (junk → NaN → reject) and accepted
// only when it is a finite integer in the closed [1, max] range. The caller
// chooses `max` per scope — 8 for a per-layer override (matches the input's max
// attribute), 12 for the global default — preserving the original asymmetry. On
// reject the view either keeps the current value (global) or deletes the
// override (layer scope); that side-effect wiring stays in the view.
export function parseNodeSize(raw: string, max: number): number | null {
	const v = parseInt(raw, 10);
	if (Number.isFinite(v) && v >= 1 && v <= max) return v;
	return null;
}

// Static <input type="number"> attributes for the same Size row, extracted so
// the descriptor lives next to its parser. The min/max/step bounds mirror the
// per-layer parseNodeSize range ([1, 8] integer); the view applies the attrs to
// both the m and n inputs and keeps the DOM + handler wiring. Behaviour-preserving.
export interface NodeSizeInputDescriptor {
	attr: { min: string; max: string; step: string };
}

export function nodeSizeInput(): NodeSizeInputDescriptor {
	return { attr: { min: "1", max: "8", step: "1" } };
}
