import { ok } from "./assert";
import {
	computeGlobalFallbackPlan,
	type GlobalFallbackPlanDeps,
} from "../src/draw/global-fallback-plan";

// Characterization tests for the pure per-mode gating extracted from
// MiniGraphView.drawGlobalDisplayFallbacks(). They lock which overlay layers and
// meta badges run so the extraction can't silently drift from the original
// inline `if` conditions.

function deps(over: Partial<GlobalFallbackPlanDeps> = {}): GlobalFallbackPlanDeps {
	return {
		mode: "matrix",
		showGrid: true,
		showEnclosures: true,
		showEdges: true,
		showNodes: true,
		showMaturity: true,
		nodeRows: 1,
		nodeCols: 1,
		heatmapJaccard: true,
		...over,
	};
}

// A non-native mode (matrix) with every toggle on → all non-euler-suppressed
// layers/badges run; size stays off (1x1) and jaccard is heatmap-only.
{
	const p = computeGlobalFallbackPlan(deps());
	ok(p.drawGrid && p.drawEnclosures && p.drawEdges, "matrix: grid/encl/edges on");
	ok(p.drawNodesBadge && p.drawMaturityBadge, "matrix: node + maturity badges on");
	ok(!p.drawSizeBadge, "1x1 → no size badge");
	ok(!p.drawJaccardBadge, "non-heatmap → no jaccard badge");
}

// Euler suppresses grid/enclosures/edges/nodes-badge/size (all drawn natively);
// maturity still rides on its own toggle.
{
	const p = computeGlobalFallbackPlan(deps({ mode: "euler", nodeRows: 2 }));
	ok(!p.drawGrid && !p.drawEnclosures && !p.drawEdges, "euler: overlay layers off");
	ok(!p.drawNodesBadge && !p.drawSizeBadge, "euler: node + size badges off");
	ok(p.drawMaturityBadge, "euler: maturity badge unaffected");
}

// Bubblesets is euler-family — same suppression.
{
	const p = computeGlobalFallbackPlan(deps({ mode: "bubblesets" }));
	ok(!p.drawGrid && !p.drawEnclosures && !p.drawEdges && !p.drawNodesBadge, "bubblesets: suppressed");
}

// Droste draws its own grid, so grid is off there even though it's not euler.
{
	const p = computeGlobalFallbackPlan(deps({ mode: "droste" }));
	ok(!p.drawGrid, "droste: no fallback grid");
	ok(p.drawEnclosures && p.drawEdges && p.drawNodesBadge, "droste: other layers on");
}

// UpSet draws nodes natively → no node badge, no size badge; other overlays on.
{
	const p = computeGlobalFallbackPlan(deps({ mode: "upset", nodeRows: 3 }));
	ok(!p.drawNodesBadge && !p.drawSizeBadge, "upset: node + size badges off");
	ok(p.drawGrid && p.drawEnclosures && p.drawEdges, "upset: grid/encl/edges on");
}

// Size badge shows once either dimension leaves 1 (non-euler, non-upset).
{
	ok(computeGlobalFallbackPlan(deps({ nodeCols: 4 })).drawSizeBadge, "1x4 → size badge");
	ok(computeGlobalFallbackPlan(deps({ nodeRows: 2 })).drawSizeBadge, "2x1 → size badge");
}

// Jaccard badge is heatmap-only and rides on the heatmapJaccard toggle.
{
	ok(computeGlobalFallbackPlan(deps({ mode: "heatmap" })).drawJaccardBadge, "heatmap+on → jaccard");
	ok(
		!computeGlobalFallbackPlan(deps({ mode: "heatmap", heatmapJaccard: false })).drawJaccardBadge,
		"heatmap+off → no jaccard",
	);
}

// Each layer rides on its own toggle independently.
{
	const p = computeGlobalFallbackPlan(deps({ showGrid: false, showEdges: false }));
	ok(!p.drawGrid && !p.drawEdges, "toggles off suppress their layer");
	ok(p.drawEnclosures && p.drawNodesBadge, "other layers unaffected");
}
