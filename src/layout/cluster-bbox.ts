import type { PositionedNode, ClusterRect } from "./layout";
import { isSubset } from "./subgroup-packing";
import { nodeFootprint } from "./aggregate-util";

export interface ClusterBBoxOptions {
	clusterKeys: string[];
	labels: Map<string, string>;
	slotW: number;
	slotH: number;
	channelW: number;
	channelH: number;
	clusterSpacing: number;
}

// Per-cluster member id set. Used both by the nesting-depth detector
// (= an outer cluster contains every member of its inner cluster) and
// by the bbox loop. Exposed so callers can re-use it without scanning
// positionedNodes twice.
export function computeMemberSetsForClusters(
	positionedNodes: PositionedNode[],
	clusterKeys: string[],
): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	for (const key of clusterKeys) {
		const set = new Set<string>();
		for (const n of positionedNodes) {
			if (n.memberships.includes(key)) set.add(n.id);
		}
		out.set(key, set);
	}
	return out;
}

// Nesting depth = # of clusters whose member set is a STRICT subset of
// this cluster's member set. A higher depth ⇒ this cluster engulfs more
// inner layers, so it deserves extra padding so the inner enclosures
// sit clearly inside its border instead of riding it.
export function computeNestingDepth(
	memberSets: Map<string, Set<string>>,
	clusterKeys: string[],
): Map<string, number> {
	const out = new Map<string, number>();
	for (const x of clusterKeys) {
		const xs = memberSets.get(x)!;
		let depth = 0;
		for (const y of clusterKeys) {
			if (x === y) continue;
			const ys = memberSets.get(y)!;
			if (ys.size < xs.size && isSubset(ys, xs)) depth++;
		}
		out.set(x, depth);
	}
	return out;
}

// Footprint-aware bbox for a single cluster. Loops over every member
// card's full N × M footprint cells (= ceil(w/slotW) × ceil(h/slotH))
// and returns the min/max cell range — null when the cluster has no
// members in positionedNodes.
//
// Bug-fix anchor: this is the function bug #3 ("unrelated nodes in
// groups") routes through. A multi-tag node positioned at the centroid
// between two anchors lands in a cell that BOTH clusters' bboxes will
// engulf, even though only one of those clusters genuinely "owns" the
// card. The fix lives in subgroup placement, NOT here — but isolating
// this loop made the diagnosis obvious.
export function computeClusterCellRange(
	key: string,
	positionedNodes: PositionedNode[],
	slotW: number,
	slotH: number,
): {
	minCol: number;
	maxCol: number;
	minRow: number;
	maxRow: number;
	count: number;
} | null {
	let minCol = Infinity;
	let maxCol = -Infinity;
	let minRow = Infinity;
	let maxRow = -Infinity;
	let count = 0;
	for (const n of positionedNodes) {
		if (!n.memberships.includes(key)) continue;
		count++;
		const fp = nodeFootprint(n, slotW, slotH);
		if (fp.startCol < minCol) minCol = fp.startCol;
		if (fp.endCol > maxCol) maxCol = fp.endCol;
		if (fp.startRow < minRow) minRow = fp.startRow;
		if (fp.endRow > maxRow) maxRow = fp.endRow;
	}
	if (count === 0) return null;
	return { minCol, maxCol, minRow, maxRow, count };
}

// Wrap a cell range + per-side cell padding into the final pixel-space
// ClusterRect. Enclosure edges ride the channels between slots so the
// outer cells reserved for column A / row 1 stay visually empty.
export function cellRangeToClusterRect(
	groupKey: string,
	label: string,
	range: { minCol: number; maxCol: number; minRow: number; maxRow: number },
	padCellsX: number,
	padCellsY: number,
	slotW: number,
	slotH: number,
	memberCount: number,
): ClusterRect {
	const left = (range.minCol - padCellsX) * slotW;
	const right = (range.maxCol + 1 + padCellsX) * slotW;
	const top = (range.minRow - padCellsY) * slotH;
	const bottom = (range.maxRow + 1 + padCellsY) * slotH;
	return {
		groupKey,
		label,
		x: left,
		y: top,
		width: right - left,
		height: bottom - top,
		memberCount,
	};
}

// Cells with at least one card (= cells that any cluster claims).
// Used to distinguish "empty" cells (= no card) from "occupied" cells
// when computing additional carve candidates for inter-cluster
// disambiguation.
export function computeAllOccupiedCells(
	positionedNodes: PositionedNode[],
	slotW: number,
	slotH: number,
): Set<string> {
	const out = new Set<string>();
	for (const n of positionedNodes) {
		const fp = nodeFootprint(n, slotW, slotH);
		for (let c = fp.startCol; c <= fp.endCol; c++) {
			for (let r = fp.startRow; r <= fp.endRow; r++) {
				out.add(`${c},${r}`);
			}
		}
	}
	return out;
}

// Empty cells inside the cluster's AABB that fall ALSO inside some
// OTHER cluster's AABB. These cells have no card at all, so they
// aren't "foreign-only" in the existing sense, but they visually
// "belong" to whichever other cluster's enclosure also claims them.
// Carving them out of this cluster's polygon prevents two unrelated
// clusters' enclosures from visually owning the same blank space.
//
// Implementation: O(rangeCellCount × |otherClusters|). Acceptable for
// typical vaults (≤ 20 clusters × ≤ 200 cells per AABB).
export function computeEmptyCellsInOtherClusterAABBs(
	currentKey: string,
	currentOwned: Set<string>,
	currentRange: { minCol: number; maxCol: number; minRow: number; maxRow: number },
	otherRanges: Map<
		string,
		{ minCol: number; maxCol: number; minRow: number; maxRow: number }
	>,
	allOccupiedCells: Set<string>,
): Set<string> {
	const out = new Set<string>();
	for (let c = currentRange.minCol; c <= currentRange.maxCol; c++) {
		for (let r = currentRange.minRow; r <= currentRange.maxRow; r++) {
			const k = `${c},${r}`;
			if (currentOwned.has(k)) continue; // we have own card
			if (allOccupiedCells.has(k)) continue; // has SOME card (handled elsewhere)
			// Empty cell. Carve if some other cluster's AABB covers it.
			for (const [otherKey, otherRange] of otherRanges) {
				if (otherKey === currentKey) continue;
				if (c < otherRange.minCol || c > otherRange.maxCol) continue;
				if (r < otherRange.minRow || r > otherRange.maxRow) continue;
				out.add(k);
				break;
			}
		}
	}
	return out;
}

// Foreign-only cells for a cluster: cells inside the cluster's AABB
// that have at least one card from ANOTHER cluster but NO card from
// this cluster. These are the cells we want to carve out of the AABB
// so the cluster's enclosure doesn't visually "contain" non-members.
export function computeForeignOnlyCellsInRange(
	positionedNodes: PositionedNode[],
	ownedCells: Set<string>,
	clusterKey: string,
	slotW: number,
	slotH: number,
	range: { minCol: number; maxCol: number; minRow: number; maxRow: number },
): Set<string> {
	const out = new Set<string>();
	for (const n of positionedNodes) {
		if (n.memberships.includes(clusterKey)) continue; // own card
		const fp = nodeFootprint(n, slotW, slotH);
		for (let c = fp.startCol; c <= fp.endCol; c++) {
			if (c < range.minCol || c > range.maxCol) continue;
			for (let r = fp.startRow; r <= fp.endRow; r++) {
				if (r < range.minRow || r > range.maxRow) continue;
				const k = `${c},${r}`;
				if (ownedCells.has(k)) continue; // shared cell, not foreign-only
				out.add(k);
			}
		}
	}
	return out;
}

// Carve foreign-only cells from the AABB cell set, but ONLY those that
// are reachable from the AABB boundary via other foreign-only cells.
// Interior foreign-only cells (= surrounded on all sides by polygon
// cells) stay in the polygon, so the result has NO internal holes;
// only the boundary acquires L-shaped / hook-shaped concavities
// (= the "カギ状の n 角" the user explicitly allowed for foreign
// exclusion).
export function carveFromBoundary(
	aabbCells: Set<string>,
	foreignOnly: Set<string>,
	range: { minCol: number; maxCol: number; minRow: number; maxRow: number },
): Set<string> {
	const carved = new Set<string>(aabbCells);
	const queue: [number, number][] = [];
	const trySeed = (c: number, r: number): void => {
		const k = `${c},${r}`;
		if (!foreignOnly.has(k)) return;
		if (!carved.has(k)) return;
		carved.delete(k);
		queue.push([c, r]);
	};
	// Seed: AABB boundary cells that are foreign-only.
	for (let c = range.minCol; c <= range.maxCol; c++) {
		trySeed(c, range.minRow);
		trySeed(c, range.maxRow);
	}
	for (let r = range.minRow; r <= range.maxRow; r++) {
		trySeed(range.minCol, r);
		trySeed(range.maxCol, r);
	}
	// Propagate: a foreign-only cell adjacent to an already-carved cell
	// can also be carved (still reachable from outside).
	while (queue.length > 0) {
		const [c, r] = queue.shift()!;
		for (const [dc, dr] of [
			[-1, 0],
			[1, 0],
			[0, -1],
			[0, 1],
		]) {
			const nc = c + dc;
			const nr = r + dr;
			if (nc < range.minCol || nc > range.maxCol) continue;
			if (nr < range.minRow || nr > range.maxRow) continue;
			const nk = `${nc},${nr}`;
			if (!foreignOnly.has(nk)) continue;
			if (!carved.has(nk)) continue;
			carved.delete(nk);
			queue.push([nc, nr]);
		}
	}
	return carved;
}

// Per-cluster owned-cell map. A cell is "owned by cluster X" iff at
// least one card whose memberships include X has a footprint cell at
// that grid position. A multi-membership card (e.g. {A, B}) contributes
// to BOTH A's and B's owned sets, so their outlines naturally overlap
// on that cell — exactly the Euler-diagram intersection.
export function computeClusterOwnedCells(
	positionedNodes: PositionedNode[],
	clusterKeys: string[],
	slotW: number,
	slotH: number,
): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	for (const key of clusterKeys) out.set(key, new Set());
	for (const n of positionedNodes) {
		const fp = nodeFootprint(n, slotW, slotH);
		for (const m of n.memberships) {
			const set = out.get(m);
			if (!set) continue;
			for (let c = fp.startCol; c <= fp.endCol; c++) {
				for (let r = fp.startRow; r <= fp.endRow; r++) {
					set.add(`${c},${r}`);
				}
			}
		}
	}
	return out;
}

// Compute outline segments for the polygon boundary of a cell set.
// For each cell, check its 4 neighbours; if a neighbour is NOT in
// the set, emit a line on the shared edge.
//
// Coordinate convention matches drawCardGrid (cell inner box from
// (col*W + padX, row*H + padY) to ((col+1)*W - padX, (row+1)*H - padY)).
export function computeOutlineSegments(
	cells: Set<string>,
	slotW: number,
	slotH: number,
	channelW: number,
	channelH: number,
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
	const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
	const padX = channelW / 2;
	const padY = channelH / 2;
	for (const cellKey of cells) {
		const [colStr, rowStr] = cellKey.split(",");
		const col = parseInt(colStr, 10);
		const row = parseInt(rowStr, 10);
		const left = col * slotW + padX;
		const right = (col + 1) * slotW - padX;
		const top = row * slotH + padY;
		const bottom = (row + 1) * slotH - padY;
		if (!cells.has(`${col - 1},${row}`))
			segments.push({ x1: left, y1: top, x2: left, y2: bottom });
		if (!cells.has(`${col + 1},${row}`))
			segments.push({ x1: right, y1: top, x2: right, y2: bottom });
		if (!cells.has(`${col},${row - 1}`))
			segments.push({ x1: left, y1: top, x2: right, y2: top });
		if (!cells.has(`${col},${row + 1}`))
			segments.push({ x1: left, y1: bottom, x2: right, y2: bottom });
	}
	return segments;
}

// Find 4-connected components of a cell set. Returns one Set per
// component (each holds "col,row" keys).
function connectedComponents(cells: Set<string>): Set<string>[] {
	const components: Set<string>[] = [];
	const visited = new Set<string>();
	for (const start of cells) {
		if (visited.has(start)) continue;
		const comp = new Set<string>();
		const queue: string[] = [start];
		visited.add(start);
		while (queue.length > 0) {
			const cur = queue.shift()!;
			comp.add(cur);
			const [c, r] = cur.split(",").map(Number);
			for (const [dc, dr] of [
				[-1, 0],
				[1, 0],
				[0, -1],
				[0, 1],
			]) {
				const k = `${c + dc},${r + dr}`;
				if (cells.has(k) && !visited.has(k)) {
					visited.add(k);
					queue.push(k);
				}
			}
		}
		components.push(comp);
	}
	return components;
}

// Fill all interior holes (= non-cell positions inside the AABB that
// are NOT reachable from the AABB boundary without crossing cells).
// After filling, the result has no internal holes.
function fillInteriorHoles(
	cells: Set<string>,
	range: { minCol: number; maxCol: number; minRow: number; maxRow: number },
): Set<string> {
	// Flood-fill from a virtual one-cell ring around the AABB so any
	// concavity touching the bbox boundary is reachable from "outside".
	const reachable = new Set<string>();
	const queue: [number, number][] = [];
	const seed = (c: number, r: number): void => {
		const k = `${c},${r}`;
		if (cells.has(k) || reachable.has(k)) return;
		reachable.add(k);
		queue.push([c, r]);
	};
	for (let c = range.minCol - 1; c <= range.maxCol + 1; c++) {
		seed(c, range.minRow - 1);
		seed(c, range.maxRow + 1);
	}
	for (let r = range.minRow - 1; r <= range.maxRow + 1; r++) {
		seed(range.minCol - 1, r);
		seed(range.maxCol + 1, r);
	}
	while (queue.length > 0) {
		const [c, r] = queue.shift()!;
		for (const [dc, dr] of [
			[-1, 0],
			[1, 0],
			[0, -1],
			[0, 1],
		]) {
			const nc = c + dc;
			const nr = r + dr;
			if (nc < range.minCol - 1 || nc > range.maxCol + 1) continue;
			if (nr < range.minRow - 1 || nr > range.maxRow + 1) continue;
			const k = `${nc},${nr}`;
			if (cells.has(k) || reachable.has(k)) continue;
			reachable.add(k);
			queue.push([nc, nr]);
		}
	}
	// Any non-cell in the AABB that's NOT reachable = interior hole.
	const closed = new Set<string>(cells);
	for (let c = range.minCol; c <= range.maxCol; c++) {
		for (let r = range.minRow; r <= range.maxRow; r++) {
			const k = `${c},${r}`;
			if (cells.has(k)) continue;
			if (reachable.has(k)) continue;
			closed.add(k);
		}
	}
	return closed;
}

// Enumerate all cells along an L-shaped Manhattan path from (c1,r1) to
// (c2,r2). When hFirst=true: move horizontally to c2 first, then
// vertically to r2. When hFirst=false: move vertically to r2 first, then
// horizontally to c2.
function lPathCells(
	c1: number,
	r1: number,
	c2: number,
	r2: number,
	hFirst: boolean,
): string[] {
	const dc = c2 > c1 ? 1 : c2 < c1 ? -1 : 0;
	const dr = r2 > r1 ? 1 : r2 < r1 ? -1 : 0;
	const result: string[] = [];
	let cc = c1;
	let cr = r1;
	result.push(`${cc},${cr}`);
	if (hFirst) {
		while (cc !== c2) {
			cc += dc;
			result.push(`${cc},${cr}`);
		}
		while (cr !== r2) {
			cr += dr;
			result.push(`${cc},${cr}`);
		}
	} else {
		while (cr !== r2) {
			cr += dr;
			result.push(`${cc},${cr}`);
		}
		while (cc !== c2) {
			cc += dc;
			result.push(`${cc},${cr}`);
		}
	}
	return result;
}

// BFS shortest path between two cell sets, hard-avoiding avoidCells.
// Search space is bounded to a rectangle padded `pad` cells beyond the
// bounding box of start+end cells so we can route around obstacles
// without an unbounded search. Returns null if no path exists within
// the bounded search space.
function bfsPath(
	startSet: Set<string>,
	endSet: Set<string>,
	avoidCells: Set<string>,
	pad: number,
): string[] | null {
	// Determine bounding box of start + end cells.
	let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
	for (const k of startSet) {
		const [c, r] = k.split(",").map(Number);
		if (c < minC) minC = c; if (c > maxC) maxC = c;
		if (r < minR) minR = r; if (r > maxR) maxR = r;
	}
	for (const k of endSet) {
		const [c, r] = k.split(",").map(Number);
		if (c < minC) minC = c; if (c > maxC) maxC = c;
		if (r < minR) minR = r; if (r > maxR) maxR = r;
	}
	minC -= pad; maxC += pad; minR -= pad; maxR += pad;

	// BFS from all start cells simultaneously (multi-source).
	const prev = new Map<string, string | null>();
	const queue: string[] = [];
	for (const k of startSet) {
		if (avoidCells.has(k)) continue;
		prev.set(k, null);
		queue.push(k);
	}
	let found = "";
	outer: while (queue.length > 0) {
		const cur = queue.shift()!;
		const [c, r] = cur.split(",").map(Number);
		for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
			const nc = c + dc, nr = r + dr;
			if (nc < minC || nc > maxC || nr < minR || nr > maxR) continue;
			const nk = `${nc},${nr}`;
			if (avoidCells.has(nk)) continue;
			if (prev.has(nk)) continue;
			prev.set(nk, cur);
			if (endSet.has(nk)) { found = nk; break outer; }
			queue.push(nk);
		}
	}
	if (!found) return null;
	// Reconstruct path.
	const path: string[] = [];
	let cur: string | null = found;
	while (cur !== null) {
		path.push(cur);
		cur = prev.get(cur) ?? null;
		if (cur !== null && startSet.has(cur)) { path.push(cur); break; }
	}
	return path;
}

// Connect disconnected components using a greedy minimum-spanning-tree
// approach: maintain a "connected" super-component (initially the largest
// component) and repeatedly attach the nearest unconnected component to
// ANY cell already in the super-component.
//
// Bridge strategy (two-phase):
//   Phase 1: BFS that HARD-AVOIDS avoidCells (foreign nodes). Routes
//            around obstacles through empty space. This keeps V1 = 0.
//   Phase 2 (fallback): Only fires when no foreign-free BFS path exists.
//            If the isolated component has no mustKeep cells, drop it
//            entirely (avoids adding bridge cells through enemy territory).
//            If it has mustKeep cells, fall back to L-path soft-avoid to
//            ensure V3 = 0 (own-cell must be enclosed). V2 = 0 is also
//            preserved because the main component always retains all
//            mustKeep cells reachable from it.
//
// avoidCells: set of cell keys that contain foreign-cluster nodes.
// mustKeep: cells that MUST be in the final polygon (own cells). A
//           component with no mustKeep cells is silently dropped when
//           Phase 1 BFS fails, instead of bridging through foreign
//           territory. This eliminates V1 violations for those cases.
function bridgeComponents(
	cells: Set<string>,
	avoidCells: Set<string> = new Set(),
	mustKeep: Set<string> = new Set(),
): Set<string> {
	const comps = connectedComponents(cells);
	if (comps.length <= 1) return cells;
	comps.sort((a, b) => b.size - a.size);
	const out = new Set<string>(cells);
	// connected = union of all already-connected cells (starts as comps[0]).
	const connected = new Set<string>(comps[0]);
	// remaining = components still to attach.
	const remaining = comps.slice(1);

	while (remaining.length > 0) {
		let bridged = false;

		// Phase 1: try BFS foreign-free path for each remaining component.
		let bestPhase1Idx = -1;
		let bestPhase1Path: string[] = [];
		let bestPhase1Len = Infinity;

		for (let ri = 0; ri < remaining.length; ri++) {
			const path = bfsPath(remaining[ri], connected, avoidCells, 8);
			if (path && path.length < bestPhase1Len) {
				bestPhase1Len = path.length;
				bestPhase1Idx = ri;
				bestPhase1Path = path;
			}
		}

		if (bestPhase1Idx >= 0) {
			for (const k of bestPhase1Path) { out.add(k); connected.add(k); }
			for (const k of remaining[bestPhase1Idx]) connected.add(k);
			remaining.splice(bestPhase1Idx, 1);
			bridged = true;
		}

		if (!bridged) {
			// Phase 2 fallback: no foreign-free path found for any component.
			// Drop components that have no mustKeep cells (just neutral/empty
			// cells that don't need to stay in the polygon). For components
			// with mustKeep cells, use L-path soft-avoid to enforce V3 = 0.
			let mustKeepIdx = -1;
			for (let ri = 0; ri < remaining.length; ri++) {
				const hasOwn = [...remaining[ri]].some((k) => mustKeep.has(k));
				if (hasOwn) { mustKeepIdx = ri; break; }
			}

			if (mustKeepIdx < 0) {
				// All remaining components are neutral-only — drop them.
				for (let ri = remaining.length - 1; ri >= 0; ri--) {
					for (const k of remaining[ri]) out.delete(k);
					remaining.splice(ri, 1);
				}
				break;
			}

			// L-path fallback for the must-keep component only.
			let bestD = Infinity;
			let bestAvoid = Infinity;
			let bestPath: string[] = [];

			const comp = remaining[mustKeepIdx];
			for (const a of comp) {
				const [ac, ar] = a.split(",").map(Number);
				for (const b of connected) {
					const [bc, br] = b.split(",").map(Number);
					const d = Math.abs(ac - bc) + Math.abs(ar - br);
					const hPath = lPathCells(ac, ar, bc, br, true);
					const vPath = lPathCells(ac, ar, bc, br, false);
					const hAvoid = hPath.filter((k) => avoidCells.has(k)).length;
					const vAvoid = vPath.filter((k) => avoidCells.has(k)).length;
					const minAvoid = Math.min(hAvoid, vAvoid);
					const chosenPath = vAvoid < hAvoid ? vPath : hPath;
					if (minAvoid < bestAvoid || (minAvoid === bestAvoid && d < bestD)) {
						bestAvoid = minAvoid;
						bestD = d;
						bestPath = chosenPath;
					}
				}
			}
			for (const k of bestPath) { out.add(k); connected.add(k); }
			for (const k of remaining[mustKeepIdx]) connected.add(k);
			remaining.splice(mustKeepIdx, 1);
		}
	}
	return out;
}


// Remove foreign cells from a polygon that are not essential for
// connectivity between owned cells.
//
// Algorithm:
//   1. Build the sub-polygon of non-foreign cells. Find its connected
//      components (two owned cells are in the same component iff there
//      is a non-foreign path between them).
//   2. Partition components into "main" (largest with ≥1 owned cell) and
//      "minor" (all others).
//   3. Drop minor components that have NO owned cells entirely.
//   4. For each minor component WITH owned cells:
//      Phase A: BFS hard-avoiding foreign cells. If a foreign-free path
//               exists, use it (V1 stays 0 for this bridge).
//      Phase B: no foreign-free path exists (component is topologically
//               isolated). Use L-path with minimum foreign crossing to
//               bridge to the main result (V2 stays 0, V1 gets minimum
//               possible violations).
//   5. Return the union of: main component + minor-comp owned cells +
//      bridge cells. All other foreign cells (interior fillers) are
//      dropped.
//
// This eliminates V1 violations from interior foreign-filler cells
// while preserving essential foreign bridges for V2 = 0 and V3 = 0.
/*
function pruneUnnecessaryForeignCells(
	cells: Set<string>,
	foreignCells: Set<string>,
	ownedCells: Set<string>,
): Set<string> {
	if (foreignCells.size === 0) return cells;

	// Step 1: Build sub-polygon of non-foreign cells.
	const nonForeign = new Set<string>();
	for (const k of cells) {
		if (!foreignCells.has(k)) nonForeign.add(k);
	}

	// Step 2: Connected components of the non-foreign sub-polygon.
	const visited = new Set<string>();
	const components: Set<string>[] = [];
	for (const start of nonForeign) {
		if (visited.has(start)) continue;
		const comp = new Set<string>();
		const q: string[] = [start];
		visited.add(start);
		while (q.length > 0) {
			const cur = q.shift()!;
			comp.add(cur);
			const [c, r] = cur.split(",").map(Number);
			for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
				const nk = `${c + dc},${r + dr}`;
				if (nonForeign.has(nk) && !visited.has(nk)) {
					visited.add(nk);
					q.push(nk);
				}
			}
		}
		components.push(comp);
	}

	if (components.length <= 1) {
		// Already connected without foreign cells — return nonForeign directly.
		return nonForeign;
	}

	// Step 3: Find the main component (largest with ≥1 owned cell).
	// If no component has owned cells, just use the largest.
	let mainIdx = 0;
	let mainScore = -Infinity;
	for (let i = 0; i < components.length; i++) {
		const ownedCount = [...components[i]].filter((k) => ownedCells.has(k)).length;
		const score = ownedCount * 100000 + components[i].size;
		if (score > mainScore) {
			mainScore = score;
			mainIdx = i;
		}
	}
	const mainComp = components[mainIdx];

	// Step 4: For each minor component with owned cells, bridge to result.
	const result = new Set<string>(mainComp);

	// Precompute bounding box of owned cells for bfsPath pad.
	let oMinC = Infinity, oMaxC = -Infinity, oMinR = Infinity, oMaxR = -Infinity;
	for (const k of ownedCells) {
		const [c, r] = k.split(",").map(Number);
		if (c < oMinC) oMinC = c; if (c > oMaxC) oMaxC = c;
		if (r < oMinR) oMinR = r; if (r > oMaxR) oMaxR = r;
	}
	const bfsPad = Math.max(20, Math.ceil((oMaxC - oMinC + oMaxR - oMinR) / 2));

	for (let i = 0; i < components.length; i++) {
		if (i === mainIdx) continue;
		const comp = components[i];
		const hasOwned = [...comp].some((k) => ownedCells.has(k));
		if (!hasOwned) continue; // drop this component entirely

		// Phase A: foreign-free BFS path (V1 stays 0 for this bridge).
		const freePath = bfsPath(comp, result, foreignCells, bfsPad);
		if (freePath) {
			for (const k of freePath) result.add(k);
			for (const k of comp) result.add(k);
			continue;
		}

		// Phase B: no foreign-free path exists. Component is topologically
		// isolated (all non-foreign routes are blocked by foreign nodes).
		// Use Dijkstra-like min-foreign-crossing BFS (0-cost for non-foreign
		// cells, 1-cost for foreign cells) to find the path that crosses the
		// fewest possible foreign cells. V2 = 0 is maintained. V1 violations
		// are limited to the minimum bridge cells required.
		const phaseBPath = minForeignPath(comp, result, foreignCells, bfsPad);
		if (phaseBPath.length > 0) {
			for (const k of phaseBPath) result.add(k);
		}
		for (const k of comp) result.add(k);
	}

	return result;
}
*/

// Close a cell set into a single simply-connected rectilinear region:
// fill interior holes + bridge disconnected components. The resulting
// outline (via computeOutlineSegments) is a single closed loop with no
// inner loops — satisfies "no exclaves, no holes, polygon allowed".
export function closeToSimplyConnected(
	cells: Set<string>,
	range: { minCol: number; maxCol: number; minRow: number; maxRow: number },
): Set<string> {
	if (cells.size === 0) return cells;
	const bridged = bridgeComponents(cells);
	// Recompute range after bridging in case bridges extended it
	// (they shouldn't since bridge endpoints are within original cells'
	// AABB, but the line might pass through cells just inside).
	const filled = fillInteriorHoles(bridged, range);
	return filled;
}

// Foreign-free maximal rectangle starting at (startCol, startRow).
// Grows right first to find max width without crossing a foreign cell,
// then down keeping the same width. Bounded by (maxBoundCol,
// maxBoundRow) so we don't extend past the cluster's AABB.
//
// `foreignCells` = cells holding at least one card from another
// cluster the current cluster's members don't share. ANY foreign cell
// in the candidate rectangle aborts further growth in that direction.
// Result: rectangle containing the seed cell (which is always owned),
// possibly some empty cells, and NO foreign cells.
export function maxForeignFreeRect(
	startCol: number,
	startRow: number,
	foreignCells: Set<string>,
	maxBoundCol: number,
	maxBoundRow: number,
): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
	let width = 1;
	while (startCol + width <= maxBoundCol) {
		if (foreignCells.has(`${startCol + width},${startRow}`)) break;
		width++;
	}
	let height = 1;
	outer: while (startRow + height <= maxBoundRow) {
		for (let c = startCol; c < startCol + width; c++) {
			if (foreignCells.has(`${c},${startRow + height}`)) break outer;
		}
		height++;
	}
	return {
		minCol: startCol,
		maxCol: startCol + width - 1,
		minRow: startRow,
		maxRow: startRow + height - 1,
	};
}

// Decompose a cluster's owned cells into a set of axis-aligned
// RECTANGLES that together cover every own cell AND contain no
// foreign cell. Multiple rectangles per cluster (= 離れ島 / exclaves)
// are produced when own cells are spread out with foreign cells in
// between.
//
// Algorithm: greedy. Iterate own cells in row-major order; for each
// uncovered own cell, find the maximal foreign-free rectangle starting
// at that cell (right then down) and mark every cell it covers
// (including absorbed empty cells) as covered. Continue until every
// own cell is in some rectangle.
//
// Properties (= the new user spec, 2026-05-24):
//   - V1 zero: no rectangle contains a foreign cell, so no foreign
//     node sits inside the union of this cluster's rectangles.
//   - V3 zero: every own cell starts a rectangle if not covered, so
//     every own cell is in at least one rectangle.
//   - Exclaves: permitted (= "離れ島は許容する"). The union may have
//     multiple disjoint pieces.
//   - 可能な限り四辺形: each piece IS an axis-aligned rectangle.
export function decomposeIntoForeignFreeRects(
	ownedCells: Set<string>,
	foreignCells: Set<string>,
	range: { minCol: number; maxCol: number; minRow: number; maxRow: number },
): Array<{ minCol: number; maxCol: number; minRow: number; maxRow: number }> {
	const covered = new Set<string>();
	const rects: Array<{
		minCol: number;
		maxCol: number;
		minRow: number;
		maxRow: number;
	}> = [];
	const sorted = [...ownedCells].sort((a, b) => {
		const [ac, ar] = a.split(",").map(Number);
		const [bc, br] = b.split(",").map(Number);
		return ar - br || ac - bc;
	});
	for (const cell of sorted) {
		if (covered.has(cell)) continue;
		const [sc, sr] = cell.split(",").map(Number);
		const r = maxForeignFreeRect(
			sc,
			sr,
			foreignCells,
			range.maxCol,
			range.maxRow,
		);
		for (let c = r.minCol; c <= r.maxCol; c++) {
			for (let row = r.minRow; row <= r.maxRow; row++) {
				covered.add(`${c},${row}`);
			}
		}
		rects.push(r);
	}
	return rects;
}

// (Re-export already defined above. This banner just precedes the
// orchestrator that consumes these helpers.)

// Orchestrator: produces one ClusterRect per cluster.
//
// ──── Contract (User spec update, 2026-05-24): ─────────────────────
// For every cluster c in the returned `clusters` array:
//   (a) c.pieces (= the cluster's enclosure rectangles) COVER every
//       owned cell of the cluster.
//   (b) NO piece contains a cell with a foreign card (= a card
//       whose memberships don't include this cluster's key).
//   (c) Pieces ARE allowed to be exclaves (= the cluster's enclosure
//       may be the union of multiple disjoint rectangles).
//   (d) Empty cells inside pieces are permitted (= no foreign node
//       there → no V1 violation).
// Enforced by scripts/random-layout-verify.mjs.
// ────────────────────────────────────────────────────────────────────
export function computeClusterBBoxes(
	positionedNodes: PositionedNode[],
	opts: ClusterBBoxOptions,
): {
	clusters: ClusterRect[];
	memberSets: Map<string, Set<string>>;
	nestingDepth: Map<string, number>;
} {
	const { clusterKeys, labels, slotW, slotH, channelW, channelH } = opts;
	const memberSets = computeMemberSetsForClusters(positionedNodes, clusterKeys);
	const nestingDepth = computeNestingDepth(memberSets, clusterKeys);

	const BASE_PAD = Math.max(24, opts.clusterSpacing / 2);
	const NEST_PAD = 18;
	const basePadCellsX = Math.max(0, Math.ceil((BASE_PAD - channelW / 2) / slotW));
	const basePadCellsY = Math.max(0, Math.ceil((BASE_PAD - channelH / 2) / slotH));
	const nestPadCellsX = Math.max(1, Math.ceil(NEST_PAD / slotW));
	const nestPadCellsY = Math.max(1, Math.ceil(NEST_PAD / slotH));
	const ownedCellsMap = computeClusterOwnedCells(
		positionedNodes,
		clusterKeys,
		slotW,
		slotH,
	);
	// Pre-pass: every cluster's AABB cell range. Used downstream so
	// each cluster knows which OTHER cluster's AABB it might overlap
	// (= candidates for empty-cell carving via the new rule).
	const rangeMap = new Map<
		string,
		{
			minCol: number;
			maxCol: number;
			minRow: number;
			maxRow: number;
			count: number;
		}
	>();
	for (const k of clusterKeys) {
		const r = computeClusterCellRange(k, positionedNodes, slotW, slotH);
		if (r) rangeMap.set(k, r);
	}
	// All cells that hold at least one card (= occupied). Used by the
	// empty-cell carving rule: empty cells inside the cluster's AABB that
	// also fall inside another cluster's AABB become carve candidates.
	// const allOccupied = computeAllOccupiedCells(positionedNodes, slotW, slotH);

	// Main-group assignment per node. Each node's "main" is the cluster
	// (among its memberships) with the largest total member count;
	// ties broken alphabetically. This drives the main-enclosure /
	// sub-enclosure split below.
	const clusterMemberCount = new Map<string, number>();
	for (const n of positionedNodes) {
		for (const m of n.memberships) {
			clusterMemberCount.set(m, (clusterMemberCount.get(m) ?? 0) + 1);
		}
	}
	const mainOf = new Map<string, string>();
	for (const n of positionedNodes) {
		if (n.memberships.length === 0) continue;
		let bestKey = n.memberships[0];
		let bestSize = clusterMemberCount.get(bestKey) ?? 0;
		for (let i = 1; i < n.memberships.length; i++) {
			const m = n.memberships[i];
			const s = clusterMemberCount.get(m) ?? 0;
			if (s > bestSize || (s === bestSize && m < bestKey)) {
				bestKey = m;
				bestSize = s;
			}
		}
		mainOf.set(n.id, bestKey);
	}

	const clusters: ClusterRect[] = [];
	for (const key of clusterKeys) {
		const range = rangeMap.get(key);
		if (!range) continue;
		const nest = nestingDepth.get(key) ?? 0;
		const padCellsX = basePadCellsX + nest * nestPadCellsX;
		const padCellsY = basePadCellsY + nest * nestPadCellsY;
		const rect = cellRangeToClusterRect(
			key,
			labels.get(key) ?? key,
			range,
			padCellsX,
			padCellsY,
			slotW,
			slotH,
			range.count,
		);
		const owned = ownedCellsMap.get(key);
		if (owned && owned.size > 0) {
			// User spec (2026-05-24, revised AGAIN, late):
			//   - each node has a MAIN group (largest cluster the node
			//     belongs to; ties broken alphabetically)
			//   - cluster X's main enclosure = AABB of nodes with main=X
			//   - for each other cluster Y whose main-nodes also include
			//     X in their memberships, add a sub enclosure = AABB of
			//     those nodes (= they sit inside Y's main rect; X also
			//     wants to claim them)
			// Result: multiple rectangles per cluster permitted. The
			// SAME rectangle can be a piece of multiple clusters (=
			// rectangle for sig {A, B} appears in both A's and B's
			// pieces lists, drawn twice with different colours).
			const mainCells = new Set<string>();
			const extrasByMain = new Map<string, Set<string>>();
			for (const n of positionedNodes) {
				if (!n.memberships.includes(key)) continue;
				const nodeMain = mainOf.get(n.id);
				if (!nodeMain) continue;
				let target: Set<string>;
				if (nodeMain === key) {
					target = mainCells;
				} else {
					let s = extrasByMain.get(nodeMain);
					if (!s) {
						s = new Set();
						extrasByMain.set(nodeMain, s);
					}
					target = s;
				}
				const fp = nodeFootprint(n, slotW, slotH);
				for (let c = fp.startCol; c <= fp.endCol; c++) {
					for (let r = fp.startRow; r <= fp.endRow; r++) {
						target.add(`${c},${r}`);
					}
				}
			}
			// Enclosure edges ride the channel centre-lines for MAIN pieces
			// (= slot grid lines `col * slotW` / `row * slotH`). Per spec
			// (2026-05-26): "囲いについては必ず隘路の中心線を通る
			// ようにしてください".
			//
			// SUB pieces (= 外局) are pulled inward by a small inset so
			// that, when several sub rects (or a sub rect and its parent
			// main rect) share a grid line, their outlines don't collapse
			// into one indistinguishable border. Per user spec
			// (2026-05-26, refined): use the channel QUARTER-line — i.e.
			// half-way between the main centre-line and the card edge —
			// so the sub border has clear breathing room on both sides
			// (won't fuse with the main centre-line, won't rub against
			// the card stroke).
			const subInsetX = channelW / 4;
			const subInsetY = channelH / 4;
			const aabbFromCells = (
				cells: Set<string>,
				inset: number,
				insetY: number,
			): { x: number; y: number; w: number; h: number } => {
				let minC = Infinity,
					maxC = -Infinity,
					minR = Infinity,
					maxR = -Infinity;
				for (const k of cells) {
					const [c, r] = k.split(",").map(Number);
					if (c < minC) minC = c;
					if (c > maxC) maxC = c;
					if (r < minR) minR = r;
					if (r > maxR) maxR = r;
				}
				return {
					x: minC * slotW + inset,
					y: minR * slotH + insetY,
					w: (maxC - minC + 1) * slotW - 2 * inset,
					h: (maxR - minR + 1) * slotH - 2 * insetY,
				};
			};
			const pieces: Array<{ x: number; y: number; w: number; h: number; kind: "main" | "sub" }> = [];
			if (mainCells.size > 0) {
				pieces.push({ ...aabbFromCells(mainCells, 0, 0), kind: "main" });
			}
			for (const cells of extrasByMain.values()) {
				if (cells.size === 0) continue;
				const r = aabbFromCells(cells, subInsetX, subInsetY);
				// Skip degenerate sub rects (single cell whose inset
				// would consume the whole width/height). Falling back to
				// the un-inset version would defeat the visual separation
				// the user asked for, so we just drop the piece — the
				// cluster's other pieces still represent it.
				if (r.w <= 0 || r.h <= 0) continue;
				pieces.push({ ...r, kind: "sub" });
			}
			if (pieces.length > 0) {
				rect.pieces = pieces;
				let l = Infinity,
					t = Infinity,
					r2 = -Infinity,
					b = -Infinity;
				for (const p of pieces) {
					if (p.x < l) l = p.x;
					if (p.y < t) t = p.y;
					if (p.x + p.w > r2) r2 = p.x + p.w;
					if (p.y + p.h > b) b = p.y + p.h;
				}
				rect.x = l;
				rect.y = t;
				rect.width = r2 - l;
				rect.height = b - t;
			}
		}
		clusters.push(rect);
	}
	return { clusters, memberSets, nestingDepth };
}

// Clamp every cluster's left/top to the CHANNEL between column A and
// column B (resp. row 1 and row 2). Column A and row 1 stay completely
// empty — no enclosure border may enter them.
export function clampClustersToB2(
	clusters: ClusterRect[],
	positionedNodes: PositionedNode[],
	slotW: number,
	slotH: number,
): void {
	if (positionedNodes.length === 0 || clusters.length === 0) return;
	let globalMinCol = Infinity;
	let globalMinRow = Infinity;
	for (const n of positionedNodes) {
		const fp = nodeFootprint(n, slotW, slotH);
		if (fp.startCol < globalMinCol) globalMinCol = fp.startCol;
		if (fp.startRow < globalMinRow) globalMinRow = fp.startRow;
	}
	const gridLeft = globalMinCol * slotW;
	const gridTop = globalMinRow * slotH;
	for (const c of clusters) {
		if (c.x < gridLeft) {
			c.width = Math.max(slotW, c.width - (gridLeft - c.x));
			c.x = gridLeft;
		}
		if (c.y < gridTop) {
			c.height = Math.max(slotH, c.height - (gridTop - c.y));
			c.y = gridTop;
		}
	}
}

// Inheritance: each child cluster picks a parent (継承元) explicitly via
// the panel. The child's bbox grows to engulf the parent's bbox so the
// parent visually "joins" the child territory. Pre-snapshot the
// original bboxes so a chain (A → B → C) all references its pre-merge
// sibling, never the already-expanded version.
export function expandClustersByInheritance(
	clusters: ClusterRect[],
	inheritFrom: Record<string, string>,
): void {
	const inhKeys = Object.keys(inheritFrom);
	if (inhKeys.length === 0) return;
	const original = new Map<
		string,
		{ x: number; y: number; w: number; h: number }
	>();
	for (const c of clusters) {
		original.set(c.groupKey, { x: c.x, y: c.y, w: c.width, h: c.height });
	}
	for (const child of clusters) {
		const parentKey = inheritFrom[child.groupKey];
		if (!parentKey || parentKey === child.groupKey) continue;
		const p = original.get(parentKey);
		if (!p) continue;
		const minX = Math.min(child.x, p.x);
		const minY = Math.min(child.y, p.y);
		const maxX = Math.max(child.x + child.width, p.x + p.w);
		const maxY = Math.max(child.y + child.height, p.y + p.h);
		child.x = minX;
		child.y = minY;
		child.width = maxX - minX;
		child.height = maxY - minY;
	}
}
