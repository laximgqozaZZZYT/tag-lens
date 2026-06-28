// Standalone Settings toggle-row descriptors (extracted from settings-tabs.ts:
// the Bridge-finder "Show ghost edges" row and the "Show legend on canvas" row).
// Locks each key↔label mapping so the rendered toggle and the settings key it
// binds stay in lockstep.
import { ok } from "./assert";
import { bridgeGhostEdgeToggle, legendToggle } from "../src/panel/settings-toggle-rows";
import { DEFAULT_SETTINGS } from "../src/types";

{
	const ghost = bridgeGhostEdgeToggle();
	ok(ghost.key === "showGhostEdges", `ghost key (${ghost.key})`);
	ok(ghost.label === "Show ghost edges", `ghost label (${ghost.label})`);

	const legend = legendToggle();
	ok(legend.key === "showLegend", `legend key (${legend.key})`);
	ok(legend.label === "Show legend on canvas", `legend label (${legend.label})`);

	// Both keys are real boolean settings fields (bind to DEFAULT_SETTINGS).
	for (const { key } of [ghost, legend]) {
		ok(typeof DEFAULT_SETTINGS[key] === "boolean", `${key} is a boolean settings field`);
	}
}
