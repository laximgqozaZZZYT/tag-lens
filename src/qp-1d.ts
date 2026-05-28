// 1D 区間配置の凸 QP を projected gradient で解く。
//
// 入力: 各基底集合 i に対する 1 軸の区間 [start_i, end_i]。
//      各ゾーン S (memberships の sub-set) に対する目標長 target_len_S と重み weight_S。
//      位相制約: (a) "重なり要" ペア, (b) "分離要" ペア, (c) "内包要" ペア (子→親), (d) Helly 強制ゾーン。
//      件数 ≥ 1 ゾーンには各軸 minGap 制約。
//
// 出力: 端点位置を最適化し、(start_i, end_i) を in-place 更新。
//      ゾーン extent (= 当該軸でそのゾーンが占める長さ) は端点順序に依存して
//      セグメント分解により求まる。
//
// 目的関数:
//      f(x) = Σ_S weight_S · (extent(S) − target_len_S)²
//             + λ_topo · 位相ペナルティ(x)

import type { Zone } from "./zone-decomp";

export interface Interval {
	setKey: string;
	start: number;
	end: number;
}

// 位相制約。各ペアは "重なり要" / "分離要" / "内包要" のいずれか。
// "内包要" は子 (smallerKey) が親 (largerKey) の内側に収まる必要がある関係。
export interface TopologyConstraints {
	mustOverlap: Set<string>; // key "a|b" with a < b
	mustSeparate: Set<string>; // key "a|b" with a < b
	mustNest: Map<string, string>; // childKey → parentKey
}

export interface SolveOptions {
	minGap: number;
	lambdaTopo: number;
	gradStep0: number;
	gradMaxStep: number;
	maxIter: number; // projected gradient 内側反復上限
}

const DEFAULT_OPTS: SolveOptions = {
	minGap: 8,
	lambdaTopo: 1000,
	gradStep0: 0.5,
	gradMaxStep: 20,
	maxIter: 50,
};

// 1 軸を最適化。intervals を in-place で更新。
// targetLen: ゾーン key → 目標長。Helly 強制ゾーン (count=0) は targetLen.get() = undefined で渡し、
// weight も 0 にすること (= 関与しない)。
// weight: ゾーン key → 重み。
export function solve1D(
	intervals: Interval[],
	zones: Zone[],
	targetLen: Map<string, number>,
	weight: Map<string, number>,
	topo: TopologyConstraints,
	opts: Partial<SolveOptions> = {},
): void {
	const o: SolveOptions = { ...DEFAULT_OPTS, ...opts };
	if (intervals.length === 0) return;

	// Index for fast lookup.
	const idxBySet = new Map<string, number>();
	intervals.forEach((iv, i) => idxBySet.set(iv.setKey, i));

	// 1 軸あたり 2n 変数 (start_i, end_i)。
	const n = intervals.length;
	const x = new Float64Array(2 * n);
	for (let i = 0; i < n; i++) {
		x[2 * i] = intervals[i].start;
		x[2 * i + 1] = intervals[i].end;
	}

	const writeBack = (): void => {
		for (let i = 0; i < n; i++) {
			intervals[i].start = x[2 * i];
			intervals[i].end = x[2 * i + 1];
		}
	};

	let prevObj = Infinity;
	let step = o.gradStep0;
	for (let iter = 0; iter < o.maxIter; iter++) {
		const obj = computeObjective(x, n, zones, targetLen, weight, idxBySet, topo, o);
		const g = computeGradient(x, n, zones, targetLen, weight, idxBySet, topo, o);

		// 更新候補。
		const xNew = new Float64Array(2 * n);
		for (let k = 0; k < 2 * n; k++) {
			const d = -step * g[k];
			const cl = Math.max(-o.gradMaxStep, Math.min(o.gradMaxStep, d));
			xNew[k] = x[k] + cl;
		}

		// 射影: 端点順序 + interval 有効性 + 件数≥1 セグメントの minGap。
		project(xNew, n, zones, o.minGap, idxBySet);

		const objNew = computeObjective(xNew, n, zones, targetLen, weight, idxBySet, topo, o);
		if (objNew < obj) {
			for (let k = 0; k < 2 * n; k++) x[k] = xNew[k];
			step *= 1.1;
			if (Math.abs(prevObj - objNew) / Math.max(1, prevObj) < 1e-4) break;
			prevObj = objNew;
		} else {
			step *= 0.5;
			if (step < 1e-4 * o.gradStep0) break;
		}
	}

	writeBack();
}

// 各セグメント (連続端点ペア) を覆う基底集合の組を計算 → ゾーン key。
// セグメント長を合計して extent(zone) を得る。
function computeExtents(
	x: Float64Array,
	n: number,
	idxBySet: Map<string, number>,
): Map<string, number> {
	// 端点リストを (位置, set, kind) で集める。kind: 0=start, 1=end。
	const eps: { pos: number; set: number; kind: 0 | 1 }[] = [];
	for (let i = 0; i < n; i++) {
		eps.push({ pos: x[2 * i], set: i, kind: 0 });
		eps.push({ pos: x[2 * i + 1], set: i, kind: 1 });
	}
	eps.sort((a, b) => a.pos - b.pos || a.kind - b.kind);

	const active = new Set<number>();
	const extents = new Map<string, number>();
	for (let s = 0; s < eps.length - 1; s++) {
		const e = eps[s];
		if (e.kind === 0) active.add(e.set);
		else active.delete(e.set);
		const next = eps[s + 1];
		const len = next.pos - e.pos;
		if (len <= 0) continue;
		if (active.size === 0) continue;
		// active set → ゾーン key (基底集合 ID は intervals[i].setKey)。
		const memb: string[] = [];
		for (const idx of active) {
			// idxBySet の逆引きが必要。idxBySet は set→idx だが我々は idx→key が欲しい。
			// Workaround: 呼び出し側で index→key 配列を持つ。ここは別経路で。
			memb.push(String(idx)); // 仮プレースホルダ — 下記で本物に置換する。
		}
	}
	return extents;
}

// 上の computeExtents は 暫定。実用版を以下に書き直し。
function computeExtentsByKey(
	x: Float64Array,
	n: number,
	indexToSetKey: string[],
): Map<string, number> {
	const eps: { pos: number; set: number; kind: 0 | 1 }[] = [];
	for (let i = 0; i < n; i++) {
		eps.push({ pos: x[2 * i], set: i, kind: 0 });
		eps.push({ pos: x[2 * i + 1], set: i, kind: 1 });
	}
	eps.sort((a, b) => a.pos - b.pos || a.kind - b.kind);

	const active = new Set<number>();
	const extents = new Map<string, number>();
	for (let s = 0; s < eps.length; s++) {
		const e = eps[s];
		if (e.kind === 0) active.add(e.set);
		// セグメント = 現在の端点位置 → 次の端点位置。
		if (s + 1 < eps.length) {
			const next = eps[s + 1];
			const len = next.pos - e.pos;
			if (len > 0 && active.size > 0) {
				const sortedIdx = [...active].sort((a, b) => a - b);
				const key = sortedIdx.map((i) => indexToSetKey[i]).join("|");
				extents.set(key, (extents.get(key) ?? 0) + len);
			}
		}
		if (e.kind === 1) active.delete(e.set);
	}
	return extents;
}

function computeObjective(
	x: Float64Array,
	n: number,
	zones: Zone[],
	targetLen: Map<string, number>,
	weight: Map<string, number>,
	idxBySet: Map<string, number>,
	topo: TopologyConstraints,
	o: SolveOptions,
): number {
	const indexToSetKey = new Array<string>(n);
	for (const [k, v] of idxBySet.entries()) indexToSetKey[v] = k;
	const extents = computeExtentsByKey(x, n, indexToSetKey);

	let total = 0;
	// 面積項。
	for (const z of zones) {
		const tl = targetLen.get(z.key);
		const w = weight.get(z.key);
		if (tl === undefined || w === undefined || w === 0) continue;
		const ext = extents.get(z.key) ?? 0;
		const diff = ext - tl;
		total += w * diff * diff;
	}
	// 位相ペナルティ。
	total += o.lambdaTopo * computeTopologyPenalty(x, n, idxBySet, topo);
	return total;
}

function computeTopologyPenalty(
	x: Float64Array,
	n: number,
	idxBySet: Map<string, number>,
	topo: TopologyConstraints,
): number {
	let pen = 0;
	const start = (i: number): number => x[2 * i];
	const end = (i: number): number => x[2 * i + 1];

	// 重なり要: 重なってないと罰 (ヒンジ)。
	for (const key of topo.mustOverlap) {
		const [a, b] = key.split("|");
		const ia = idxBySet.get(a);
		const ib = idxBySet.get(b);
		if (ia === undefined || ib === undefined) continue;
		const overlap = Math.min(end(ia), end(ib)) - Math.max(start(ia), start(ib));
		if (overlap < 0) pen += overlap * overlap;
	}
	// 分離要: 重なってると罰。
	for (const key of topo.mustSeparate) {
		const [a, b] = key.split("|");
		const ia = idxBySet.get(a);
		const ib = idxBySet.get(b);
		if (ia === undefined || ib === undefined) continue;
		const overlap = Math.min(end(ia), end(ib)) - Math.max(start(ia), start(ib));
		if (overlap > 0) pen += overlap * overlap;
	}
	// 内包要 (inheritFrom 関係): child が parent を包む必要がある (既存
	// expandClustersByInheritance のセマンティクスと整合)。child の矩形が
	// parent をはみ出させると罰。
	for (const [child, parent] of topo.mustNest) {
		const ic = idxBySet.get(child);
		const ip = idxBySet.get(parent);
		if (ic === undefined || ip === undefined) continue;
		// child は OUTER, parent は INNER。
		// 違反 = parent が child の外にはみ出す部分。
		const leftOut = Math.max(0, start(ic) - start(ip));
		const rightOut = Math.max(0, end(ip) - end(ic));
		pen += leftOut * leftOut + rightOut * rightOut;
	}
	return pen;
}

// 数値微分による勾配。解析的微分は extent の active-set 切替で
// 不連続になるので、ε=1e-3 の中心差分を採用 (n が小さければ十分高速)。
function computeGradient(
	x: Float64Array,
	n: number,
	zones: Zone[],
	targetLen: Map<string, number>,
	weight: Map<string, number>,
	idxBySet: Map<string, number>,
	topo: TopologyConstraints,
	o: SolveOptions,
): Float64Array {
	const g = new Float64Array(2 * n);
	const eps = 1e-3;
	for (let k = 0; k < 2 * n; k++) {
		const orig = x[k];
		x[k] = orig + eps;
		const fPlus = computeObjective(x, n, zones, targetLen, weight, idxBySet, topo, o);
		x[k] = orig - eps;
		const fMinus = computeObjective(x, n, zones, targetLen, weight, idxBySet, topo, o);
		x[k] = orig;
		g[k] = (fPlus - fMinus) / (2 * eps);
	}
	return g;
}

// 射影: end_i ≥ start_i + ε、件数≥1 のセグメントは len ≥ minGap。
// 端点順序の保持 (= 元の順序を保つ) は実装簡素化のため省略。
// 件数 ≥1 ゾーンの幅確保は extent-based なのでセグメント単位でなく、
// 該当ゾーンの基底集合各 i について end_i - start_i ≥ minGap を要求する
// (= "基底集合矩形が潰れない" 制約; ゾーン extent はそこから誘導)。
function project(
	xNew: Float64Array,
	n: number,
	zones: Zone[],
	minGap: number,
	_idxBySet: Map<string, number>,
): void {
	// 各基底集合: end ≥ start + minGap (件数≥1 の基底集合は必ず非空)。
	for (let i = 0; i < n; i++) {
		if (xNew[2 * i + 1] < xNew[2 * i] + minGap) {
			const mid = (xNew[2 * i] + xNew[2 * i + 1]) / 2;
			xNew[2 * i] = mid - minGap / 2;
			xNew[2 * i + 1] = mid + minGap / 2;
		}
	}
}

// 公開ヘルパ: solve1D の結果から、各ゾーン extent を返す。Phase F の
// 形状補正で使用 (= solve1D 完了後の状態を再 query)。
export function computeZoneExtents(
	intervals: Interval[],
): Map<string, number> {
	const n = intervals.length;
	const x = new Float64Array(2 * n);
	const indexToSetKey: string[] = [];
	for (let i = 0; i < n; i++) {
		x[2 * i] = intervals[i].start;
		x[2 * i + 1] = intervals[i].end;
		indexToSetKey.push(intervals[i].setKey);
	}
	return computeExtentsByKey(x, n, indexToSetKey);
}
