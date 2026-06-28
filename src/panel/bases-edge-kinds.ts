// Pure descriptor list for the Bases "Show Edges" checklist (Settings > Display,
// rendered by renderBasesDisplaySection). Each entry pairs a boolean settings key
// with its checkbox label, in the rendered order (internal links / shared tags /
// shared property). Extracted from the inline literal so the key↔label mapping is
// the single source of truth and unit-testable without a DOM; mirrors the
// noteMenuTopTabs / settingsSubTabs descriptor-list extractions. Behaviour-
// preserving: same keys, same labels, same order.
type BasesEdgeKindKey = "basesLinkEdges" | "basesSharedTagEdges" | "basesSharedPropEdges";

export interface BasesEdgeKind {
	key: BasesEdgeKindKey;
	label: string;
}

export function basesEdgeKinds(): BasesEdgeKind[] {
	return [
		{ key: "basesLinkEdges", label: "Internal links" },
		{ key: "basesSharedTagEdges", label: "Shared tags" },
		{ key: "basesSharedPropEdges", label: "Shared property" },
	];
}
