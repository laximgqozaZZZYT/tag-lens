// Shared layout post-processing for Euler + UpSet view modes.
//
// Both pipelines reach a point where:
//   1. Cards have been positioned in world space.
//   2. They need to be SNAPPED to the slot lattice so the channels
//      between cells are clean.
//   3. Routing obstacles (per-card cell footprints) + an idToRect
//      map (per-card rect) must be built for `routeZ`.
//   4. `GraphEdge[]` must be aggregated + routed via `routeZ` through
//      the channel lattice with `LaneRegistry` separation.
//
// Euler historically did this inline with extra cluster overlap
// suppression; UpSet did its own subset of the same logic. Both now
// call into `snapAndBuildRouteData` (steps 2–3) and `routeAllEdges`
// (step 4) so the wiring + grid alignment are guaranteed identical.
import type { GraphEdge } from "../types";
import type { PositionedNode, PositionedEdge } from "./layout";
import { snapCardsToGrid } from "./cell-snap";
import {
	LaneRegistry,
	aggregateEdges,
	routeZ,
	type RouteObstacle,
	type RouteRect,
} from "./edge-routing";

export interface SnapAndRouteData {
	idToRect: Map<string, RouteRect>;
	routeObstacles: RouteObstacle[];
}

// Build an `idToRect` map from the current `(x, y, width, height)` of
// each positioned node. Pure read.
export function buildIdToRect(
	positionedNodes: PositionedNode[],
): Map<string, RouteRect> {
	const m = new Map<string, RouteRect>();
	for (const n of positionedNodes) {
		m.set(n.id, { x: n.x, y: n.y, w: n.width, h: n.height });
	}
	return m;
}

// Derive the per-card cell footprint (= `RouteObstacle[]`) used by
// `routeZ` to steer around cards. Each card reserves
// `ceil(w/slotW) × ceil(h/slotH)` cells centred on its current x/y.
export function buildRouteObstacles(
	positionedNodes: PositionedNode[],
	slotW: number,
	slotH: number,
): RouteObstacle[] {
	const out: RouteObstacle[] = [];
	for (const n of positionedNodes) {
		const cs = Math.max(1, Math.ceil(n.width / slotW));
		const rs = Math.max(1, Math.ceil(n.height / slotH));
		const sc = Math.round(n.x / slotW - cs / 2);
		const sr = Math.round(n.y / slotH - rs / 2);
		out.push({
			id: n.id,
			startCol: sc,
			endCol: sc + cs - 1,
			startRow: sr,
			endRow: sr + rs - 1,
		});
	}
	return out;
}

// One-shot pipeline for callers that haven't done the snap themselves
// (= UpSet). Mutates `positionedNodes` via `snapCardsToGrid` then
// returns the routing data derived from the snapped positions.
export function snapAndBuildRouteData(
	positionedNodes: PositionedNode[],
	slotW: number,
	slotH: number,
): SnapAndRouteData {
	const idToRect = buildIdToRect(positionedNodes);
	snapCardsToGrid(positionedNodes, slotW, slotH, idToRect);
	const routeObstacles = buildRouteObstacles(positionedNodes, slotW, slotH);
	return { idToRect, routeObstacles };
}

// Step 4: aggregate + route every edge through the channel lattice.
// Used directly by UpSet (no cluster grouping); Euler uses
// `aggregateEdges` itself for the pair-group / intra-cluster logic
// and only calls `routeOnePair` per surviving edge.
export function routeAllEdges(
	graphEdges: GraphEdge[],
	idToRect: Map<string, RouteRect>,
	routeObstacles: RouteObstacle[],
	slotW: number,
	slotH: number,
	channelW: number,
	channelH: number,
): PositionedEdge[] {
	const aggregated = aggregateEdges(graphEdges, idToRect);
	const lanes = new LaneRegistry();
	const edges: PositionedEdge[] = [];
	for (const e of aggregated) {
		const a = idToRect.get(e.source);
		const b = idToRect.get(e.target);
		if (!a || !b) continue;
		edges.push({
			source: e.source,
			target: e.target,
			weight: e.weight,
			path: routeZ(
				a,
				b,
				lanes,
				slotW,
				slotH,
				channelW,
				channelH,
				routeObstacles,
				e.source,
				e.target,
			),
			bundled: false,
			bundleCount: 1,
		});
	}
	return edges;
}

