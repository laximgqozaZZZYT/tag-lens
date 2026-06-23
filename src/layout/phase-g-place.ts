// Phase G: ノード配置。Phase A-F で確定した setRects と zones から、
// 各ノードに具体的な (x, y) 座標を割り当てる。
//
// 順序:
//   G-1: 多重所属ゾーン (|memberships| ≥ 2) を先に配置 — intersection rect
//        の中に行優先で詰める
//   G-2: 排他ゾーン (|memberships| = 1) を後に配置 — 各 setRect の中で
//        spiral 探索でフリーセルへスナップ
//
// セル単位の最終調整 (重なり解消) は snapCardsToGrid に任せる。

import type { GraphNode } from "../types";
import type { PositionedNode, SizedNode } from "./layout";
import type { Zone } from "./zone-decomp";
import type { RegionRect } from "./region-layout";
import { NONE_BUCKET_KEY } from "./zone-decomp";
import { resolveNodeRegion } from "./intersection-region";
import { shelfPack } from "./subgroup-packing";

export interface PhaseGOptions {
	slotW: number;
	slotH: number;
	padPx: number; // 集合矩形内側パディング
	defaultCardW: number;
	defaultCardH: number;
}

// Cell keys ("col,row") that a continuous-coordinate box (center + size)
// overlaps on the slotW x slotH grid. Used to seed `preOccupied` from
// content positioned by a different packing pass that isn't grid-quantized
// the same way this module's own emitNode() spans cells — any grid cell
// whose [c*slotW, (c+1)*slotW) span overlaps the box's extent counts as
// occupied, so a later placeNodesInRegions() call won't render on top of it.
export function cellKeysForBox(
	cx: number,
	cy: number,
	w: number,
	h: number,
	slotW: number,
	slotH: number,
): string[] {
	const colFrom = Math.floor((cx - w / 2) / slotW);
	const colTo = Math.floor((cx + w / 2 - 1e-6) / slotW);
	const rowFrom = Math.floor((cy - h / 2) / slotH);
	const rowTo = Math.floor((cy + h / 2 - 1e-6) / slotH);
	const keys: string[] = [];
	for (let c = colFrom; c <= colTo; c++) {
		for (let r = rowFrom; r <= rowTo; r++) keys.push(`${c},${r}`);
	}
	return keys;
}

// メインエントリ。
export function placeNodesInRegions(
	zones: Zone[],
	setRects: Map<string, RegionRect>,
	sized: SizedNode[],
	opts: PhaseGOptions,
	// Cells already claimed by content this function doesn't itself place
	// (e.g. exclusive single-tag cards positioned by a different, earlier
	// packing pass that shares the same slotW/slotH grid). Seeding these
	// in up front prevents this function's own placements from landing on
	// top of them. Optional — omitting it reproduces prior behavior exactly.
	preOccupied?: ReadonlySet<string>,
): PositionedNode[] {
	const sizedById = new Map<string, SizedNode>();
	for (const s of sized) sizedById.set(s.id, s);
	const out: PositionedNode[] = [];

	// セル単位 occupancy。"col,row" 文字列キー。
	const occupied = new Set<string>(preOccupied ?? []);

	// 配置順: |memberships| 降順 → count 降順 (大きい固まりから埋める)。
	// 多重所属を先 → 排他を後。
	const sortedZones = [...zones]
		.filter((z) => z.count > 0)
		.sort((a, b) => {
			if (b.memberships.length !== a.memberships.length) {
				return b.memberships.length - a.memberships.length;
			}
			return b.count - a.count;
		});

	const mainRectOf = (tag: string): { x: number; y: number; w: number; h: number } | null => {
		const r = setRects.get(tag);
		return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
	};

	for (const z of sortedZones) {
		// Cascade exactly like resolveNodeRegion does for the bubblesets
		// degree-cascade scheme: try the zone's full membership signature
		// first; if that AABB intersection doesn't exist (degenerate or a
		// missing set), drop to every (k-1)-combination, then (k-2), … down
		// to a single tag's own rect, which always exists. A zone must
		// never be silently skipped just because its full-degree
		// intersection happens to be empty.
		const resolved =
			z.memberships.length >= 2
				? resolveNodeRegion(z.memberships, mainRectOf)
				: (() => {
						const r = mainRectOf(z.memberships[0]);
						return r ? { tags: z.memberships, rect: r } : null;
					})();
		if (!resolved) continue;
		const region = resolved.rect;
		const resolvedDegree = resolved.tags.length;

		// region をセル座標へ。
		const colStart = Math.ceil(region.x / opts.slotW);
		const colEnd = Math.floor((region.x + region.w) / opts.slotW) - 1;
		const rowStart = Math.ceil(region.y / opts.slotH);
		const rowEnd = Math.floor((region.y + region.h) / opts.slotH) - 1;

		if (colEnd < colStart || rowEnd < rowStart) {
			// region が 1 セルにも満たない (= setRect が小さすぎる)。
			// グリッドへスナップせず、region の連続座標を起点にこのゾーンの
			// 全ノードを直接シェルフパックする — 1ノード目だけ region 中心
			// に正確に置き、残りをグリッドにスナップした spiral fallback に
			// 委ねる方式だと、座標系の不一致で1ノード目と隣接ノードが
			// 実際には重なってしまうことがあった(連続座標 vs グリッド量子化
			// の混在が原因)。シェルフパック自体は常にゾーン内ノード同士の
			// 非重なりを保証するので、region が狭くてもこのゾーンの中では
			// 重なりが起きない。
			placeTinyRegionShelf(z.nodes, region, occupied, sizedById, opts, out);
			continue;
		}

		// 行優先でセルを埋める。多重所属ゾーン(カスケード後も次数≥2)は
		// intersection rect 内に行優先で配置。排他ゾーン、または次数1まで
		// カスケードされたゾーンは setRect 内で free cell を spiral 探索。
		if (resolvedDegree >= 2) {
			placeMultiZoneRowMajor(z.nodes, colStart, colEnd, rowStart, rowEnd, occupied, sizedById, opts, out);
		} else {
			placeExclusiveSpiral(z.nodes, colStart, colEnd, rowStart, rowEnd, occupied, sizedById, opts, out);
		}
	}
	return out;
}

function placeMultiZoneRowMajor(
	nodes: GraphNode[],
	colStart: number,
	colEnd: number,
	rowStart: number,
	rowEnd: number,
	occupied: Set<string>,
	sizedById: Map<string, SizedNode>,
	opts: PhaseGOptions,
	out: PositionedNode[],
): void {
	let col = colStart;
	let row = rowStart;
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		// 既に占有されていれば次セルへ。
		while (occupied.has(`${col},${row}`)) {
			col++;
			if (col > colEnd) {
				col = colStart;
				row++;
				if (row > rowEnd) {
					// region 内に空きなし — 現在のノード以降、全ての残りノードを
					// spiral で外側に配置する(取り落とさない — 以前はここで
					// 現在の1ノードだけ配置して即returnし、残りを全て捨てていた)。
					for (let j = i; j < nodes.length; j++) {
						placeViaSpiral(nodes[j], colStart, rowStart, occupied, sizedById, opts, out);
					}
					return;
				}
			}
		}
		emitNode(n, col, row, occupied, sizedById, opts, out);
		col++;
		if (col > colEnd) {
			col = colStart;
			row++;
		}
		if (row > rowEnd && col === colStart) {
			// region 終わり。後続は spiral で。
			for (let j = i + 1; j < nodes.length; j++) {
				placeViaSpiral(nodes[j], colStart, rowStart, occupied, sizedById, opts, out);
			}
			return;
		}
	}
}

function placeExclusiveSpiral(
	nodes: GraphNode[],
	colStart: number,
	colEnd: number,
	rowStart: number,
	rowEnd: number,
	occupied: Set<string>,
	sizedById: Map<string, SizedNode>,
	opts: PhaseGOptions,
	out: PositionedNode[],
): void {
	// 初期セル = setRect 中央。spiral でフリーセル探索。
	const c0 = Math.floor((colStart + colEnd) / 2);
	const r0 = Math.floor((rowStart + rowEnd) / 2);
	for (const n of nodes) {
		const free = findFreeCellInRegion(c0, r0, colStart, colEnd, rowStart, rowEnd, occupied);
		if (free) {
			emitNode(n, free.col, free.row, occupied, sizedById, opts, out);
		} else {
			// region 内に空きなし — spiral を region 外へ拡張。
			placeViaSpiral(n, c0, r0, occupied, sizedById, opts, out);
		}
	}
}

function findFreeCellInRegion(
	cInit: number,
	rInit: number,
	colStart: number,
	colEnd: number,
	rowStart: number,
	rowEnd: number,
	occupied: Set<string>,
): { col: number; row: number } | null {
	if (!occupied.has(`${cInit},${rInit}`) &&
		cInit >= colStart && cInit <= colEnd &&
		rInit >= rowStart && rInit <= rowEnd) {
		return { col: cInit, row: rInit };
	}
	const maxRad = Math.max(colEnd - colStart, rowEnd - rowStart) + 1;
	for (let rad = 1; rad <= maxRad; rad++) {
		for (let dc = -rad; dc <= rad; dc++) {
			for (let dr = -rad; dr <= rad; dr++) {
				if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
				const c = cInit + dc;
				const r = rInit + dr;
				if (c < colStart || c > colEnd || r < rowStart || r > rowEnd) continue;
				if (!occupied.has(`${c},${r}`)) return { col: c, row: r };
			}
		}
	}
	return null;
}

function placeViaSpiral(
	n: GraphNode,
	cInit: number,
	rInit: number,
	occupied: Set<string>,
	sizedById: Map<string, SizedNode>,
	opts: PhaseGOptions,
	out: PositionedNode[],
): void {
	if (!occupied.has(`${cInit},${rInit}`)) {
		emitNode(n, cInit, rInit, occupied, sizedById, opts, out);
		return;
	}
	for (let rad = 1; rad < 256; rad++) {
		for (let dc = -rad; dc <= rad; dc++) {
			for (let dr = -rad; dr <= rad; dr++) {
				if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
				const c = cInit + dc;
				const r = rInit + dr;
				if (!occupied.has(`${c},${r}`)) {
					emitNode(n, c, r, occupied, sizedById, opts, out);
					return;
				}
			}
		}
	}
}

// region が1グリッドセルにも満たない(setRect が小さすぎる)場合の配置。
// グリッドへスナップせず、shelfPack で region の連続座標を起点に直接
// 詰める — shelfPack は常にゾーン内ノード同士の非重なりを保証するので、
// region が狭くてもこのゾーンの中では重なりが起きない(グリッド量子化と
// 連続座標を混在させていた前の実装は、1ノード目だけ region 中心に正確に
// 置き、残りをグリッドにスナップした spiral fallback に委ねていたため、
// 座標系の不一致で隣接ノードが実際には重なってしまうことがあった)。
function placeTinyRegionShelf(
	nodes: GraphNode[],
	region: { x: number; y: number; w: number; h: number },
	occupied: Set<string>,
	sizedById: Map<string, SizedNode>,
	opts: PhaseGOptions,
	out: PositionedNode[],
): void {
	const sizes: SizedNode[] = nodes.map((n) => {
		const sz = sizedById.get(n.id);
		return {
			id: n.id,
			label: n.label,
			memberships: n.memberships,
			width: sz?.width ?? opts.defaultCardW,
			height: sz?.height ?? opts.defaultCardH,
		};
	});
	const packed = shelfPack(sizes, opts.padPx);
	nodes.forEach((n, i) => {
		const sz = sizes[i];
		const x = region.x + opts.padPx + packed.positions[i].x;
		const y = region.y + opts.padPx + packed.positions[i].y;
		for (const k of cellKeysForBox(x, y, sz.width, sz.height, opts.slotW, opts.slotH)) occupied.add(k);
		const displayMemberships = n.memberships.includes(NONE_BUCKET_KEY)
			? n.memberships.filter((m) => m !== NONE_BUCKET_KEY)
			: n.memberships;
		out.push({
			id: n.id,
			label: n.label,
			memberships: displayMemberships,
			x,
			y,
			width: sz.width,
			height: sz.height,
			mtime: n.mtime,
			fmMaturity: n.fmMaturity,
			ageDays: n.ageDays,
			isPeripheral: n.isPeripheral,
		});
	});
}

function emitNode(
	n: GraphNode,
	col: number,
	row: number,
	occupied: Set<string>,
	sizedById: Map<string, SizedNode>,
	opts: PhaseGOptions,
	out: PositionedNode[],
): void {
	const sz = sizedById.get(n.id);
	const w = sz?.width ?? opts.defaultCardW;
	const h = sz?.height ?? opts.defaultCardH;
	const colSpan = Math.max(1, Math.ceil(w / opts.slotW));
	const rowSpan = Math.max(1, Math.ceil(h / opts.slotH));
	for (let dc = 0; dc < colSpan; dc++) {
		for (let dr = 0; dr < rowSpan; dr++) {
			occupied.add(`${col + dc},${row + dr}`);
		}
	}
	// NONE_BUCKET の memberships は表示時に空配列に戻す (描画側互換)。
	const displayMemberships = n.memberships.includes(NONE_BUCKET_KEY)
		? n.memberships.filter((m) => m !== NONE_BUCKET_KEY)
		: n.memberships;
	out.push({
		id: n.id,
		label: n.label,
		memberships: displayMemberships,
		x: (col + colSpan / 2) * opts.slotW,
		y: (row + rowSpan / 2) * opts.slotH,
		width: w,
		height: h,
		mtime: n.mtime,
		fmMaturity: n.fmMaturity,
		ageDays: n.ageDays,
		isPeripheral: n.isPeripheral,
	});
}
