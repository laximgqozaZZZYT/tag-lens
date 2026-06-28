import { ok } from "./assert";
import {
	computeEdgeDrawPlan,
	type EdgeDrawPlanDeps,
} from "../src/draw/edge-draw-plan";

// Characterization tests for the pure edge-layer gating extracted from
// MiniGraphView.drawBodyTile(). They lock which of ghost/base/accent run so the
// extraction can't silently drift from the original inline `if` conditions.

function deps(over: Partial<EdgeDrawPlanDeps> = {}): EdgeDrawPlanDeps {
	return {
		showEdges: true,
		showGhostEdges: true,
		upset: false,
		hasHighlight: false,
		...over,
	};
}

// All three gates open only when edges on, ghost on, and a highlight is active.
{
	const p = computeEdgeDrawPlan(deps({ hasHighlight: true }));
	ok(p.drawGhost && p.drawBase && p.drawAccent, "everything on → all layers");
}

// showEdges off suppresses every layer (base/ghost/accent all ride on it).
{
	const p = computeEdgeDrawPlan(deps({ showEdges: false, hasHighlight: true }));
	ok(!p.drawGhost && !p.drawBase && !p.drawAccent, "showEdges off → nothing");
}

// UpSet has no body-tile edges regardless of other flags.
{
	const p = computeEdgeDrawPlan(deps({ upset: true, hasHighlight: true }));
	ok(!p.drawGhost && !p.drawBase && !p.drawAccent, "upset → nothing");
}

// Ghost is the only layer gated by showGhostEdges; base/accent unaffected.
{
	const p = computeEdgeDrawPlan(deps({ showGhostEdges: false, hasHighlight: true }));
	ok(!p.drawGhost, "showGhostEdges off → no ghost");
	ok(p.drawBase && p.drawAccent, "base/accent unaffected by ghost toggle");
}

// Accent rides on hasHighlight; base stays on, ghost stays on.
{
	const p = computeEdgeDrawPlan(deps({ hasHighlight: false }));
	ok(!p.drawAccent, "no highlight → no accent");
	ok(p.drawBase && p.drawGhost, "base/ghost independent of highlight");
}
