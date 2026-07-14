// Pure descriptors for the meta indicator badges stacked on the left edge of the
// global "display fallback" overlay (Maturity / Size / Jaccard), extracted
// verbatim from MiniGraphView.drawGlobalDisplayFallbacks() so the label/colour
// mapping + stacking order live in one testable place (same pattern as
// computeGlobalFallbackPlan / graphDisplayToggles). The view still owns the
// actual ctx drawing (the drawBadge fillRect/fillText loop); this only decides
// which badges appear, in what order, with what label + colour.
export interface MetaBadge {
	label: string;
	color: string;
}

// The three per-badge gates, sourced straight from a GlobalFallbackPlan (a
// structural subset so the caller passes `plan` unchanged).
export interface MetaBadgeGates {
	drawMaturityBadge: boolean;
	drawSizeBadge: boolean;
	drawJaccardBadge: boolean;
}

export function metaBadges(gates: MetaBadgeGates, nodeRows: number, nodeCols: number): MetaBadge[] {
	const badges: MetaBadge[] = [];
	if (gates.drawMaturityBadge) badges.push({ label: "Maturity: ON", color: "rgba(0, 150, 0, 0.8)" });
	// Node size fallback badge for modes that don't scale cards natively.
	if (gates.drawSizeBadge) {
		badges.push({ label: `Size: ${nodeRows}x${nodeCols}`, color: "rgba(50, 150, 200, 0.8)" });
	}
	if (gates.drawJaccardBadge) badges.push({ label: "Jaccard: ON", color: "rgba(100, 100, 100, 0.8)" });
	return badges;
}
