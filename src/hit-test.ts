import type { PositionedNode, ClusterRect } from "./layout";

// Output of a cursor → scene hit-test. `null` means the cursor is over
// blank canvas (no node, no enclosure). Nodes win over clusters so a
// cluster click never steals a card click.
export type HoverTarget =
	| { kind: "node"; nodeId: string }
	| { kind: "cluster"; group: string }
	// Connection-matrix column header (tag) under the cursor — reuses the same
	// tooltip lifecycle as node/cluster hover, applied to the column band.
	| { kind: "matrixCol"; col: number }
	// Heatmap cell (tag i × tag j) under the cursor — same tooltip lifecycle.
	| { kind: "heatmapCell"; i: number; j: number }
	| null;

// Screen-space coordinates → world coordinates. Inverse of the
// (pan, zoom) transform applied during draw.
export function screenToWorld(
	sx: number,
	sy: number,
	panX: number,
	panY: number,
	zoom: number,
): { x: number; y: number } {
	return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
}

// Cards-first hit-test. Picks the smallest-distance card hit so two
// adjacent cards don't fight over a cursor that sits in the gap; falls
// back to the first cluster whose enclosure contains the point.
//
// `slackPx = 1 / zoom` widens the card AABB by one screen pixel so the
// stroke itself is "inside" the hit area.
export function hitTest(
	wx: number,
	wy: number,
	nodes: PositionedNode[],
	clusters: ClusterRect[],
	zoom: number,
): HoverTarget {
	let bestId: string | null = null;
	let bestDist2 = Infinity;
	const slackPx = 1 / zoom;
	for (const n of nodes) {
		const left = n.x - n.width / 2 - slackPx;
		const right = n.x + n.width / 2 + slackPx;
		const top = n.y - n.height / 2 - slackPx;
		const bottom = n.y + n.height / 2 + slackPx;
		if (wx < left || wx > right || wy < top || wy > bottom) continue;
		const dx = wx - n.x;
		const dy = wy - n.y;
		const d2 = dx * dx + dy * dy;
		if (d2 < bestDist2) {
			bestDist2 = d2;
			bestId = n.id;
		}
	}
	if (bestId) return { kind: "node", nodeId: bestId };
	for (const c of clusters) {
		if (wx >= c.x && wx <= c.x + c.width && wy >= c.y && wy <= c.y + c.height) {
			return { kind: "cluster", group: c.groupKey };
		}
	}
	return null;
}
