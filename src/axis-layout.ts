function formatAxisLabel(key: string): string {
	let s = key;
	if (s.startsWith("tag=") || s.startsWith("tag:")) s = s.slice(4);
	try { s = decodeURIComponent(s); } catch (e) { /* ignore decode error */ }
	return s;
}

// Axis-driven layout: place nodes on a Cartesian grid whose X / Y are bound to
// arbitrary attributes (e.g. x=tag, y=links) instead of the uniform lat/lon grid.
// Pure (no DOM/Obsidian) — reuses the Visual Encoding field-sources + scales.
//
// SEPARATION: this only assigns POSITIONS to already-selected nodes; it never
// changes which nodes are shown (same invariant as the encoding draw layer).
// Multi-value attributes (tags) place a node ONCE at its representative value.
import { resolveFieldSource } from "./encoding/field-sources";
import { prepareScale } from "./encoding/scales";
import type { EncNode, EncContext, EncodingBinding, FieldKind, ScaleConfig } from "./encoding/types";

export interface AxisBand {
	key: string;
	label: string;
	start: number;
	end: number;
	center: number;
}
export interface AxisTick {
	pos: number;
	label: string;
}
export interface AxisSpec {
	kind: "categorical" | "quantitative";
	fieldLabel: string;
	bands?: AxisBand[]; // categorical: one band per distinct value
	ticks?: AxisTick[]; // quantitative: gridline ticks
	min?: number;
	max?: number;
}
export interface AxisLayoutResult {
	positions: Map<string, { x: number; y: number }>;
	axes: { x?: AxisSpec; y?: AxisSpec };
}
export interface AxisLayoutOpts {
	bindingX?: EncodingBinding;
	bindingY?: EncodingBinding;
	width: number; // world extent along X
	height: number; // world extent along Y
	cell: { w: number; h: number }; // node pitch used for in-cell packing
	measureText?: (text: string, fontPx: number) => number;
}

function defaultScaleFor(kind: FieldKind): ScaleConfig {
	return kind === "quantitative" || kind === "temporal" ? { type: "linear" } : { type: "categorical" };
}

interface Axis1D {
	spec?: AxisSpec;
	extent: number; // The computed or requested extent
	coordOf: (node: EncNode) => number | null; // world coord along this axis (null = missing)
	cellOf: (node: EncNode) => string; // discrete cell id for packing ("" when unbound)
}

function buildAxis(
	binding: EncodingBinding | undefined,
	nodes: EncNode[],
	ctx: EncContext,
	extent: number,
	cellPitch: number,
	measureText?: (text: string, fontPx: number) => number,
): Axis1D {
	if (!binding || !binding.enabled) return { extent, coordOf: () => null, cellOf: () => "" };
	const field = resolveFieldSource(binding.fieldId);
	if (!field) return { extent, coordOf: () => null, cellOf: () => "" };
	const raws = nodes.map((n) => field.accessor(n, ctx));
	const scale = prepareScale(binding.scale ?? defaultScaleFor(field.kind), raws);

	if (scale.legend.kind === "categorical") {
		const entries = scale.legend.entries ?? [];
		
		// Count node frequencies per category to estimate required grid footprint
		const counts = new Map<string, number>();
		for (const n of nodes) {
			const val = field.accessor(n, ctx);
			if (val != null) {
				const s = String(val);
				counts.set(s, (counts.get(s) ?? 0) + 1);
			}
		}

		let currentPos = 0;
		const bandByKey = new Map<string, AxisBand>();
		const bands: AxisBand[] = entries.map((e) => {
			const label = formatAxisLabel(e.key);
			const k = counts.get(e.key) ?? 0;
			
			// 1. Label width: measure accurately or estimate
			const labelW = measureText ? measureText(label, 14) + 20 : label.length * 10 + 20;
			// 2. Data footprint: square packing of k nodes
			const cols = Math.max(1, Math.ceil(Math.sqrt(k)));
			const dataW = cols * cellPitch;
			
			const requiredW = Math.max(labelW, dataW);
			// Snap to integer multiple of cell pitch to maintain grid alignment
			const bw = Math.ceil(requiredW / cellPitch) * cellPitch;
			
			const band: AxisBand = { key: e.key, label: label, start: currentPos, end: currentPos + bw, center: currentPos + bw / 2 };
			bandByKey.set(e.key, band);
			currentPos += bw;
			return band;
		});

		// Ensure total axis extent is an even multiple of cell pitch
		let totalExtent = currentPos;
		let nSpan = Math.ceil(totalExtent / cellPitch);
		if (nSpan % 2 !== 0) nSpan += 1;
		totalExtent = Math.max(1, nSpan) * cellPitch; // DO NOT use Math.max(extent, ...) so it sizes exactly to contents

		return {
			spec: { kind: "categorical", fieldLabel: field.label, bands },
			extent: totalExtent,
			coordOf: (node) => {
				const raw = field.accessor(node, ctx);
				const band = raw == null ? null : bandByKey.get(String(raw));
				return band ? band.center : null;
			},
			cellOf: (node) => {
				const raw = field.accessor(node, ctx);
				return raw == null ? "·" : String(raw);
			},
		};
	}

	// quantitative
	const min = scale.legend.min ?? 0;
	const max = scale.legend.max ?? 1;
	const ticks: AxisTick[] = [];
	const N = 5;
	for (let i = 0; i <= N; i++) {
		const t = i / N;
		ticks.push({ pos: t * extent, label: (min + (max - min) * t).toFixed(1) });
	}
	return {
		spec: { kind: "quantitative", fieldLabel: field.label, min, max, ticks },
		extent,
		coordOf: (node) => {
			const s = scale.apply(field.accessor(node, ctx));
			return s.missing || s.t == null ? null : s.t * extent;
		},
		cellOf: (node) => {
			const s = scale.apply(field.accessor(node, ctx));
			return s.missing || s.t == null ? "·" : String(Math.round((s.t * extent) / Math.max(1, cellPitch)));
		},
	};
}

export interface AxisLayoutResult {
	positions: Map<string, { x: number; y: number }>;
	axes: { x?: AxisSpec; y?: AxisSpec };
	width: number;
	height: number;
}

export function axisLayout(nodes: EncNode[], ctx: EncContext, opts: AxisLayoutOpts): AxisLayoutResult {
	const ax = buildAxis(opts.bindingX, nodes, ctx, opts.width, opts.cell.w, opts.measureText);
	const ay = buildAxis(opts.bindingY, nodes, ctx, opts.height, opts.cell.h, opts.measureText);

	const outWidth = opts.bindingX?.enabled ? ax.extent : Math.max(opts.width, ax.extent);
	const outHeight = opts.bindingY?.enabled ? ay.extent : Math.max(opts.height, ay.extent);

	// 1. Map each node to its anchor centre (fall back to the canvas centre on a
	//    missing/unbound axis), and bucket by cell for overlap packing.
	const cx0 = outWidth / 2;
	const cy0 = outHeight / 2;
	interface Item { node: EncNode; ax: number; ay: number; cell: string; }
	const items: Item[] = nodes.map((node) => {
		const x = ax.coordOf(node) ?? cx0;
		const y = ay.coordOf(node) ?? cy0;
		return { node, ax: x, ay: y, cell: `${ax.cellOf(node)}|${ay.cellOf(node)}` };
	});

	const byCell = new Map<string, Item[]>();
	for (const it of items) {
		const arr = byCell.get(it.cell);
		if (arr) arr.push(it);
		else byCell.set(it.cell, [it]);
	}

	// 2. Pack each cell's members in a centred grid around the cell anchor (the
	//    average of members' mapped centres) so they don't overlap.
	const positions = new Map<string, { x: number; y: number }>();
	const occupied = new Set<string>();

	const sortedCellKeys = [...byCell.keys()].sort();
	for (const cellKey of sortedCellKeys) {
		const group = byCell.get(cellKey)!;
		
		group.sort((a, b) => {
			const nA = a.node as EncNode & { width?: number; height?: number };
			const nB = b.node as EncNode & { width?: number; height?: number };
			const wA = nA.width ?? opts.cell.w;
			const hA = nA.height ?? opts.cell.h;
			const wB = nB.width ?? opts.cell.w;
			const hB = nB.height ?? opts.cell.h;
			const areaA = wA * hA;
			const areaB = wB * hB;
			if (areaA !== areaB) return areaB - areaA;
			return a.node.id.localeCompare(b.node.id);
		});

		const k = group.length;
		const anchorX = group.reduce((s, g) => s + g.ax, 0) / k;
		const anchorY = group.reduce((s, g) => s + g.ay, 0) / k;

		let targetCol = Math.floor(anchorX / opts.cell.w);
		let targetRow = Math.floor(anchorY / opts.cell.h);

		for (const item of group) {
			const n = item.node as EncNode & { width?: number; height?: number };
			const nodeW = n.width ?? opts.cell.w;
			const nodeH = n.height ?? opts.cell.h;
			const colSpan = Math.max(1, Math.ceil(nodeW / opts.cell.w));
			const rowSpan = Math.max(1, Math.ceil(nodeH / opts.cell.h));

			const initCol = targetCol - Math.floor(colSpan / 2);
			const initRow = targetRow - Math.floor(rowSpan / 2);

			const isBlocked = (c: number, r: number): boolean => {
				for (let dc = 0; dc < colSpan; dc++) {
					for (let dr = 0; dr < rowSpan; dr++) {
						if (occupied.has(`${c + dc},${r + dr}`)) return true;
					}
				}
				return false;
			};

			let col = initCol;
			let row = initRow;
			if (isBlocked(col, row)) {
				outer: for (let radius = 1; radius < 256; radius++) {
					for (let dc = -radius; dc <= radius; dc++) {
						for (let dr = -radius; dr <= radius; dr++) {
							if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
							if (!isBlocked(initCol + dc, initRow + dr)) {
								col = initCol + dc;
								row = initRow + dr;
								break outer;
							}
						}
					}
				}
			}

			for (let dc = 0; dc < colSpan; dc++) {
				for (let dr = 0; dr < rowSpan; dr++) {
					occupied.add(`${col + dc},${row + dr}`);
				}
			}

			const cx = (col + colSpan / 2) * opts.cell.w;
			const cy = (row + rowSpan / 2) * opts.cell.h;
			positions.set(n.id, { x: cx, y: cy });
		}
	}

	return { positions, axes: { x: ax.spec, y: ay.spec }, width: outWidth, height: outHeight };
}
