// Channel registry (registration-based; add a channel = registerChannel()).
// First scope: "color" only. The SCALE turns data -> normalized (ScaledValue);
// the CHANNEL turns normalized -> concrete NodeDrawParams. Adding size/opacity/
// shape/group/axis/label/border later is a registerChannel() call each.
import type { VisualChannel } from "./types";
import { shapeForKey } from "./shapes";
import { sequentialColorRamp } from "../draw/legend-spec";

export const channelRegistry: VisualChannel[] = [];

export function registerChannel(c: VisualChannel): void {
	const i = channelRegistry.findIndex((x) => x.id === c.id);
	if (i >= 0) channelRegistry[i] = c;
	else channelRegistry.push(c);
}

export function resolveChannel(id: string): VisualChannel | undefined {
	return channelRegistry.find((c) => c.id === id);
}

// ── built-in channels (first scope: color) ───────────────────────────────────
registerChannel({
	id: "color",
	label: "Color",
	accepts: ["categorical", "ordinal", "quantitative"],
	// Current "universalize" policy: color applies in every mode. Tighten per
	// mode later by inspecting `mode` here — single point of control.
	appliesTo: () => true,
	apply: (params, scaled) => {
		if (scaled.missing) return;
		// Categorical / palette-resolved: the scale already produced a concrete hex.
		if (scaled.output) {
			params.fillColor = scaled.output;
			return;
		}
		// Quantitative: map the normalized position to a default sequential ramp.
		// (Scale owns data->t; channel owns t->visual.)
		if (scaled.t != null) {
			params.fillColor = sequentialColorRamp(scaled.t);
		}
	},
});

registerChannel({
	id: "axisX",
	label: "Position X",
	accepts: ["categorical", "ordinal", "quantitative", "temporal"],
	appliesTo: (mode) => ["euler", "bubblesets", "droste"].includes(mode),
	apply: (params, scaled) => {
		if (!scaled.missing && scaled.t != null) {
			params.axisX = scaled.t;
		}
	},
});

registerChannel({
	id: "axisY",
	label: "Position Y",
	accepts: ["categorical", "ordinal", "quantitative", "temporal"],
	appliesTo: (mode) => ["euler", "bubblesets", "droste"].includes(mode),
	apply: (params, scaled) => {
		if (!scaled.missing && scaled.t != null) {
			params.axisY = scaled.t;
		}
	},
});

registerChannel({
	id: "size",
	label: "Size",
	accepts: ["quantitative", "ordinal"],
	appliesTo: () => true,
	apply: (params, scaled) => {
		if (scaled.missing || scaled.t == null) {
			params.sizeScale = 1.0;
			return;
		}
		// Map t (0..1) to size scale (1x to 4x).
		// By defaulting the scale config domain to [0, 3], this perfectly
		// replicates the legacy `Math.min(4, degree + 1)` behavior.
		params.sizeScale = 1.0 + scaled.t * 3.0;
	},
});

registerChannel({
	id: "opacity",
	label: "Opacity (Freshness)",
	accepts: ["temporal", "quantitative"],
	appliesTo: () => true,
	apply: (params, scaled) => {
		// Missing mtime defaults to fully opaque (safety fix)
		if (scaled.missing || scaled.t == null) {
			params.opacity = 1.0;
			return;
		}
		// linear interpolation between 1.0 and 0.35
		// t=0 (newest) -> 1.0, t=1 (stalest) -> 0.35
		params.opacity = 1.0 - scaled.t * (1.0 - 0.35);
	},
});

registerChannel({
	id: "shape",
	label: "Shape",
	accepts: ["categorical", "ordinal"],
	appliesTo: () => true,
	apply: (params, scaled) => {
		if (scaled.missing) return;
		// Use the category key (not the palette colour) so shape is independent of
		// the colour channel. Stable mapping shared with the on-canvas legend.
		const key = scaled.category ?? scaled.output;
		if (key) params.shape = shapeForKey(key);
	},
});

registerChannel({
	id: "border",
	label: "Border Color",
	accepts: ["categorical"],
	appliesTo: () => true,
	apply: (params, scaled) => {
		if (scaled.missing) return;
		if (scaled.output) {
			params.borderColor = scaled.output;
		}
	},
});
