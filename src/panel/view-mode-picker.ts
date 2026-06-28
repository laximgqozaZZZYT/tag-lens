import type { ViewMode, ViewModeOption } from "../types";
import { isCloseup, isPanorama } from "../types";

// Pure partitioning for the View-mode picker (Settings > View). The picker shows
// three groups in this order: Close-up, Panorama (stable only), and a collapsible
// Experimental (beta) group. `expSelected` says whether the currently-selected
// mode is experimental — the view uses it as the Experimental group's initial
// expanded state. Extracted from `renderViewModeSection` so the grouping rules
// (which mirror `isCloseup`/`isPanorama`/`experimental`) are unit-testable without
// a DOM. Behaviour-preserving: same filters, same order.
export interface ViewModePickerGroups {
	closeup: ViewModeOption[];
	panoramaStable: ViewModeOption[];
	experimental: ViewModeOption[];
	expSelected: boolean;
}

export function partitionViewModePicker(
	modes: ViewModeOption[],
	currentMode: ViewMode,
): ViewModePickerGroups {
	const closeup = modes.filter((o) => isCloseup(o));
	const panoramaStable = modes.filter((o) => isPanorama(o) && !o.experimental);
	const experimental = modes.filter((o) => o.experimental);
	const expSelected = experimental.some((o) => o.id === currentMode);
	return { closeup, panoramaStable, experimental, expSelected };
}
