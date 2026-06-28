import type { ClusterRect } from "../layout/layout";
import type { MiniSettings } from "../types";

// Pure inputs the cluster-enclosure renderers read off the view. Extracted
// verbatim from MiniGraphView.drawBodyTile() so the per-mode option assembly
// lives in one testable place (same pattern as computeUpsetDrawInput /
// computeHeatmapDrawInput). `kind` selects which enclosure painter the view
// dispatches to; both painters share the same argument shape. Returns null when
// enclosures are suppressed (toggle off, or UpSet mode which has no body tile).
export interface EnclosureDrawInput {
	kind: "bubblesets" | "euler";
	clusters: ClusterRect[];
	highlightedClusters: Set<string>;
	warningClusters: Set<string> | undefined;
	zoom: number;
	hoverPos: { x: number; y: number } | null;
}

export interface EnclosureDrawInputDeps {
	settings: MiniSettings;
	// laid.upset truthiness — UpSet draws no body-tile enclosures.
	upset: boolean;
	clusters: ClusterRect[];
	// laid.nodes — only id/x/y are read to resolve the hovered node's centre.
	nodes: readonly { id: string; x: number; y: number }[];
	highlightedClusters: Set<string>;
	zoom: number;
	hoveredNodeId: string | null;
}

export function computeEnclosureDrawInput(
	deps: EnclosureDrawInputDeps,
): EnclosureDrawInput | null {
	if (!deps.settings.showEnclosures || deps.upset) return null;
	const hn = deps.hoveredNodeId
		? deps.nodes.find((n) => n.id === deps.hoveredNodeId)
		: null;
	return {
		kind: deps.settings.viewMode === "bubblesets" ? "bubblesets" : "euler",
		clusters: deps.clusters,
		highlightedClusters: deps.highlightedClusters,
		warningClusters: undefined,
		zoom: deps.zoom,
		hoverPos: hn ? { x: hn.x, y: hn.y } : null,
	};
}
