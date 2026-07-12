import type { AggregationGroup } from "../aggregation/types";
import type { PositionedNode, ClusterRect } from "../layout/layout";

// Output of a cursor → scene hit-test. `null` means the cursor is over
// blank canvas (no node, no enclosure). Nodes win over clusters so a
// cluster click never steals a card click.
export type HoverTarget =
	| { kind: "node"; nodeId: string }
	| { kind: "cluster"; group: string }
	| { kind: "heatmapCell"; i: number; j: number }
	// Node aggregation group
	| { kind: "aggregationGroup"; groupKey: string; nodeIds: string[] }
	// Bridge finder ghost edge under the cursor
	| { kind: "ghostEdge"; bridge: import("../query/bridge-finder").BridgeCandidate }
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

// Hit-test the node aggregation groups (Junihitoe stacks) that win over the
// regular card/cluster hit-test. Each stack occupies roughly one card's
// footprint (`cardW × cardH`, matching drawJunihitoeStack's subW/subH) centred
// on the group position; `slackPx = 1 / zoom` widens the AABB by one screen
// pixel so the stroke itself counts as inside. Returns the first containing
// group in iteration order, or null when the point misses every group.
export function hitTestAggregationGroup(
	wx: number,
	wy: number,
	groups: Iterable<AggregationGroup>,
	cardW: number,
	cardH: number,
	zoom: number,
): Extract<HoverTarget, { kind: "aggregationGroup" }> | null {
	const slackPx = 1 / zoom;
	for (const group of groups) {
		const left = group.x - cardW / 2 - slackPx;
		const right = group.x + cardW / 2 + slackPx;
		const top = group.y - cardH / 2 - slackPx;
		const bottom = group.y + cardH / 2 + slackPx;
		if (wx >= left && wx <= right && wy >= top && wy <= bottom) {
			return { kind: "aggregationGroup", groupKey: group.key, nodeIds: group.nodeIds };
		}
	}
	return null;
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
	ghostEdges?: Array<import("../layout/layout").PositionedEdge & { bridge?: import("../query/bridge-finder").BridgeCandidate }>
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
	
	if (ghostEdges) {
		const edgeSlack = 5 / zoom;
		for (const edge of ghostEdges) {
			if (!edge.bridge) continue;
			const p = edge.path;
			if (!p || p.length < 2) continue;
			for (let i = 0; i < p.length - 1; i++) {
				const x1 = p[i].x, y1 = p[i].y, x2 = p[i + 1].x, y2 = p[i + 1].y;
				// Distance from point to line segment
				const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
				if (l2 === 0) continue;
				let t = ((wx - x1) * (x2 - x1) + (wy - y1) * (y2 - y1)) / l2;
				t = Math.max(0, Math.min(1, t));
				const projX = x1 + t * (x2 - x1);
				const projY = y1 + t * (y2 - y1);
				if ((wx - projX) ** 2 + (wy - projY) ** 2 < edgeSlack * edgeSlack) {
					return { kind: "ghostEdge", bridge: edge.bridge };
				}
			}
		}
	}

	return null;
}

// One clickable cell rect in the Icon Gallery (Droste) hit region, in device
// pixels: the AABB spans [x0,x1]×[y0,y1] and carries the cell's node `id`.
export type DrosteHitRect = { id: string; x0: number; y0: number; x1: number; y1: number };

// Topmost Droste cell under a device-pixel point (dx, dy), or null when the
// point misses every cell. Scans in REVERSE so a rect painted later (drawn on
// top) wins over an earlier one it overlaps — matching the inline scan in
// MiniGraphView.drosteHitTest(). Bounds are inclusive on all four edges.
export function hitDrosteRect(
	dx: number,
	dy: number,
	rects: readonly DrosteHitRect[],
): string | null {
	for (let i = rects.length - 1; i >= 0; i--) {
		const r = rects[i];
		if (dx >= r.x0 && dx <= r.x1 && dy >= r.y0 && dy <= r.y1) return r.id;
	}
	return null;
}
