// World-space bounding box of a laid-out figure's cluster enclosures +
// node cards. Clusters are top-left anchored (x/y + width/height); node
// cards are centre-anchored (x/y is the centre, so the card spans
// x ± width/2). Cards are folded in even when no enclosure surrounds them
// (e.g. files that landed in NONE_BUCKET after HAVING dropped their only
// cluster) so the panorama fit never clips a stray card.
//
// Returns null when there is nothing to bound (no clusters AND no nodes,
// or every input is non-finite) — the caller then skips the fit.
export interface ContentBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

interface TopLeftBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

// Node cards share the same {x,y,width,height} shape as clusters but with
// a centre anchor, so the same interface types both.
type CentreBox = TopLeftBox;

export function contentBounds(
	clusters: readonly TopLeftBox[],
	nodes: readonly CentreBox[],
): ContentBounds | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const c of clusters) {
		minX = Math.min(minX, c.x);
		minY = Math.min(minY, c.y);
		maxX = Math.max(maxX, c.x + c.width);
		maxY = Math.max(maxY, c.y + c.height);
	}
	for (const n of nodes) {
		minX = Math.min(minX, n.x - n.width / 2);
		minY = Math.min(minY, n.y - n.height / 2);
		maxX = Math.max(maxX, n.x + n.width / 2);
		maxY = Math.max(maxY, n.y + n.height / 2);
	}
	if (!Number.isFinite(minX)) return null;
	return { minX, minY, maxX, maxY };
}
