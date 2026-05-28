import type { GraphNode } from "./types";

// Build per-cluster parent set. A cluster P is the "parent" of cluster
// C when (a) inheritFrom[C] === P, or (b) P's member set strictly
// contains C's member set. Parents are excluded from the aggregation
// check (per the user's spec): the child's aggregation already accounts
// for the parent's containment, so listing the parent in a node's
// memberships shouldn't block the child from being considered fully
// aggregated.
export function computeParentOf(
	clusterKeys: Iterable<string>,
	nodes: { id: string; memberships: string[] }[],
	inheritFrom: Record<string, string>,
): Map<string, Set<string>> {
	const memberSets = new Map<string, Set<string>>();
	for (const key of clusterKeys) {
		const s = new Set<string>();
		for (const n of nodes) if (n.memberships.includes(key)) s.add(n.id);
		memberSets.set(key, s);
	}
	const parentOf = new Map<string, Set<string>>();
	for (const [key, mems] of memberSets) {
		const parents = new Set<string>();
		const inhSource = inheritFrom[key];
		if (inhSource && inhSource !== key) parents.add(inhSource);
		for (const [otherKey, otherMems] of memberSets) {
			if (otherKey === key) continue;
			if (otherMems.size <= mems.size) continue; // strict superset only
			let isSuper = true;
			for (const m of mems) {
				if (!otherMems.has(m)) {
					isSuper = false;
					break;
				}
			}
			if (isSuper) parents.add(otherKey);
		}
		parentOf.set(key, parents);
	}
	return parentOf;
}

// A node is "truly aggregated" when every EFFECTIVE membership (= every
// membership that isn't a parent of another membership the node also
// holds) is in aggSet. This is the single source of truth used by both
// the aggregate-snap spiral and the draw-layer skipNode test.
export function computeTrulyAgg(
	nodes: GraphNode[],
	aggSet: Set<string>,
	parentOf: Map<string, Set<string>>,
): Set<string> {
	const trulyAgg = new Set<string>();
	for (const n of nodes) {
		if (n.memberships.length === 0) continue;
		let allEffectiveAgg = true;
		let hasEffective = false;
		for (const m of n.memberships) {
			let isParentOfOther = false;
			for (const o of n.memberships) {
				if (o === m) continue;
				const oParents = parentOf.get(o);
				if (oParents && oParents.has(m)) {
					isParentOfOther = true;
					break;
				}
			}
			if (isParentOfOther) continue;
			hasEffective = true;
			if (!aggSet.has(m)) {
				allEffectiveAgg = false;
				break;
			}
		}
		if (hasEffective && allEffectiveAgg) trulyAgg.add(n.id);
	}
	return trulyAgg;
}

// Card AABB used by the badge-snap "hit any card" test.
export interface CardAABB {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

// Footprint cell range used by the badge-snap "occupied" reservation.
export interface FootprintCells {
	startCol: number;
	endCol: number;
	startRow: number;
	endRow: number;
}

export function nodeFootprint(
	n: { x: number; y: number; width: number; height: number },
	slotW: number,
	slotH: number,
): FootprintCells {
	const colSpan = Math.max(1, Math.ceil(n.width / slotW));
	const rowSpan = Math.max(1, Math.ceil(n.height / slotH));
	const startCol = Math.round(n.x / slotW - colSpan / 2);
	const startRow = Math.round(n.y / slotH - rowSpan / 2);
	return {
		startCol,
		endCol: startCol + colSpan - 1,
		startRow,
		endRow: startRow + rowSpan - 1,
	};
}

// Build AABB rectangles for every visible card (= not aggregated and not
// hidden). Used as the badge-snap "hit any card" geometric check, in
// addition to the cell-occupied set.
export function buildCardAABBs(
	nodes: { id: string; x: number; y: number; width: number; height: number }[],
	exclude: (id: string) => boolean,
): CardAABB[] {
	const out: CardAABB[] = [];
	for (const n of nodes) {
		if (exclude(n.id)) continue;
		out.push({
			left: n.x - n.width / 2,
			right: n.x + n.width / 2,
			top: n.y - n.height / 2,
			bottom: n.y + n.height / 2,
		});
	}
	return out;
}

// True when the centre of cell (col, row) — converted to world space via
// the slotW / slotH lattice — falls inside any of the supplied card
// AABBs. Used STRICTLY (open intervals) so a cell touching a card edge
// is treated as free.
export function cellHitsAnyCard(
	col: number,
	row: number,
	cardAABBs: CardAABB[],
	slotW: number,
	slotH: number,
): boolean {
	const cx = (col + 0.5) * slotW;
	const cy = (row + 0.5) * slotH;
	for (const r of cardAABBs) {
		if (cx > r.left && cx < r.right && cy > r.top && cy < r.bottom) return true;
	}
	return false;
}

// Chebyshev-radius spiral search for a cell that satisfies !isBlocked.
// Starts at (col, row); if already free returns it. Expands radius by 1
// each iteration until maxRadius (default 128). Returns the first free
// cell found, or { found: false, ... } if the spiral exhausts.
export function findFreeCell(
	col: number,
	row: number,
	isBlocked: (c: number, r: number) => boolean,
	maxRadius: number = 128,
): { col: number; row: number; found: boolean } {
	if (!isBlocked(col, row)) return { col, row, found: true };
	for (let radius = 1; radius < maxRadius; radius++) {
		for (let dc = -radius; dc <= radius; dc++) {
			for (let dr = -radius; dr <= radius; dr++) {
				if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
				const cc = col + dc;
				const rr = row + dr;
				if (!isBlocked(cc, rr)) return { col: cc, row: rr, found: true };
			}
		}
	}
	return { col, row, found: false };
}
