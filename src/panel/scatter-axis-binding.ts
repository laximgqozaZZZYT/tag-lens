// Scatter mode (F2.6) axis-picker binding bridge. Pure helpers that translate
// between the persisted encoding bindings (`settings.encoding`) and the X/Y
// attribute + scale `<select>` state of the Scatter settings section. Kept next
// to the F2.6a option lists; no DOM, no Obsidian. The DOM picker reads
// `scatterAxisSelection` to seed its dropdowns and writes back through
// `setScatterAxisBinding` on change.
import { scatterAxisDefaults } from "../encoding/scatter-axis-defaults";
import type { EncodingBinding, ScaleConfig } from "../encoding/types";
import type { ScatterAxisScale } from "./scatter-axis-options";

export type ScatterAxisChannel = "axisX" | "axisY";

interface ScatterAxisChoice {
	fieldId: string;
	scale: ScatterAxisScale;
}

export interface ScatterAxisSelection {
	x: ScatterAxisChoice;
	y: ScatterAxisChoice;
}

// Narrow an arbitrary scale type down to the quantitative subset a scatter axis
// can render; anything categorical/ordinal (or unset) falls back to linear.
function narrowScale(t: ScaleConfig["type"] | undefined): ScatterAxisScale {
	return t === "log" || t === "quantile" ? t : "linear";
}

// The currently-effective scatter X/Y selection used to seed the picker
// dropdowns: the user's enabled axisX/axisY binding when present, otherwise the
// scatter default (degree / ageDays, linear). Mirrors what `applyAxisLayout`
// actually lays out so the picker never disagrees with the plot.
export function scatterAxisSelection(encoding: EncodingBinding[]): ScatterAxisSelection {
	const bx = encoding.find((b) => b.channelId === "axisX");
	const by = encoding.find((b) => b.channelId === "axisY");
	const def = scatterAxisDefaults(bx, by);
	return {
		x: { fieldId: def.x.fieldId, scale: narrowScale(def.x.scale?.type) },
		y: { fieldId: def.y.fieldId, scale: narrowScale(def.y.scale?.type) },
	};
}

// Returns a new encoding array with the given axis channel's binding set to the
// patched field/scale (always enabled). The unspecified side of the patch keeps
// the channel's current effective value (so changing only the field preserves
// the scale and vice versa); other channels' bindings are untouched. Pure —
// never mutates the input array or its members.
export function setScatterAxisBinding(
	encoding: EncodingBinding[],
	channel: ScatterAxisChannel,
	patch: { fieldId?: string; scale?: ScatterAxisScale },
): EncodingBinding[] {
	const sel = scatterAxisSelection(encoding);
	const cur = channel === "axisX" ? sel.x : sel.y;
	const next: EncodingBinding = {
		channelId: channel,
		fieldId: patch.fieldId ?? cur.fieldId,
		scale: { type: patch.scale ?? cur.scale },
		enabled: true,
	};
	return [...encoding.filter((b) => b.channelId !== channel), next];
}
