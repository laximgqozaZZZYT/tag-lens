// Pure descriptor list for the two standalone Bases toggle rows below the "Show
// Edges" checklist (Settings > Display, rendered by renderBasesDisplaySection):
// "always cluster by view" and "show base file name prefix". Each entry pairs a
// boolean settings key with its checkbox label, in the rendered order. Extracted
// from the inline clusterRow/prefixRow blocks so the key↔label mapping is the
// single source of truth and unit-testable without a DOM; mirrors the
// basesEdgeKinds / noteMenuTopTabs descriptor-list extractions. Behaviour-
// preserving: same keys, same labels, same order.
type BasesToggleKey = "basesClusterByView" | "basesShowPrefix";

export interface BasesToggleRow {
	key: BasesToggleKey;
	label: string;
}

export function basesToggleRows(): BasesToggleRow[] {
	return [
		{ key: "basesClusterByView", label: "Always cluster by view (even single-view bases)" },
		{ key: "basesShowPrefix", label: "Show base file name prefix in labels" },
	];
}
