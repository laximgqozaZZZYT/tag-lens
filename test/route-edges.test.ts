// routeEdges(edges, idToRect, lanes, …) — the batch router extracted from the
// two byte-identical edges/ghostEdges loops in view.ts's applyEulerLayout. Locks
// the contract: valid endpoints → a multi-point path; a missing endpoint leaves
// the edge's existing path untouched; coincident endpoints fall back to a straight
// 2-point [a, b] segment (never a single point); edges are mutated in place.
import { ok } from "./assert";
import { LaneRegistry, type RouteObstacle, type RouteRect } from "../src/layout/edge-routing";
import { routeEdges } from "../src/layout/layout-shared";

const idToRect = new Map<string, RouteRect>([
	["a", { x: 0, y: 0, w: 20, h: 20 }],
	["b", { x: 200, y: 200, w: 20, h: 20 }],
	["c", { x: 0, y: 0, w: 20, h: 20 }], // coincident with a
]);
const slotW = 40, slotH = 40, channelW = 10, channelH = 10;
const obstacles: RouteObstacle[] = [];
const fresh = () => new LaneRegistry();

// Valid distinct endpoints → a routed multi-point path.
const e1 = { source: "a", target: "b", path: [] as { x: number; y: number }[] };
routeEdges([e1], idToRect, fresh(), slotW, slotH, channelW, channelH, obstacles);
ok(e1.path.length >= 2, "valid edge → multi-point path");

// Missing endpoint → the edge is skipped, its existing path left untouched.
const sentinel = [{ x: -1, y: -1 }];
const e2 = { source: "a", target: "missing", path: sentinel };
routeEdges([e2], idToRect, fresh(), slotW, slotH, channelW, channelH, obstacles);
ok(e2.path === sentinel, "missing endpoint → path untouched (same reference)");

// Coincident endpoints → straight 2-point [a, b] fallback, never a single point.
const e3 = { source: "a", target: "c", path: [] as { x: number; y: number }[] };
routeEdges([e3], idToRect, fresh(), slotW, slotH, channelW, channelH, obstacles);
ok(e3.path.length === 2, "coincident endpoints → 2-point fallback");
ok(
	e3.path[0].x === 0 && e3.path[0].y === 0 && e3.path[1].x === 0 && e3.path[1].y === 0,
	"fallback segment is [a, b]",
);

// Edges are mutated in place (same object references survive the batch).
const e4 = { source: "a", target: "b", path: [] as { x: number; y: number }[] };
const batch = [e4];
routeEdges(batch, idToRect, fresh(), slotW, slotH, channelW, channelH, obstacles);
ok(batch[0] === e4 && e4.path.length >= 2, "edges mutated in place");

// A shared LaneRegistry threaded across two batches routes both (no throw); real
// edges then ghost edges must fan through the same registry.
const shared = fresh();
const real = { source: "a", target: "b", path: [] as { x: number; y: number }[] };
const ghost = { source: "a", target: "b", path: [] as { x: number; y: number }[] };
routeEdges([real], idToRect, shared, slotW, slotH, channelW, channelH, obstacles);
routeEdges([ghost], idToRect, shared, slotW, slotH, channelW, channelH, obstacles);
ok(real.path.length >= 2 && ghost.path.length >= 2, "shared lanes route both batches");
