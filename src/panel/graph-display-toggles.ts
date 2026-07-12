// Pure descriptor list for the "Graph display" checklist (Settings > Display,
// rendered by renderSettingsDisplayTab). Each entry pairs a boolean settings key
// with its checkbox label, in the rendered order (nodes / enclosures / edges /
// grid). Extracted from the inline literal so the key↔label mapping is the single
// source of truth and unit-testable without a DOM; mirrors the basesEdgeKinds /
// basesToggleRows descriptor-list extractions. Per-mode applicability
// (displayToggleApplies) stays at the call site. Behaviour-preserving: same keys,
// same labels, same order.
type GraphDisplayToggleKey = "showNodes" | "showEnclosures" | "showEdges" | "showGrid";

export interface GraphDisplayToggle {
	key: GraphDisplayToggleKey;
	label: string;
}

export function graphDisplayToggles(): GraphDisplayToggle[] {
	return [
		{ key: "showNodes", label: "Show nodes" },
		{ key: "showEnclosures", label: "Show enclosures" },
		{ key: "showEdges", label: "Show edges" },
		{ key: "showGrid", label: "Show grid" },
	];
}
