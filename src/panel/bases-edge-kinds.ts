// Pure descriptor list for the Bases "Show Edges" checklist (Settings > Display,
// rendered by renderBasesDisplaySection). Each entry pairs a boolean settings key
// with its checkbox label, in the rendered order (internal links / shared tags /
// shared property). Extracted from the inline literal so the key↔label mapping is
// the single source of truth and unit-testable without a DOM; mirrors the
// noteMenuTopTabs / settingsSubTabs descriptor-list extractions. Behaviour-
// preserving: same keys, same labels, same order.
import type { BaseEdgeKind } from "../bases/project";

type BasesEdgeKindKey = "basesLinkEdges" | "basesSharedTagEdges" | "basesSharedPropEdges";

export interface BasesEdgeKind {
	key: BasesEdgeKindKey;
	label: string;
	/** The projection edge kind this checkbox enables (single source of truth for
	 *  both the UI checklist and the graph-build Set). */
	edge: BaseEdgeKind;
}

export function basesEdgeKinds(): BasesEdgeKind[] {
	return [
		{ key: "basesLinkEdges", label: "Internal links", edge: "link" },
		{ key: "basesSharedTagEdges", label: "Shared tags", edge: "shared-tag" },
		{ key: "basesSharedPropEdges", label: "Shared property", edge: "shared-property" },
	];
}

/** The set of Bases projection edge kinds enabled by the given settings, derived
 *  from the same `basesEdgeKinds()` descriptor list so the key↔kind mapping has a
 *  single source of truth. Extracted from the inline three-`if` Set build in
 *  `buildGraph` (view.ts). */
export function basesEnabledEdgeKinds(settings: Record<BasesEdgeKindKey, boolean>): Set<BaseEdgeKind> {
	const out = new Set<BaseEdgeKind>();
	for (const { key, edge } of basesEdgeKinds()) {
		if (settings[key]) out.add(edge);
	}
	return out;
}
