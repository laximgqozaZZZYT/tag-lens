// The canvas CSS width available to the figure when computing an initial fit:
// the full client width minus the DOCKED (pinned) note-menu panel, which overlays
// the right edge and reserves `pinnedMenuWidth` pixels (0 when floating/hidden).
// Floored at 1 so a fully-covered or collapsed canvas never yields a ≤0 fit area —
// the `*Fit` builders (latticeFit / contentFit / …) divide by this, and a 0 width
// would produce a NaN/Infinity zoom. DOM-free so the subtract + floor is testable.
export function visibleFitWidth(clientWidth: number, panelWidth: number): number {
	return Math.max(1, clientWidth - panelWidth);
}
