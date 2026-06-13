// Channel registry (registration-based; add a channel = registerChannel()).
// First scope: "color" only. The SCALE turns data -> normalized (ScaledValue);
// the CHANNEL turns normalized -> concrete NodeDrawParams. Adding size/opacity/
// shape/group/axis/label/border later is a registerChannel() call each.
import type { VisualChannel } from "./types";

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
			const light = Math.round(20 + Math.max(0, Math.min(1, scaled.t)) * 55);
			params.fillColor = `hsl(210, 70%, ${light}%)`;
		}
	},
});

registerChannel({
	id: "axisX",
	label: "Position X",
	accepts: ["categorical", "ordinal", "quantitative", "temporal"],
	appliesTo: (mode) => ["euler", "euler-true", "euler-venn", "bipartite", "bubblesets", "droste"].includes(mode),
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
	appliesTo: (mode) => ["euler", "euler-true", "euler-venn", "bipartite", "bubblesets", "droste"].includes(mode),
	apply: (params, scaled) => {
		if (!scaled.missing && scaled.t != null) {
			params.axisY = scaled.t;
		}
	},
});
