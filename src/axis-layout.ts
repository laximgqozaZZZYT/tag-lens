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
}

function defaultScaleFor(kind: FieldKind): ScaleConfig {
	return kind === "quantitative" || kind === "temporal" ? { type: "linear" } : { type: "categorical" };
}

interface Axis1D {
	spec?: AxisSpec;
	coordOf: (node: EncNode) => number | null; // world coord along this axis (null = missing)
	cellOf: (node: EncNode) => string; // discrete cell id for packing ("" when unbound)
}

function buildAxis(
	binding: EncodingBinding | undefined,
	nodes: EncNode[],
	ctx: EncContext,
	extent: number,
	cellPitch: number,
): Axis1D {
	if (!binding || !binding.enabled) return { coordOf: () => null, cellOf: () => "" };
	const field = resolveFieldSource(binding.fieldId);
	if (!field) return { coordOf: () => null, cellOf: () => "" };
	const raws = nodes.map((n) => field.accessor(n, ctx));
	const scale = prepareScale(binding.scale ?? defaultScaleFor(field.kind), raws);

	if (scale.legend.kind === "categorical") {
		const entries = scale.legend.entries ?? [];
		const bw = extent / Math.max(1, entries.length);
		const bandByKey = new Map<string, AxisBand>();
		const bands: AxisBand[] = entries.map((e, i) => {
			const band: AxisBand = { key: e.key, label: e.key, start: i * bw, end: (i + 1) * bw, center: i * bw + bw / 2 };
			bandByKey.set(e.key, band);
			return band;
		});
		return {
			spec: { kind: "categorical", fieldLabel: field.label, bands },
			coordOf: (node) => {
				const raw = field.accessor(node, ctx);
				return raw == null ? null : (bandByKey.get(String(raw))?.center ?? null);
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

export function axisLayout(nodes: EncNode[], ctx: EncContext, opts: AxisLayoutOpts): AxisLayoutResult {
	const ax = buildAxis(opts.bindingX, nodes, ctx, opts.width, opts.cell.w);
	const ay = buildAxis(opts.bindingY, nodes, ctx, opts.height, opts.cell.h);

	// 1. Map each node to its anchor centre (fall back to the canvas centre on a
	//    missing/unbound axis), and bucket by cell for overlap packing.
	const cx0 = opts.width / 2;
	const cy0 = opts.height / 2;
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
	for (const group of byCell.values()) {
		const k = group.length;
		let anchorX = group.reduce((s, g) => s + g.ax, 0) / k;
		let anchorY = group.reduce((s, g) => s + g.ay, 0) / k;
		
		// Snap the anchor to the nearest cell lattice intersection.
		// This guarantees that all nodes in the packed grid fall perfectly on integer multiples of slotW/slotH,
		// preventing misalignment with edge routing channels and cluster enclosures.
		anchorX = Math.round(anchorX / opts.cell.w) * opts.cell.w;
		anchorY = Math.round(anchorY / opts.cell.h) * opts.cell.h;

		const cols = Math.ceil(Math.sqrt(k));
		const rows = Math.ceil(k / cols);
		group.forEach((g, i) => {
			const col = i % cols;
			const row = Math.floor(i / cols);
			const ox = (col - (cols - 1) / 2) * opts.cell.w;
			const oy = (row - (rows - 1) / 2) * opts.cell.h;
			positions.set(g.node.id, { x: anchorX + ox, y: anchorY + oy });
		});
	}

	return { positions, axes: { x: ax.spec, y: ay.spec } };
}
