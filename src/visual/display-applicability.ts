// Which "Graph display" / overlay toggles actually take effect in each view
// mode. Used to gate the Display settings panel so a mode never shows a toggle
// that its renderer ignores (e.g. "Show edges" in the screen-space heatmap).
//
// Kept DOM-free and pure so the applicability matrix is unit-testable.
import type { ViewMode } from "../types";

// The world-space card toggles plus the per-card overlays driven from the
// Display tab. `minFontPx` is intentionally excluded — it is a global LOD floor
// that applies to every mode and is always shown.
export type DisplayToggleKey =
	| "showNodes"
	| "showEnclosures"
	| "showEdges"
	| "showGrid"
	| "showMaturity";

// Modes whose figure is built from world-space cards via drawBodyTile/drawCard:
// every card toggle and per-card overlay applies.


export function displayToggleApplies(mode: ViewMode, key: DisplayToggleKey): boolean {
	return true;
}
