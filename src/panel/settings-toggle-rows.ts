// Pure descriptors for the two standalone Settings toggle rows whose change
// handlers carry tab-specific side effects, so only the key↔label mapping is
// extracted (the handler stays in the view): the Bridge-finder "Show ghost
// edges" row (Settings > Display, renderSettingsDisplayTab → save + rebuild) and
// the "Show legend on canvas" row (Settings > Encode, renderSettingsEncodeTab →
// reset legendHiddenModes + requestDraw). Pairs a boolean settings key with its
// checkbox label so the mapping is the single source of truth and unit-testable
// without a DOM; mirrors the basesToggleRows / basesEdgeKinds descriptor
// extractions. Behaviour-preserving: same keys, same labels.
export interface SettingsToggleRow {
	key: "showGhostEdges" | "showLegend";
	label: string;
}

export function bridgeGhostEdgeToggle(): SettingsToggleRow {
	return { key: "showGhostEdges", label: "Show ghost edges" };
}

export function legendToggle(): SettingsToggleRow {
	return { key: "showLegend", label: "Show legend on canvas" };
}
