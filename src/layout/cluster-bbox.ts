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
	bubble?: boolean;
}

// Per-cluster member id set. Used both by the nesting-depth detector
// (= an outer cluster contains every member of its inner cluster) and
// by the bbox loop. Exposed so callers can re-use it without scanning
// positionedNodes twice.
function computeMemberSetsForClusters(
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
function computeNestingDepth(
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
			if (ys.size < xs.size && isSubset(ys, xs)) {
				depth++;
			} else if (ys.size === xs.size && isSubset(ys, xs)) {
				if (x < y) depth++;
			}
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
function computeClusterCellRange(
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
function cellRangeToClusterRect(
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

// Per-cluster owned-cell map. A cell is "owned by cluster X" iff at
// least one card whose memberships include X has a footprint cell at
// that grid position. A multi-membership card (e.g. {A, B}) contributes
// to BOTH A's and B's owned sets, so their outlines naturally overlap
// on that cell — exactly the Euler-diagram intersection.
function computeClusterOwnedCells(
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
	for (let i = 0; i < clusterKeys.length; i++) {
		const key = clusterKeys[i];
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
			// Enforce strict grid alignment unconditionally. The iterative 
			// collision resolver below will push overlapping edges outward by full cells.
			const mainInsetX = 0;
			const mainInsetY = 0;
			const subInsetX = 0;
			const subInsetY = 0;

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
				pieces.push({ ...aabbFromCells(mainCells, mainInsetX, mainInsetY), kind: "main" });
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

	// Edge Collision Resolution (方眼に必ず添え、重なった辺は一マス外側へ)
	// Iteratively push overlapping collinear edges outward, regardless of parent/child.
	let moved = true;
	let iterations = 0;
	while (moved && iterations++ < 50) {
		moved = false;
		const allPieces = clusters.flatMap((c) => c.pieces ?? []);
		for (let i = 0; i < allPieces.length; i++) {
			for (let j = i + 1; j < allPieces.length; j++) {
				const a = allPieces[i];
				const b = allPieces[j];
				const areaA = a.w * a.h;
				const areaB = b.w * b.h;
				// Expand the larger box to create a concentric wrapping effect
				const target = areaA > areaB ? a : b;

				// Left vs Left
				if (a.x === b.x && Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h)) {
					target.x -= slotW;
					target.w += slotW;
					moved = true;
				}
				// Right vs Right
				if (a.x + a.w === b.x + b.w && Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h)) {
					target.w += slotW;
					moved = true;
				}
				// Top vs Top
				if (a.y === b.y && Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w)) {
					target.y -= slotH;
					target.h += slotH;
					moved = true;
				}
				// Bottom vs Bottom
				if (a.y + a.h === b.y + b.h && Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w)) {
					target.h += slotH;
					moved = true;
				}
			}
		}
	}

	// Update cluster bounding boxes to reflect expanded pieces
	for (const c of clusters) {
		if (!c.pieces) continue;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const p of c.pieces) {
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.x + p.w > maxX) maxX = p.x + p.w;
			if (p.y + p.h > maxY) maxY = p.y + p.h;
		}
		if (minX <= maxX) {
			c.x = minX;
			c.y = minY;
			c.width = maxX - minX;
			c.height = maxY - minY;
		}
	}

	return { clusters, memberSets, nestingDepth };
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
