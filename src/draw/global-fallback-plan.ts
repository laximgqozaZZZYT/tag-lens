// Pure gating for the global "display fallback" overlay layers (grid box /
// enclosure frame / decorative edges / node-count badge / meta badges),
// extracted verbatim from MiniGraphView.drawGlobalDisplayFallbacks() so the
// per-mode on/off rules live in one testable place (same pattern as
// computeEdgeDrawPlan). The view still owns the actual ctx drawing + the
// vertical badge stacking; this only decides which layers/badges run.
export interface GlobalFallbackPlan {
	drawGrid: boolean;
	drawEnclosures: boolean;
	drawEdges: boolean;
	drawNodesBadge: boolean;
	drawMaturityBadge: boolean;
	drawSizeBadge: boolean;
	drawJaccardBadge: boolean;
}

export interface GlobalFallbackPlanDeps {
	// Current view mode string (e.g. "euler", "bubblesets", "droste", "upset",
	// "heatmap", …). Euler-family + upset draw these natively, so most gates
	// suppress there.
	mode: string;
	showGrid: boolean;
	showEnclosures: boolean;
	showEdges: boolean;
	showNodes: boolean;
	showMaturity: boolean;
	// Node card grid dimensions — the "Size: RxC" badge only shows when either
	// is not 1 (a mode that doesn't scale cards natively).
	nodeRows: number;
	nodeCols: number;
	heatmapJaccard: boolean;
}

export function computeGlobalFallbackPlan(deps: GlobalFallbackPlanDeps): GlobalFallbackPlan {
	// Euler + bubblesets natively draw grid/enclosures/edges/nodes.
	const isEuler = deps.mode === "euler" || deps.mode === "bubblesets";
	return {
		// Droste draws its own Cartesian cell grid, so exclude it too.
		drawGrid: deps.showGrid && !isEuler && deps.mode !== "droste",
		drawEnclosures: deps.showEnclosures && !isEuler,
		drawEdges: deps.showEdges && !isEuler,
		drawNodesBadge: deps.showNodes && !isEuler && deps.mode !== "upset",
		drawMaturityBadge: deps.showMaturity,
		drawSizeBadge:
			!isEuler && deps.mode !== "upset" && (deps.nodeRows !== 1 || deps.nodeCols !== 1),
		drawJaccardBadge: deps.mode === "heatmap" && deps.heatmapJaccard,
	};
}
