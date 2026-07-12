// "Locate on canvas" transform for a navigator-row / menu click that centres a
// single positioned node in the viewport. Unlike the initial-fit builders
// (`contentFit`/`latticeFit`/…) this is a *pan-to* rather than a *frame*: it
// keeps the current zoom (only zooming IN to a readable floor, never zooming
// out from a closer view the user already has) and pans so the node's world
// centre lands at the canvas centre.
//
// Pure sibling of `drosteFit` (both centre one target); the view keeps the
// zoom/pan assignment + highlight machinery.

export interface LocateFit {
	zoom: number;
	panX: number;
	panY: number;
}

export function locateNodeFit(
	node: { x: number; y: number },
	cw: number,
	ch: number,
	currentZoom: number,
	minZoom = 0.6,
): LocateFit {
	// Zoom in enough to read the card, but never zoom out from the current
	// view if it's already closer.
	const zoom = Math.max(currentZoom, minZoom);
	return {
		zoom,
		panX: cw / 2 - node.x * zoom,
		panY: ch / 2 - node.y * zoom,
	};
}
