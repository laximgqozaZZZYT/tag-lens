import { GraphNode, NONE_BUCKET } from "../types";

// Rank info attached to each cluster during layout. Used by the anchor
// placement strategies and the focus / reorder passes.
export interface ClusterRankInfo {
	groupKey: string;
	totalDegree: number;
	memberCount: number;
}

export function rankClustersByDegree(
	clusterKeys: string[],
	nodes: GraphNode[],
	degree: Map<string, number>,
): ClusterRankInfo[] {
	const byKey = new Map<string, { totalDegree: number; memberCount: number }>();
	for (const k of clusterKeys)
		byKey.set(k, { totalDegree: 0, memberCount: 0 });
	for (const n of nodes) {
		const d = degree.get(n.id) ?? 0;
		for (const m of n.memberships) {
			const rec = byKey.get(m);
			if (rec) {
				rec.totalDegree += d;
				rec.memberCount++;
			}
		}
	}
	const ranks: ClusterRankInfo[] = clusterKeys.map((k) => ({
		groupKey: k,
		totalDegree: byKey.get(k)?.totalDegree ?? 0,
		memberCount: byKey.get(k)?.memberCount ?? 0,
	}));
	ranks.sort((a, b) => {
		if (a.groupKey === NONE_BUCKET && b.groupKey !== NONE_BUCKET) return 1;
		if (b.groupKey === NONE_BUCKET && a.groupKey !== NONE_BUCKET) return -1;
		if (b.totalDegree !== a.totalDegree) return b.totalDegree - a.totalDegree;
		return b.memberCount - a.memberCount;
	});
	return ranks;
}

// Pick the "stage" cluster: the one that contains the GLOBAL max-degree
// node. (Per spec: 焦点 = グローバル最大次数ノードの所属クラスタ.)
export function chooseFocusCluster(
	nodes: GraphNode[],
	degree: Map<string, number>,
	ranks: ClusterRankInfo[],
): string {
	if (degree.size === 0) return ranks[0]?.groupKey ?? "";
	let bestId = "";
	let bestDeg = -1;
	for (const [id, d] of degree) {
		if (d > bestDeg) {
			bestDeg = d;
			bestId = id;
		}
	}
	const node = nodes.find((n) => n.id === bestId);
	const primary = node?.memberships[0];
	if (primary && primary !== NONE_BUCKET) return primary;
	return ranks[0]?.groupKey ?? "";
}

// Reorder ranks so that adjacent entries share the maximum number of
// members. The first entry (= focus) is a fixed seed; every subsequent
// entry is the unplaced cluster that shares the most members with any
// cluster already in the new ordering. Result: heavily-overlapping
// groups land at adjacent lattice positions, so a multi-tag sub-group's
// centroid sits in a short inter-anchor span instead of stretching the
// parent enclosures.
export function reorderBySharing(
	ranks: ClusterRankInfo[],
	nodes: GraphNode[],
): void {
	if (ranks.length <= 2) return;
	const members = new Map<string, Set<string>>();
	for (const r of ranks) members.set(r.groupKey, new Set());
	for (const n of nodes) {
		for (const m of n.memberships) {
			const s = members.get(m);
			if (s) s.add(n.id);
		}
	}
	const sharedCount = (a: string, b: string): number => {
		const A = members.get(a);
		const B = members.get(b);
		if (!A || !B) return 0;
		const [small, large] = A.size <= B.size ? [A, B] : [B, A];
		let n = 0;
		for (const id of small) if (large.has(id)) n++;
		return n;
	};
	const reordered: ClusterRankInfo[] = [];
	const remaining = new Set(ranks.map((r) => r.groupKey));
	reordered.push(ranks[0]);
	remaining.delete(ranks[0].groupKey);
	const placedKeys: string[] = [ranks[0].groupKey];
	while (remaining.size > 0) {
		let best: ClusterRankInfo | null = null;
		let bestScore = -1;
		for (const r of ranks) {
			if (!remaining.has(r.groupKey)) continue;
			let score = 0;
			for (const placed of placedKeys)
				score += sharedCount(r.groupKey, placed);
			if (score > bestScore) {
				bestScore = score;
				best = r;
			}
		}
		if (!best) {
			for (const r of ranks) {
				if (remaining.has(r.groupKey)) {
					best = r;
					break;
				}
			}
		}
		if (!best) break;
		reordered.push(best);
		remaining.delete(best.groupKey);
		placedKeys.push(best.groupKey);
	}
	ranks.length = 0;
	for (const r of reordered) ranks.push(r);
}

export function moveToFront(ranks: ClusterRankInfo[], key: string): void {
	const idx = ranks.findIndex((r) => r.groupKey === key);
	if (idx <= 0) return;
	const [r] = ranks.splice(idx, 1);
	ranks.unshift(r);
}

// Concentric: focus at (0,0), then expanding square rings (8, 16, 24 ...
// cells). Within each ring, fill clockwise starting from the top.
export function placeAnchorsConcentric(
	anchors: Map<string, { x: number; y: number }>,
	ranks: ClusterRankInfo[],
	strideX: number,
	strideY: number,
): void {
	if (ranks.length === 0) return;
	anchors.set(ranks[0].groupKey, { x: 0, y: 0 });
	const cells: { x: number; y: number }[] = [];
	for (let r = 1; cells.length < ranks.length - 1 && r <= 32; r++) {
		for (let dx = -r; dx <= r; dx++)
			cells.push({ x: dx * strideX, y: -r * strideY });
		for (let dy = -r + 1; dy <= r; dy++)
			cells.push({ x: r * strideX, y: dy * strideY });
		for (let dx = r - 1; dx >= -r; dx--)
			cells.push({ x: dx * strideX, y: r * strideY });
		for (let dy = r - 1; dy >= -r + 1; dy--)
			cells.push({ x: -r * strideX, y: dy * strideY });
	}
	for (let i = 1; i < ranks.length && i - 1 < cells.length; i++) {
		anchors.set(ranks[i].groupKey, cells[i - 1]);
	}
}

// Flow: focus at top-left, columns growing rightward. Within each
// column, ranks descend (rank 1 directly below focus). Column height ≈
// sqrt(N).
export function placeAnchorsFlow(
	anchors: Map<string, { x: number; y: number }>,
	ranks: ClusterRankInfo[],
	strideX: number,
	strideY: number,
): void {
	if (ranks.length === 0) return;
	const total = ranks.length;
	const colHeight = Math.max(1, Math.ceil(Math.sqrt(total)));
	for (let i = 0; i < total; i++) {
		const col = Math.floor(i / colHeight);
		const row = i % colHeight;
		anchors.set(ranks[i].groupKey, { x: col * strideX, y: row * strideY });
	}
}

// Deterministic radial offset from a sub-group's membership signature.
// The angle is derived from an FNV-1a hash so different membership sets
// are pushed in different directions even when their grid centroid
// coincides.
export function subgroupHashOffset(
	key: string,
	magnitude: number,
): { x: number; y: number } {
	if (magnitude <= 0) return { x: 0, y: 0 };
	let h = 2166136261;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	const t = ((h >>> 0) / 0xffffffff) * Math.PI * 2;
	return { x: Math.cos(t) * magnitude, y: Math.sin(t) * magnitude };
}

// Unweighted centroid: average of the anchors of the supplied
// memberships. Kept for callers that don't have access to cluster
// sizes (e.g. simple test rigs).
export function centroidOf(
	memberships: string[],
	anchors: Map<string, { x: number; y: number }>,
): { x: number; y: number } {
	let x = 0,
		y = 0,
		n = 0;
	for (const m of memberships) {
		const a = anchors.get(m);
		if (!a) continue;
		x += a.x;
		y += a.y;
		n++;
	}
	if (n === 0) return { x: 0, y: 0 };
	return { x: x / n, y: y / n };
}

// Cluster-size-weighted centroid. Each anchor contributes proportional
// to `weights.get(membership)` (= cluster's total member count). Larger
// clusters "pull harder", so a multi-tag sub-group is placed CLOSER
// to its larger cluster's anchor than to its smaller cluster's anchor.
//
// Bug-fix anchor: in an Euler diagram with one large cluster X (say
// 30 members) and one small cluster Y (say 5 members) sharing several
// multi-tag nodes, the unweighted centroid places those shared nodes
// equidistant from both anchors. That STRETCHES cluster X's bbox out
// toward Y by ~50% of the inter-anchor distance, and most of the cells
// in that stretch belong to Y (Bug #3) — and X's members appear
// abnormally spread (Bug #1). Weighting by size puts the shared
// nodes ~85% toward X, keeping X tight at the cost of a mild
// extension of Y's bbox INTO X — which is the natural Euler-diagram
// reading (the smaller set lives inside the larger one's territory).
//
// Memberships not present in `weights` default to 1 so callers can
// pass partial maps without worrying about coverage.
// Pairwise sharing weights for force-directed refinement.
// Returns "a|b" (lex-sorted) → count of shared members between cluster a and b.
export function computeClusterSharingCounts(
	nodes: { memberships: string[] }[],
): Map<string, number> {
	const out = new Map<string, number>();
	for (const n of nodes) {
		const ms = [...n.memberships].sort();
		for (let i = 0; i < ms.length; i++) {
			for (let j = i + 1; j < ms.length; j++) {
				const k = `${ms[i]}|${ms[j]}`;
				out.set(k, (out.get(k) ?? 0) + 1);
			}
		}
	}
	return out;
}

// Global compactness refinement (Bug B fix): pulls every anchor toward
// the centroid of all anchors AND toward each sharing-pair partner,
// while a hard-shell repulsion keeps non-overlapping clusters at least
// `minStride` apart. Used AFTER concentric/flow placement to fix the
// "exclusive clusters sit far from the shared core" complaint.
//
// Iteration runs a small number of force-balance steps (default 25).
// Pull strength is bounded so the rank-induced ordering survives.
export function tightenAnchors(
	anchors: Map<string, { x: number; y: number }>,
	sharing: Map<string, number>,
	minStrideX: number,
	minStrideY: number,
	iters: number = 25,
): void {
	const keys = [...anchors.keys()];
	if (keys.length < 2) return;
	const centerPullRate = 0.04;
	const sharePullRate = 0.02;
	const maxSharePull = Math.max(minStrideX, minStrideY);

	for (let iter = 0; iter < iters; iter++) {
		// 1. Compute centroid.
		let cx = 0,
			cy = 0;
		for (const k of keys) {
			const a = anchors.get(k)!;
			cx += a.x;
			cy += a.y;
		}
		cx /= keys.length;
		cy /= keys.length;

		// 2. Apply attraction forces (center pull + sharing pull) to a copy.
		const next = new Map<string, { x: number; y: number }>();
		for (const k of keys) {
			const a = anchors.get(k)!;
			let fx = (cx - a.x) * centerPullRate;
			let fy = (cy - a.y) * centerPullRate;
			next.set(k, { x: a.x + fx, y: a.y + fy });
		}
		// Sharing pull (pairwise).
		for (const [pairKey, count] of sharing) {
			const [ka, kb] = pairKey.split("|");
			const na = next.get(ka);
			const nb = next.get(kb);
			if (!na || !nb) continue;
			const dx = nb.x - na.x;
			const dy = nb.y - na.y;
			const dist = Math.hypot(dx, dy);
			if (dist < 1) continue;
			const pull = Math.min(maxSharePull, count * sharePullRate * dist);
			na.x += (dx / dist) * pull;
			na.y += (dy / dist) * pull;
			nb.x -= (dx / dist) * pull;
			nb.y -= (dy / dist) * pull;
		}

		// 3. Repulsion: enforce minStride between every pair (axis-wise).
		for (let i = 0; i < keys.length; i++) {
			for (let j = i + 1; j < keys.length; j++) {
				const na = next.get(keys[i])!;
				const nb = next.get(keys[j])!;
				const dx = nb.x - na.x;
				const dy = nb.y - na.y;
				const adx = Math.abs(dx);
				const ady = Math.abs(dy);
				if (adx >= minStrideX || ady >= minStrideY) continue;
				// Inside the no-go zone — push apart along the SHORTER overlap axis.
				const ovX = minStrideX - adx;
				const ovY = minStrideY - ady;
				if (ovX < ovY) {
					const sgn = dx >= 0 ? 1 : -1;
					na.x -= (sgn * ovX) / 2;
					nb.x += (sgn * ovX) / 2;
				} else {
					const sgn = dy >= 0 ? 1 : -1;
					na.y -= (sgn * ovY) / 2;
					nb.y += (sgn * ovY) / 2;
				}
			}
		}

		// 4. Write back.
		for (const k of keys) {
			const n = next.get(k)!;
			const a = anchors.get(k)!;
			a.x = n.x;
			a.y = n.y;
		}
	}
}

export function weightedCentroidByClusterSize(
	memberships: string[],
	anchors: Map<string, { x: number; y: number }>,
	weights: Map<string, number>,
): { x: number; y: number } {
	let x = 0,
		y = 0,
		totalW = 0;
	for (const m of memberships) {
		const a = anchors.get(m);
		if (!a) continue;
		const w = Math.max(1, weights.get(m) ?? 1);
		x += a.x * w;
		y += a.y * w;
		totalW += w;
	}
	if (totalW === 0) return { x: 0, y: 0 };
	return { x: x / totalW, y: y / totalW };
}
