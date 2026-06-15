import { GraphEdge } from "../types";

// Card rectangle used by the router. Mirrors the internal Rect in layout
// — kept in a shared module so edge-routing doesn't import from layout
// (and vice versa).
export interface RouteRect {
	x: number; // center
	y: number; // center
	w: number;
	h: number;
}

export interface AggregatedEdge {
	source: string;
	target: string;
	weight: number;
}

// Merge duplicate (src, dst) edges into one record with weight = count.
// Self-loops and edges to nodes outside `idToRect` are skipped. The
// orientation of the FIRST edge wins so the output direction is stable.
export function aggregateEdges(
	edges: GraphEdge[],
	idToRect: Map<string, RouteRect>,
): AggregatedEdge[] {
	const counts = new Map<string, AggregatedEdge>();
	for (const e of edges) {
		if (e.source === e.target) continue;
		if (!idToRect.has(e.source) || !idToRect.has(e.target)) continue;
		const [a, b] =
			e.source < e.target ? [e.source, e.target] : [e.target, e.source];
		const key = a + " " + b;
		const cur = counts.get(key);
		if (cur) cur.weight++;
		else counts.set(key, { source: e.source, target: e.target, weight: 1 });
	}
	return [...counts.values()];
}

// Lane registry — assigns successive integer indices per "gutter"
// bucket so parallel orthogonal wires can fan apart instead of
// overlapping on the same y / x line.
export class LaneRegistry {
	private counters = new Map<string, number>();
	next(key: string): number {
		const c = this.counters.get(key) ?? 0;
		this.counters.set(key, c + 1);
		return c;
	}
}

// Symmetric lane spreader: 0, +1, −1, +2, −2 ... Used to fan parallel
// wires out within a channel without leaving the channel rim.
export function laneShiftSpread(lane: number): number {
	if (lane === 0) return 0;
	return lane % 2 === 1 ? Math.ceil(lane / 2) : -Math.ceil(lane / 2);
}

// Simpler obstacle-free Z-route between two arbitrary points (NOT cards
// — used when re-routing edges through aggregated stack centres). Goes
// vertical channel → horizontal channel → vertical channel, choosing
// channels just outside the endpoint cells.
export function simpleChannelRoute(
	start: { x: number; y: number },
	end: { x: number; y: number },
	slotW: number,
	slotH: number,
): { x: number; y: number }[] {
	if (Math.abs(start.x - end.x) < 0.5 && Math.abs(start.y - end.y) < 0.5) {
		return [start];
	}
	const sCol = Math.floor(start.x / slotW);
	const eCol = Math.floor(end.x / slotW);
	const sRow = Math.floor(start.y / slotH);
	const eRow = Math.floor(end.y / slotH);
	let aSide: number;
	let bSide: number;
	if (eCol > sCol) {
		aSide = (sCol + 1) * slotW;
		bSide = eCol * slotW;
	} else if (eCol < sCol) {
		aSide = sCol * slotW;
		bSide = (eCol + 1) * slotW;
	} else {
		aSide = (sCol + 1) * slotW;
		bSide = (sCol + 1) * slotW;
	}
	const hIdx =
		sRow === eRow
			? sRow + 1
			: Math.round((start.y + end.y) / 2 / slotH);
	const laneY = hIdx * slotH;
	const pts: { x: number; y: number }[] = [];
	const pushPt = (p: { x: number; y: number }) => {
		const last = pts[pts.length - 1];
		if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5)
			return;
		pts.push(p);
	};
	pushPt(start);
	pushPt({ x: aSide, y: start.y });
	pushPt({ x: aSide, y: laneY });
	pushPt({ x: bSide, y: laneY });
	pushPt({ x: bSide, y: end.y });
	pushPt(end);
	return pts;
}

// A positioned card's footprint in cell coordinates. routeZ skips
// obstacles whose id matches `sourceId` / `targetId` so the wire can
// reach its own endpoints.
export interface RouteObstacle {
	id: string;
	startCol: number;
	endCol: number;
	startRow: number;
	endRow: number;
}

// Full-Manhattan channel routing. Every orthogonal segment lies inside a
// channel (= slot boundary): the vertical pieces ride the channel
// adjacent to A and B (so they never traverse card columns), and the
// horizontal piece rides a channel between rows (never crosses card
// rows). Lane offsets within each channel let parallel wires fan apart
// while staying in the channel rim.
export function routeZ(
	a: RouteRect,
	b: RouteRect,
	lanes: LaneRegistry,
	slotW: number,
	slotH: number,
	channelW: number,
	channelH: number,
	obstacles?: RouteObstacle[],
	sourceId?: string,
	targetId?: string,
): { x: number; y: number }[] {
	if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) {
		return [{ x: a.x, y: a.y }];
	}
	// Footprint of A and B — match the cell-snap formula so multi-cell
	// cards (scale > 1) expose the right boundary as exit channel rather
	// than a channel that lies INSIDE the card.
	const colSpanA = Math.max(1, Math.ceil(a.w / slotW));
	const startColA = Math.round(a.x / slotW - colSpanA / 2);
	const endColA = startColA + colSpanA - 1;
	const colSpanB = Math.max(1, Math.ceil(b.w / slotW));
	const startColB = Math.round(b.x / slotW - colSpanB / 2);
	const endColB = startColB + colSpanB - 1;

	// Exit channels sit at the footprint BOUNDARIES of A and B. A → right
	// edge when B is fully to the right (mirror for the other direction).
	// When the column footprints overlap, both endpoints share one
	// vertical channel just to the right of A.
	let aSideCol: number;
	let bSideCol: number;
	if (startColB > endColA) {
		aSideCol = endColA + 1;
		bSideCol = startColB;
	} else if (endColB < startColA) {
		aSideCol = startColA;
		bSideCol = endColB + 1;
	} else {
		aSideCol = endColA + 1;
		bSideCol = aSideCol;
	}

	// Horizontal channel for the middle segment. The wire sits at row
	// boundary hIdx (= y = hIdx * slotH) which is the gap between row
	// hIdx-1 and row hIdx. An obstacle whose vertical span covers BOTH
	// row hIdx-1 and row hIdx (= span "crosses" the boundary) and whose
	// horizontal span overlaps the traversal range would be punched
	// through. Pick the row boundary closest to (a.y + b.y) / 2 that's
	// clear under that obstacle test.
	const midRow = Math.round((a.y + b.y) / 2 / slotH);
	const exempt = new Set<string>();
	if (sourceId) exempt.add(sourceId);
	if (targetId) exempt.add(targetId);
	let colTraverseMin = Math.min(aSideCol, bSideCol);
	let colTraverseMax = Math.max(aSideCol, bSideCol) - 1;
	const isHClear = (h: number): boolean => {
		if (!obstacles || obstacles.length === 0) return true;
		for (const o of obstacles) {
			if (exempt.has(o.id)) continue;
			if (!(o.startRow < h && o.endRow >= h)) continue;
			if (o.endCol < colTraverseMin || o.startCol > colTraverseMax) continue;
			return false;
		}
		return true;
	};
	let hIdx = midRow;
	if (!isHClear(hIdx)) {
		let found = false;
		for (let d = 1; d < 128; d++) {
			if (isHClear(midRow + d)) {
				hIdx = midRow + d;
				found = true;
				break;
			}
			if (isHClear(midRow - d)) {
				hIdx = midRow - d;
				found = true;
				break;
			}
		}
		if (!found) hIdx = midRow;
	}
	// Vertical-segment guards: aLaneX / bLaneX sit on column boundaries.
	// If a multi-cell obstacle straddles that column boundary AND its row
	// span overlaps the vertical traversal range, the vertical leg would
	// pass through it. Shift the column outward until a clear boundary is
	// found.
	const centerRowA = Math.round(a.y / slotH);
	const centerRowB = Math.round(b.y / slotH);
	const isVColClear = (col: number, rFrom: number, rTo: number): boolean => {
		if (!obstacles || obstacles.length === 0) return true;
		const rMin = Math.min(rFrom, rTo);
		const rMax = Math.max(rFrom, rTo);
		for (const o of obstacles) {
			if (exempt.has(o.id)) continue;
			if (!(o.startCol < col && o.endCol >= col)) continue;
			if (o.endRow < rMin || o.startRow > rMax) continue;
			return false;
		}
		return true;
	};
	const adjustVCol = (initial: number, rFrom: number, rTo: number): number => {
		if (isVColClear(initial, rFrom, rTo)) return initial;
		for (let d = 1; d < 64; d++) {
			if (isVColClear(initial + d, rFrom, rTo)) return initial + d;
			if (isVColClear(initial - d, rFrom, rTo)) return initial - d;
		}
		return initial;
	};
	aSideCol = adjustVCol(aSideCol, centerRowA, hIdx - 1);
	bSideCol = adjustVCol(bSideCol, hIdx, centerRowB);
	colTraverseMin = Math.min(aSideCol, bSideCol);
	colTraverseMax = Math.max(aSideCol, bSideCol) - 1;
	if (!isHClear(hIdx)) {
		let found = false;
		for (let d = 1; d < 128; d++) {
			if (isHClear(midRow + d)) {
				hIdx = midRow + d;
				found = true;
				break;
			}
			if (isHClear(midRow - d)) {
				hIdx = midRow - d;
				found = true;
				break;
			}
		}
		if (!found) hIdx = midRow;
	}
	const aSide = aSideCol * slotW;
	const bSide = bSideCol * slotW;

	// Lane offsets inside each channel — always clamped so |offset| stays
	// strictly less than half the channel width / height. Beyond that the
	// wire would leak out of the channel and into an adjacent card cell.
	const hStep = Math.max(0.5, channelH / 12);
	const hMaxShift = Math.max(1, Math.floor((channelH / 2 - 1) / hStep));
	const hLane = lanes.next(`h:${hIdx}`);
	const hShift = Math.max(-hMaxShift, Math.min(hMaxShift, laneShiftSpread(hLane)));
	const laneY = hIdx * slotH + hShift * hStep;

	const vStep = Math.max(0.5, channelW / 12);
	const vMaxShift = Math.max(1, Math.floor((channelW / 2 - 1) / vStep));
	const aIdx = Math.round(aSide / slotW);
	const aLane = lanes.next(`v:${aIdx}`);
	const aShift = Math.max(-vMaxShift, Math.min(vMaxShift, laneShiftSpread(aLane)));
	const aLaneX = aSide + aShift * vStep;

	const bIdx = Math.round(bSide / slotW);
	let bLaneX: number;
	if (aIdx === bIdx) {
		bLaneX = aLaneX;
	} else {
		const bLane = lanes.next(`v:${bIdx}`);
		const bShift = Math.max(
			-vMaxShift,
			Math.min(vMaxShift, laneShiftSpread(bLane)),
		);
		bLaneX = bSide + bShift * vStep;
	}

	const pts: { x: number; y: number }[] = [];
	const pushPt = (p: { x: number; y: number }) => {
		const last = pts[pts.length - 1];
		if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5)
			return;
		pts.push(p);
	};
	pushPt({ x: a.x, y: a.y });
	pushPt({ x: aLaneX, y: a.y });
	pushPt({ x: aLaneX, y: laneY });
	pushPt({ x: bLaneX, y: laneY });
	pushPt({ x: bLaneX, y: b.y });
	pushPt({ x: b.x, y: b.y });
	return pts;
}
