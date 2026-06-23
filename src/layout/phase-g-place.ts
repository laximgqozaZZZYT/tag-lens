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

export interface PhaseGOptions {
	slotW: number;
	slotH: number;
	padPx: number; // 集合矩形内側パディング
	defaultCardW: number;
	defaultCardH: number;
}

// メインエントリ。
export function placeNodesInRegions(
	zones: Zone[],
	setRects: Map<string, RegionRect>,
	sized: SizedNode[],
	opts: PhaseGOptions,
): PositionedNode[] {
	const sizedById = new Map<string, SizedNode>();
	for (const s of sized) sizedById.set(s.id, s);
	const out: PositionedNode[] = [];

	// セル単位 occupancy。"col,row" 文字列キー。
	const occupied = new Set<string>();

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
			// 中心セルに無理やり配置。
			const c = Math.round((region.x + region.w / 2) / opts.slotW);
			const r = Math.round((region.y + region.h / 2) / opts.slotH);
			placeAtCell(z.nodes, c, r, occupied, sizedById, opts, out);
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

function placeAtCell(
	nodes: GraphNode[],
	cInit: number,
	rInit: number,
	occupied: Set<string>,
	sizedById: Map<string, SizedNode>,
	opts: PhaseGOptions,
	out: PositionedNode[],
): void {
	for (const n of nodes) {
		placeViaSpiral(n, cInit, rInit, occupied, sizedById, opts, out);
	}
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
