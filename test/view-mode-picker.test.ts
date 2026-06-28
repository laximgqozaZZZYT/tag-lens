// View-mode picker partitioning (extracted from settings-sections.ts
// renderViewModeSection). Locks the three-group split (Close-up / Panorama-stable
// / Experimental) and the expSelected initial-expand flag so the rendered picker
// and the grouping rules stay in lockstep.
import { ok } from "./assert";
import { partitionViewModePicker } from "../src/panel/view-mode-picker";
import { VIEW_MODES, isCloseup, isPanorama } from "../src/types";

// Mirrors the exact filters used by the picker, against the real VIEW_MODES.
{
	const g = partitionViewModePicker(VIEW_MODES, "lattice");
	ok(
		g.closeup.every((o) => isCloseup(o)),
		"closeup group is exactly the closeup modes",
	);
	ok(
		g.panoramaStable.every((o) => isPanorama(o) && !o.experimental),
		"panoramaStable excludes experimental + closeup",
	);
	ok(
		g.experimental.every((o) => o.experimental),
		"experimental group is exactly the experimental modes",
	);
	// Every mode lands in closeup or experimental or panoramaStable (closeup may
	// overlap experimental in principle; today none do, so counts add up).
	const total = g.closeup.length + g.panoramaStable.length + g.experimental.length;
	ok(total === VIEW_MODES.length, `groups cover all modes (${total}/${VIEW_MODES.length})`);
}

// expSelected reflects whether the current mode is one of the experimental ones.
{
	const exp = VIEW_MODES.find((o) => o.experimental);
	const stable = VIEW_MODES.find((o) => !o.experimental);
	ok(exp !== undefined && stable !== undefined, "fixture has both an exp + stable mode");
	if (exp && stable) {
		ok(partitionViewModePicker(VIEW_MODES, exp.id).expSelected === true, "expSelected true for an experimental mode");
		ok(partitionViewModePicker(VIEW_MODES, stable.id).expSelected === false, "expSelected false for a stable mode");
	}
}

// Pure: derives only from inputs — a custom mode list partitions independently.
{
	const fixture = [
		{ id: "droste", label: "C", perspective: "closeup" } as const,
		{ id: "lattice", label: "P" } as const,
		{ id: "upset", label: "X", experimental: true } as const,
	];
	const g = partitionViewModePicker(fixture, "lattice");
	ok(g.closeup.length === 1 && g.closeup[0].id === "droste", "fixture closeup");
	ok(g.panoramaStable.length === 1 && g.panoramaStable[0].id === "lattice", "fixture panoramaStable");
	ok(g.experimental.length === 1 && g.experimental[0].id === "upset", "fixture experimental");
	ok(g.expSelected === false, "fixture expSelected false (lattice is stable)");
}
