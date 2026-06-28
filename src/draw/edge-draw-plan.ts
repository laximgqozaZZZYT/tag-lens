// Pure gating for the three body-tile edge layers (ghost / base / accent),
// extracted verbatim from MiniGraphView.drawBodyTile() so the on/off rules live
// in one testable place (same pattern as computeEnclosureDrawInput). The view
// still owns the actual drawGhostEdges/drawBaseEdges/drawAccentEdges calls and
// their live args — this only decides which layers run.
export interface EdgeDrawPlan {
	drawGhost: boolean;
	drawBase: boolean;
	drawAccent: boolean;
}

export interface EdgeDrawPlanDeps {
	showEdges: boolean;
	showGhostEdges: boolean;
	// laid.upset truthiness — UpSet draws no body-tile edges.
	upset: boolean;
	// Any highlight active this frame (gates the accent overlay).
	hasHighlight: boolean;
}

export function computeEdgeDrawPlan(deps: EdgeDrawPlanDeps): EdgeDrawPlan {
	const edgesOn = deps.showEdges && !deps.upset;
	return {
		drawGhost: edgesOn && deps.showGhostEdges,
		drawBase: edgesOn,
		drawAccent: edgesOn && deps.hasHighlight,
	};
}
