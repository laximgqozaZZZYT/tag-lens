// Spec for the Display-panel mode gating: card modes get every card toggle,
// UpSet gets only the card-level subset, and screen-space / diagram modes get
// none of the world-space card toggles.
import { ok } from "./assert";
import { displayToggleApplies, type DisplayToggleKey } from "../src/visual/display-applicability";

const ALL_KEYS: DisplayToggleKey[] = [
	"showNodes",
	"showEnclosures",
	"showEdges",
	"showGrid",
	"showMaturity",
];

const ALL_MODES = [
	"euler", "bubblesets",
	"heatmap", "lattice", "droste", "upset"
] as const;

for (const mode of ALL_MODES) {
	ok(
		ALL_KEYS.every((k) => displayToggleApplies(mode, k)),
		`mode '${mode}' applies every display toggle`,
	);
}
