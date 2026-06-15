// Region layout: Phase A-F の orchestrator。仕様書 docs/region-layout-spec.md 参照。
//
// 入力: ノード一覧 (sized) + base set 一覧 + アグリゲート / inheritFrom 情報。
// 出力: base set ごとの矩形 (x, y, w, h) と、Phase A で確定したゾーン情報。
//       ノード配置 (Phase G) は呼び出し側 (layout.ts) で行う。

import type { GraphNode } from "../types";
import type { SizedNode } from "./layout";
import {
	type Zone,
	NONE_BUCKET_KEY,
	applyAggregatePreprocessing,
	ensureNoneBucket,
	decomposeZones,
	computeBaseSetCounts,
	computeMustOverlapPairs,
} from "./zone-decomp";
import {
	detectHellyForcedZones,
	materialiseHellyForcedZones,
} from "./helly-detect";
import {
	type Interval,
	type TopologyConstraints,
	solve1D,
	computeZoneExtents,
} from "./qp-1d";

export interface RegionRect {
	setKey: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface RegionLayoutOptions {
	cardW: number;
	cardH: number;
	gapPx: number; // ガター
	padPx: number; // 集合矩形内側パディング (各辺)
	rhoFill: number; // 充填率 ρ
	emptyZoneTargetMode: "minimal" | "visible";
	maxOuterIter: number;
	maxInnerIter: number;
	innerTol: number;
	outerTol: number;
	lambdaTopo: number;
	gradStep0: number;
	gradMaxStep: number;
	seedShuffleTries: number;
	// inheritFrom: child → parent (= nesting 要)
	inheritFrom: Record<string, string>;
	// 各基底集合 1 軸の最小長 (= 少なくとも 1 セル分は確保する)
	minIntervalLen: number;
}

const DEFAULTS: RegionLayoutOptions = {
	cardW: 120,
	cardH: 32,
	gapPx: 8,
	padPx: 12,
	rhoFill: 0.72,
	emptyZoneTargetMode: "minimal",
	maxOuterIter: 5,
	maxInnerIter: 50,
	innerTol: 1e-3,
	outerTol: 5e-2,
	lambdaTopo: 1000,
	gradStep0: 0.5,
	gradMaxStep: 100,
	seedShuffleTries: 3,
	inheritFrom: {},
	minIntervalLen: 128, // ≈ 1 slot worth, overridden by caller
};

export interface RegionLayoutResult {
	setRects: Map<string, RegionRect>;
	zones: Zone[];
	hasNoneBucket: boolean;
	aggregatePreservedCounts: Map<string, number>;
	mustOverlapPairs: Set<string>;
	mustSeparatePairs: Set<string>;
}

// メインエントリ。
export function regionLayout(
	nodes: GraphNode[],
	sized: SizedNode[],
	aggregatedSets: Set<string>,
	opts: Partial<RegionLayoutOptions> = {},
): RegionLayoutResult {
	const o: RegionLayoutOptions = { ...DEFAULTS, ...opts };
	const sizedById = new Map<string, SizedNode>();
	for (const s of sized) sizedById.set(s.id, s);

	// === Phase A ===
	// A-1: aggregate preprocessing.
	const { nodes: aggNodes, aggregatePreservedCounts } =
		applyAggregatePreprocessing(nodes, {
			aggregatedSets,
			stackSize: 3,
			virtualIdPrefix: "__agg__",
		});
	// A-2: NONE_BUCKET.
	const { nodes: bucketedNodes, hasNoneBucket } = ensureNoneBucket(aggNodes);
	// A-3 & A-5: decompose + count.
	let zones = decomposeZones(bucketedNodes);
	// A-6: Helly forced.
	const mustOverlapPairs = computeMustOverlapPairs(zones);
	const hellyForced = detectHellyForcedZones(zones, mustOverlapPairs);
	zones = materialiseHellyForcedZones(zones, hellyForced);

	// === Phase B 統合 / Phase C: 目標面積 ===
	// 仮想ノードのサイズは cluster の設定。実装簡略化のため、ここでは sizedById
	// に登録されている size を使い、virtual ノードは「対象 cluster の代表 sized」
	// で代替する。なければ default (cardW, cardH)。
	const baseSetCounts = computeBaseSetCounts(zones);
	const baseSets = [...baseSetCounts.keys()];

	const nodeArea = (n: GraphNode): number => {
		const sz = sizedById.get(n.id);
		if (sz) return sz.width * sz.height;
		// virtual aggregate node — find any representative real node from
		// the same cluster, or fall back to cardW × cardH.
		for (const m of n.memberships) {
			for (const s of sized) {
				if (s.memberships.includes(m)) return s.width * s.height;
			}
		}
		return o.cardW * o.cardH;
	};

	// ゾーン目標面積 (Phase C)。空ゾーンは emptyZoneTargetMode に従う。
	let zoneTargetArea = computeZoneTargetAreas(zones, nodeArea, o);
	// ゾーン重み (件数比例)。
	const zoneWeight = new Map<string, number>();
	for (const z of zones) {
		if (z.isHellyForced && z.count === 0) {
			zoneWeight.set(
				z.key,
				o.emptyZoneTargetMode === "visible" ? 0.2 : 0,
			);
		} else {
			zoneWeight.set(z.key, Math.max(1, z.count));
		}
	}

	// 集合目標面積 = 含有ゾーン総和。
	const setTargetArea = computeSetTargetAreas(baseSets, zones, zoneTargetArea);

	// === Phase D: seed ===
	// 「分離要」関係 = どのゾーンとも共存しないペア。NONE_BUCKET は他全と分離要。
	const mustSeparatePairs = computeMustSeparatePairs(baseSets, mustOverlapPairs, hasNoneBucket);
	const mustNest = new Map<string, string>(Object.entries(o.inheritFrom ?? {}));

	const topo: TopologyConstraints = {
		mustOverlap: mustOverlapPairs,
		mustSeparate: mustSeparatePairs,
		mustNest,
	};

	let bestRects: Map<string, RegionRect> | null = null;
	let bestObj = Infinity;
	const totalAreaSum = sumValues(setTargetArea);
	const sceneSide = Math.sqrt(totalAreaSum) * 1.5;

	for (let trial = 0; trial < o.seedShuffleTries; trial++) {
		const rects = seedRectangles(
			baseSets,
			setTargetArea,
			mustOverlapPairs,
			mustSeparatePairs,
			mustNest,
			sceneSide,
			trial,
		);

		// === Phase E + F ===
		const finalRects = runAlternatingOptimization(
			rects,
			zones,
			zoneTargetArea,
			zoneWeight,
			topo,
			o,
			(updatedRects, updatedZones) => {
				// Phase F shape correction callback: recompute zone target
				// areas given current rect aspect ratios. Returns true if
				// updates are still significant.
				const newTargets = recomputeZoneTargetsForAspect(
					updatedZones,
					updatedRects,
					nodeArea,
					o,
				);
				let maxDelta = 0;
				for (const [k, nt] of newTargets.entries()) {
					const old = zoneTargetArea.get(k) ?? 0;
					if (old > 0) {
						maxDelta = Math.max(maxDelta, Math.abs(nt - old) / old);
					}
					zoneTargetArea.set(k, nt);
				}
				return maxDelta >= o.outerTol;
			},
		);

		// 評価値 (= 面積誤差 + 位相違反)。
		const obj = evaluateObjective(finalRects, zones, zoneTargetArea, zoneWeight, topo, o);
		if (obj < bestObj) {
			bestObj = obj;
			bestRects = finalRects;
		}
	}

	return {
		setRects: bestRects ?? new Map<string, RegionRect>(),
		zones,
		hasNoneBucket,
		aggregatePreservedCounts,
		mustOverlapPairs,
		mustSeparatePairs,
	};
}

// === Phase C helpers ===

function computeZoneTargetAreas(
	zones: Zone[],
	nodeArea: (n: GraphNode) => number,
	o: RegionLayoutOptions,
): Map<string, number> {
	const out = new Map<string, number>();
	let nonEmptyAreaSum = 0;
	let nonEmptyCount = 0;
	for (const z of zones) {
		if (z.count > 0) {
			let area = 0;
			for (const n of z.nodes) area += nodeArea(n);
			const target = area / o.rhoFill;
			out.set(z.key, target);
			nonEmptyAreaSum += target;
			nonEmptyCount++;
		}
	}
	// 空ゾーン (Helly 強制) は emptyZoneTargetMode に従う。
	for (const z of zones) {
		if (z.count > 0) continue;
		if (o.emptyZoneTargetMode === "visible" && nonEmptyCount > 0) {
			out.set(z.key, (nonEmptyAreaSum / nonEmptyCount) * 0.3);
		} else {
			out.set(z.key, 0);
		}
	}
	return out;
}

function computeSetTargetAreas(
	baseSets: string[],
	zones: Zone[],
	zoneTargetArea: Map<string, number>,
): Map<string, number> {
	const out = new Map<string, number>();
	for (const s of baseSets) {
		let total = 0;
		for (const z of zones) {
			if (z.memberships.includes(s)) {
				total += zoneTargetArea.get(z.key) ?? 0;
			}
		}
		out.set(s, total);
	}
	return out;
}

// === Phase D helpers ===

function computeMustSeparatePairs(
	baseSets: string[],
	mustOverlap: Set<string>,
	hasNoneBucket: boolean,
): Set<string> {
	const out = new Set<string>();
	for (let i = 0; i < baseSets.length; i++) {
		for (let j = i + 1; j < baseSets.length; j++) {
			const a = baseSets[i];
			const b = baseSets[j];
			const key = a < b ? `${a}|${b}` : `${b}|${a}`;
			if (mustOverlap.has(key)) continue;
			// NONE_BUCKET は他全と分離要。
			if (hasNoneBucket && (a === NONE_BUCKET_KEY || b === NONE_BUCKET_KEY)) {
				out.add(key);
				continue;
			}
			out.add(key);
		}
	}
	return out;
}

// 簡易決定的 hash (FNV-1a 32-bit) — Phase D seed のシャッフル試行用。
function fnv1a(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h;
}

function seedRectangles(
	baseSets: string[],
	setTargetArea: Map<string, number>,
	mustOverlap: Set<string>,
	mustSeparate: Set<string>,
	mustNest: Map<string, string>,
	sceneSide: number,
	trial: number,
): Map<string, RegionRect> {
	// 初期: 各集合矩形を sqrt(target) の正方形で配置。
	// 配置順: 大きい順 (面積降順)。試行ごとに hash で微小オフセット。
	const sorted = [...baseSets].sort(
		(a, b) => (setTargetArea.get(b) ?? 0) - (setTargetArea.get(a) ?? 0),
	);
	const rects = new Map<string, RegionRect>();
	// グリッド状に並べる: ceil(sqrt(N)) × ceil(sqrt(N))。
	const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
	for (let i = 0; i < sorted.length; i++) {
		const k = sorted[i];
		const area = Math.max(setTargetArea.get(k) ?? 100, 100);
		const side = Math.sqrt(area);
		const col = i % cols;
		const row = Math.floor(i / cols);
		const h = fnv1a(`${k}|${trial}`);
		const jitterX = ((h & 0xff) / 256 - 0.5) * sceneSide * 0.1;
		const jitterY = (((h >> 8) & 0xff) / 256 - 0.5) * sceneSide * 0.1;
		rects.set(k, {
			setKey: k,
			x: col * sceneSide * 0.5 + jitterX,
			y: row * sceneSide * 0.5 + jitterY,
			w: side,
			h: side,
		});
	}
	// 「重なり要」関係のペアを少し近づける。簡易: 各「重なり要」ペアの中間に
	// 寄せる (小さな反復で)。
	for (let iter = 0; iter < 10; iter++) {
		for (const key of mustOverlap) {
			const [a, b] = key.split("|");
			const ra = rects.get(a);
			const rb = rects.get(b);
			if (!ra || !rb) continue;
			const acx = ra.x + ra.w / 2;
			const acy = ra.y + ra.h / 2;
			const bcx = rb.x + rb.w / 2;
			const bcy = rb.y + rb.h / 2;
			const dx = bcx - acx;
			const dy = bcy - acy;
			// 中心を 10% 寄せる。
			ra.x += dx * 0.05;
			ra.y += dy * 0.05;
			rb.x -= dx * 0.05;
			rb.y -= dy * 0.05;
		}
		for (const key of mustSeparate) {
			const [a, b] = key.split("|");
			const ra = rects.get(a);
			const rb = rects.get(b);
			if (!ra || !rb) continue;
			const acx = ra.x + ra.w / 2;
			const acy = ra.y + ra.h / 2;
			const bcx = rb.x + rb.w / 2;
			const bcy = rb.y + rb.h / 2;
			const overlapX = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
			const overlapY = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
			if (overlapX > 0 && overlapY > 0) {
				const dx = bcx - acx;
				const dy = bcy - acy;
				const norm = Math.hypot(dx, dy) || 1;
				ra.x -= (dx / norm) * (overlapX + 4) * 0.5;
				rb.x += (dx / norm) * (overlapX + 4) * 0.5;
			}
		}
	}
	// nesting (inheritFrom): child を parent の OUTSIDE に拡大し parent を内包。
	// 既存 expandClustersByInheritance 互換: child が outer, parent が inner。
	for (const [child, parent] of mustNest) {
		const rc = rects.get(child);
		const rp = rects.get(parent);
		if (!rc || !rp) continue;
		// child を parent と child の union に拡張。
		const minX = Math.min(rc.x, rp.x);
		const minY = Math.min(rc.y, rp.y);
		const maxX = Math.max(rc.x + rc.w, rp.x + rp.w);
		const maxY = Math.max(rc.y + rc.h, rp.y + rp.h);
		rc.x = minX;
		rc.y = minY;
		rc.w = maxX - minX;
		rc.h = maxY - minY;
	}
	return rects;
}

// === Phase E + F ===

function runAlternatingOptimization(
	initRects: Map<string, RegionRect>,
	zones: Zone[],
	zoneTargetArea: Map<string, number>,
	zoneWeight: Map<string, number>,
	topo: TopologyConstraints,
	o: RegionLayoutOptions,
	onOuterIter: (
		rects: Map<string, RegionRect>,
		zones: Zone[],
	) => boolean,
): Map<string, RegionRect> {
	const rects = new Map<string, RegionRect>();
	for (const [k, v] of initRects) rects.set(k, { ...v });

	for (let outer = 0; outer < o.maxOuterIter; outer++) {
		// 内側反復: x と y を交互に最適化。
		let prevObj = Infinity;
		for (let inner = 0; inner < o.maxInnerIter; inner++) {
			// y 固定で x を最適化。
			optimizeAxis(rects, zones, zoneTargetArea, zoneWeight, topo, "x", o);
			// x 固定で y を最適化。
			optimizeAxis(rects, zones, zoneTargetArea, zoneWeight, topo, "y", o);

			const obj = evaluateObjective(rects, zones, zoneTargetArea, zoneWeight, topo, o);
			if (Math.abs(prevObj - obj) / Math.max(1, prevObj) < o.innerTol) break;
			prevObj = obj;
		}
		// 外側反復 callback (Phase F)。
		const shouldContinue = onOuterIter(rects, zones);
		if (!shouldContinue) break;
	}
	return rects;
}

function optimizeAxis(
	rects: Map<string, RegionRect>,
	zones: Zone[],
	zoneTargetArea: Map<string, number>,
	zoneWeight: Map<string, number>,
	topo: TopologyConstraints,
	axis: "x" | "y",
	o: RegionLayoutOptions,
): void {
	const baseSets = [...rects.keys()];
	const intervals: Interval[] = baseSets.map((k) => {
		const r = rects.get(k)!;
		return axis === "x"
			? { setKey: k, start: r.x, end: r.x + r.w }
			: { setKey: k, start: r.y, end: r.y + r.h };
	});

	// 各ゾーンの「他軸広がり」から target_len を計算。
	const targetLen = new Map<string, number>();
	const otherAxisExtents = currentZoneExtentsOnAxis(rects, zones, axis === "x" ? "y" : "x");
	for (const z of zones) {
		const ta = zoneTargetArea.get(z.key) ?? 0;
		const otherExt = otherAxisExtents.get(z.key) ?? 1;
		if (otherExt <= 0 || ta <= 0) {
			targetLen.set(z.key, 0);
		} else {
			targetLen.set(z.key, ta / otherExt);
		}
	}

	solve1D(intervals, zones, targetLen, zoneWeight, topo, {
		minGap: o.minIntervalLen,
		lambdaTopo: o.lambdaTopo,
		gradStep0: o.gradStep0,
		gradMaxStep: o.gradMaxStep,
		maxIter: 20,
	});

	for (const iv of intervals) {
		const r = rects.get(iv.setKey)!;
		if (axis === "x") {
			r.x = iv.start;
			r.w = iv.end - iv.start;
		} else {
			r.y = iv.start;
			r.h = iv.end - iv.start;
		}
	}
}

function currentZoneExtentsOnAxis(
	rects: Map<string, RegionRect>,
	zones: Zone[],
	axis: "x" | "y",
): Map<string, number> {
	const intervals: Interval[] = [...rects.values()].map((r) => ({
		setKey: r.setKey,
		start: axis === "x" ? r.x : r.y,
		end: axis === "x" ? r.x + r.w : r.y + r.h,
	}));
	const extentsByKey = computeZoneExtents(intervals);
	const out = new Map<string, number>();
	for (const z of zones) {
		out.set(z.key, extentsByKey.get(z.key) ?? 0);
	}
	return out;
}

// === Phase F helper ===

function recomputeZoneTargetsForAspect(
	zones: Zone[],
	rects: Map<string, RegionRect>,
	nodeArea: (n: GraphNode) => number,
	o: RegionLayoutOptions,
): Map<string, number> {
	// 実 aspect ratio から ρ を再評価。本格的な shelf-pack シミュレーションは
	// 重いので、簡易補正: aspect ratio が 1:1 から離れるほど ρ を下げる。
	const out = new Map<string, number>();
	for (const z of zones) {
		if (z.count === 0) {
			out.set(z.key, o.emptyZoneTargetMode === "visible" ? 1 : 0);
			continue;
		}
		let area = 0;
		for (const n of z.nodes) area += nodeArea(n);

		// ゾーン矩形 = 関与する全集合矩形の AABB 交差。
		const inter = intersectRectsForZone(z.memberships, rects);
		let rho = o.rhoFill;
		if (inter && inter.w > 0 && inter.h > 0) {
			const r = inter.w > inter.h ? inter.w / inter.h : inter.h / inter.w;
			rho = o.rhoFill * Math.min(1, 1 / Math.sqrt(r));
		}
		out.set(z.key, area / Math.max(0.1, rho));
	}
	return out;
}

function intersectRectsForZone(
	memberships: string[],
	rects: Map<string, RegionRect>,
): RegionRect | null {
	let l = -Infinity,
		t = -Infinity,
		r = Infinity,
		b = Infinity;
	for (const m of memberships) {
		const rect = rects.get(m);
		if (!rect) return null;
		l = Math.max(l, rect.x);
		t = Math.max(t, rect.y);
		r = Math.min(r, rect.x + rect.w);
		b = Math.min(b, rect.y + rect.h);
	}
	if (r <= l || b <= t) return null;
	return { setKey: memberships.join("|"), x: l, y: t, w: r - l, h: b - t };
}

// === 評価関数 ===

function evaluateObjective(
	rects: Map<string, RegionRect>,
	zones: Zone[],
	zoneTargetArea: Map<string, number>,
	zoneWeight: Map<string, number>,
	topo: TopologyConstraints,
	o: RegionLayoutOptions,
): number {
	let total = 0;
	// 各ゾーンの (現在の area − target_area)²。
	for (const z of zones) {
		const t = zoneTargetArea.get(z.key) ?? 0;
		const w = zoneWeight.get(z.key) ?? 0;
		if (w === 0) continue;
		const inter = intersectRectsForZone(z.memberships, rects);
		const area = inter ? inter.w * inter.h : 0;
		const diff = area - t;
		total += w * diff * diff;
	}
	// 位相罰。
	for (const key of topo.mustOverlap) {
		const [a, b] = key.split("|");
		const ra = rects.get(a);
		const rb = rects.get(b);
		if (!ra || !rb) continue;
		const ox = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
		const oy = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
		if (ox < 0) total += o.lambdaTopo * ox * ox;
		if (oy < 0) total += o.lambdaTopo * oy * oy;
	}
	for (const key of topo.mustSeparate) {
		const [a, b] = key.split("|");
		const ra = rects.get(a);
		const rb = rects.get(b);
		if (!ra || !rb) continue;
		const ox = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
		const oy = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
		if (ox > 0 && oy > 0) total += o.lambdaTopo * ox * oy;
	}
	for (const [child, parent] of topo.mustNest) {
		const rc = rects.get(child);
		const rp = rects.get(parent);
		if (!rc || !rp) continue;
		// inheritFrom: child は OUTER, parent は INNER (既存
		// expandClustersByInheritance 互換)。
		const lOut = Math.max(0, rc.x - rp.x);
		const rOut = Math.max(0, rp.x + rp.w - (rc.x + rc.w));
		const tOut = Math.max(0, rc.y - rp.y);
		const bOut = Math.max(0, rp.y + rp.h - (rc.y + rc.h));
		total += o.lambdaTopo * (lOut * lOut + rOut * rOut + tOut * tOut + bOut * bOut);
	}
	return total;
}

function sumValues(m: Map<string, number>): number {
	let s = 0;
	for (const v of m.values()) s += v;
	return s;
}
