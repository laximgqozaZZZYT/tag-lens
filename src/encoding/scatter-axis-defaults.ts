// Scatter mode (F2) defaults its position axes ON. Unlike the euler/bubblesets
// overlay — where axisX/axisY are opt-in encoding bindings the user discovers in
// the encoding panel — a scatter plot is DEFINED by its two quantitative axes, so
// they are always present. This pure helper takes whatever the user has bound
// (possibly nothing) and returns the effective X/Y bindings, falling back to
// sensible quantitative defaults (x = degree, y = ageDays) when a side is unbound
// or disabled. A user's own enabled binding always wins, scale config included.
import type { EncodingBinding } from "./types";

export const SCATTER_DEFAULT_AXIS_X = "degree";
export const SCATTER_DEFAULT_AXIS_Y = "ageDays";

function defaultAxisBinding(channelId: string, fieldId: string): EncodingBinding {
	// Quantitative fields (degree / ageDays) read best on a linear scale; the user
	// can re-bind field + scale via the Scatter settings (F2.6).
	return { channelId, fieldId, scale: { type: "linear" }, enabled: true };
}

// Returns the X/Y axis bindings scatter should lay out with: the user's binding
// when it is enabled, otherwise the quantitative default for that side. Pure —
// never mutates the inputs.
export function scatterAxisDefaults(
	bindingX: EncodingBinding | undefined,
	bindingY: EncodingBinding | undefined,
): { x: EncodingBinding; y: EncodingBinding } {
	return {
		x: bindingX?.enabled ? bindingX : defaultAxisBinding("axisX", SCATTER_DEFAULT_AXIS_X),
		y: bindingY?.enabled ? bindingY : defaultAxisBinding("axisY", SCATTER_DEFAULT_AXIS_Y),
	};
}
