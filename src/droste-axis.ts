// Icon Gallery (droste) custom-axis Cartesian layout.
//
// droste tiles one icon per note on an integer (col,row) grid. By default that
// grid is a contact-sheet (col = i % cols). This module RE-ASSIGNS each cell's
// (col,row) from bound axes (Encode → Position X / Position Y), turning the
// gallery into a Cartesian scatter of icons with variable-width bands.
//
// SEPARATION OF CONCERNS (non-negotiable): this only moves cells; it NEVER adds,
// drops, or de-duplicates cells. Every input cell appears exactly once in the
// output at a unique (col,row). When NO axis is bound the caller keeps the
// default tiling — this module is a no-op path then.
//
// Pure (no DOM/Obsidian) — reuses the Visual Encoding field-sources + scales so
// the same attributes/scales available to card-mode axes work here.
import { resolveFieldSource } from "./encoding/field-sources";
import { prepareScale } from "./encoding/scales";
import type { AxisBand, AxisSpec, AxisTick } from "./axis-layout";
import type { GalleryCell } from "./droste-layout";
import type { EncContext, EncNode, EncodingBinding, FieldKind, ScaleConfig } from "./encoding/types";

function formatAxisLabel(key: string): string {
	let s = key;
	if (s.startsWith("tag=") || s.startsWith("tag:")) s = s.slice(4);
	try {
		s = decodeURIComponent(s);
	} catch {
		/* leave as-is */
	}
	return s;
}

function defaultScaleFor(kind: FieldKind): ScaleConfig {
	return kind === "quantitative" || kind === "temporal" ? { type: "linear" } : { type: "categorical" };
}

const QUANT_BINS = 8; // quantitative axes → this many discrete columns/rows

// One discrete axis: maps a node to a non-negative integer BUCKET index, plus
// ordered bucket metadata (keys + labels) for band/tick rendering. `buckets`
// lists indices 0..n-1 in display order. `boundary?` (quantitative) gives the
// value at each bin boundary for tick labels.
interface DiscreteAxis {
	bound: boolean;
	kind: "categorical" | "quantitative";
	fieldLabel: string;
	count: number; // number of buckets (≥1)
	bucketOf: (node: EncNode) => number; // 0..count-1
	labelOf: (bucket: number) => string; // bucket → display label
	// quantitative bin value range, for tick labels
	min?: number;
	max?: number;
}

const UNBOUND: DiscreteAxis = {
	bound: false,
	kind: "categorical",
	fieldLabel: "",
	count: 1,
	bucketOf: () => 0,
	labelOf: () => "",
};

function buildDiscreteAxis(binding: EncodingBinding | undefined, nodes: EncNode[], ctx: EncContext): DiscreteAxis {
	if (!binding || !binding.enabled) return UNBOUND;
	const field = resolveFieldSource(binding.fieldId);
	if (!field) return UNBOUND;
	const raws = nodes.map((n) => field.accessor(n, ctx));
	const scale = prepareScale(binding.scale ?? defaultScaleFor(field.kind), raws);

	if (scale.legend.kind === "categorical") {
		const entries = scale.legend.entries ?? [];
		// One column/row per distinct category, in encounter order. A trailing
		// "missing" bucket holds nodes whose value is null (so every cell still
		// lands somewhere — no cell is ever dropped).
		const idxByKey = new Map<string, number>();
		entries.forEach((e, i) => idxByKey.set(e.key, i));
		const missingIdx = entries.length; // last bucket (may be unused)
		let usedMissing = false;
		const bucketOf = (node: EncNode): number => {
			const raw = field.accessor(node, ctx);
			if (raw == null) {
				usedMissing = true;
				return missingIdx;
			}
			const i = idxByKey.get(String(raw));
			if (i == null) {
				usedMissing = true;
				return missingIdx;
			}
			return i;
		};
		// Pre-scan to learn whether the missing bucket is actually needed.
		for (const n of nodes) bucketOf(n);
		const count = entries.length + (usedMissing ? 1 : 0);
		return {
			bound: true,
			kind: "categorical",
			fieldLabel: field.label,
			count: Math.max(1, count),
			bucketOf,
			labelOf: (b) => (b < entries.length ? formatAxisLabel(entries[b].key) : "(none)"),
		};
	}

	// Quantitative → bin the normalized t∈[0,1] into QUANT_BINS columns/rows.
	// floor(t*N) with the t===1 edge folded into the last bin. Missing values go
	// to a trailing extra bucket so the cell is still placed.
	const min = scale.legend.min ?? 0;
	const max = scale.legend.max ?? 1;
	let usedMissing = false;
	const bucketOf = (node: EncNode): number => {
		const s = scale.apply(field.accessor(node, ctx));
		if (s.missing || s.t == null) {
			usedMissing = true;
			return QUANT_BINS; // trailing missing bucket
		}
		return Math.min(QUANT_BINS - 1, Math.floor(s.t * QUANT_BINS));
	};
	for (const n of nodes) bucketOf(n);
	const count = QUANT_BINS + (usedMissing ? 1 : 0);
	return {
		bound: true,
		kind: "quantitative",
		fieldLabel: field.label,
		count,
		min,
		max,
		bucketOf,
		labelOf: (b) => {
			if (b >= QUANT_BINS) return "(none)";
			const lo = min + ((max - min) * b) / QUANT_BINS;
			return lo.toFixed(1);
		},
	};
}

export interface GalleryAxisResult {
	cols: number;
	rows: number;
	// (col,row) for each cell id — caller writes these onto gallery.cells.
	pos: Map<string, { col: number; row: number }>;
	axes: { x?: AxisSpec; y?: AxisSpec };
}

// Re-assign (col,row) for every gallery cell from the bound axes. Caller must
// provide one EncNode per cell (same id). Returns new positions + the grid
// extent + AxisSpecs (band/tick geometry in COLUMN/ROW units; the renderer
// multiplies by cellSize for world coords).
//
// Layout: bucketX → a band of columns, bucketY → a band of rows. Each
// (bucketX,bucketY) intersection holds a packed sub-grid of its members; a
// band's width is the widest sub-grid in its column (height = tallest in its
// row), so bands have variable size and members never overlap or cross bands.
export function assignGalleryAxes(
	cells: GalleryCell[],
	nodeFor: (id: string) => EncNode,
	ctx: EncContext,
	bindingX: EncodingBinding | undefined,
	bindingY: EncodingBinding | undefined,
): GalleryAxisResult {
	const ax = buildDiscreteAxis(bindingX, cells.map((c) => nodeFor(c.id)), ctx);
	const ay = buildDiscreteAxis(bindingY, cells.map((c) => nodeFor(c.id)), ctx);

	// 1. Bucket every cell by (bx,by). Preserve input order within a bucket for
	//    deterministic, stable packing.
	interface Bucket {
		bx: number;
		by: number;
		ids: string[];
	}
	const bucketMap = new Map<string, Bucket>();
	for (const cell of cells) {
		const node = nodeFor(cell.id);
		const bx = ax.bound ? ax.bucketOf(node) : 0;
		const by = ay.bound ? ay.bucketOf(node) : 0;
		const key = `${bx}|${by}`;
		let b = bucketMap.get(key);
		if (!b) {
			b = { bx, by, ids: [] };
			bucketMap.set(key, b);
		}
		b.ids.push(cell.id);
	}

	// 2. Per-bucket sub-grid dimensions. When only one axis is bound, the
	//    unbound axis collapses to a single bucket, so its sub-grid spreads in a
	//    near-square — but we bias the spread along the UNBOUND axis so the bound
	//    axis stays a clean 1-wide band per category where possible.
	const subDim = (n: number): { w: number; h: number } => {
		if (n <= 0) return { w: 1, h: 1 };
		const w = Math.max(1, Math.ceil(Math.sqrt(n)));
		const h = Math.max(1, Math.ceil(n / w));
		return { w, h };
	};

	// bucketSub: key → {w,h}; also track per-column max width, per-row max height.
	const colCount = ax.bound ? ax.count : 1;
	const rowCount = ay.bound ? ay.count : 1;
	const colW = new Array<number>(colCount).fill(1);
	const rowH = new Array<number>(rowCount).fill(1);
	const subOf = new Map<string, { w: number; h: number }>();

	for (const [key, b] of bucketMap) {
		let w: number, h: number;
		if (ax.bound && ay.bound) {
			const d = subDim(b.ids.length);
			w = d.w;
			h = d.h;
		} else if (ax.bound) {
			// Y unbound: stack this band's members vertically (1 wide), so the X
			// band stays a single column.
			w = 1;
			h = Math.max(1, b.ids.length);
		} else {
			// X unbound: lay this row out horizontally (1 tall).
			w = Math.max(1, b.ids.length);
			h = 1;
		}
		subOf.set(key, { w, h });
		if (w > colW[b.bx]) colW[b.bx] = w;
		if (h > rowH[b.by]) rowH[b.by] = h;
	}

	// 3. Prefix offsets → each column/row band's start position.
	const colStart = new Array<number>(colCount).fill(0);
	for (let i = 1; i < colCount; i++) colStart[i] = colStart[i - 1] + colW[i - 1];
	const rowStart = new Array<number>(rowCount).fill(0);
	for (let i = 1; i < rowCount; i++) rowStart[i] = rowStart[i - 1] + rowH[i - 1];
	const totalCols = colCount ? colStart[colCount - 1] + colW[colCount - 1] : 1;
	const totalRows = rowCount ? rowStart[rowCount - 1] + rowH[rowCount - 1] : 1;

	// 4. Place each bucket's members in its sub-grid, anchored at the band start.
	const pos = new Map<string, { col: number; row: number }>();
	for (const [key, b] of bucketMap) {
		const sub = subOf.get(key)!;
		const c0 = colStart[b.bx];
		const r0 = rowStart[b.by];
		b.ids.forEach((id, i) => {
			const sc = i % sub.w;
			const sr = Math.floor(i / sub.w);
			pos.set(id, { col: c0 + sc, row: r0 + sr });
		});
	}

	// 5. Build AxisSpecs (band/tick geometry in COLUMN/ROW units).
	const buildSpec = (axis: DiscreteAxis, starts: number[], widths: number[], count: number): AxisSpec | undefined => {
		if (!axis.bound) return undefined;
		if (axis.kind === "categorical") {
			const bands: AxisBand[] = [];
			for (let i = 0; i < count; i++) {
				const start = starts[i];
				const end = starts[i] + widths[i];
				bands.push({ key: String(i), label: axis.labelOf(i), start, end, center: (start + end) / 2 });
			}
			return { kind: "categorical", fieldLabel: axis.fieldLabel, bands };
		}
		// quantitative: a tick at each bin boundary (band start), labelled by value.
		const ticks: AxisTick[] = [];
		for (let i = 0; i < count; i++) ticks.push({ pos: starts[i], label: axis.labelOf(i) });
		// closing tick at the far edge
		const lastEnd = count ? starts[count - 1] + widths[count - 1] : 0;
		ticks.push({ pos: lastEnd, label: axis.max != null ? axis.max.toFixed(1) : "" });
		return { kind: "quantitative", fieldLabel: axis.fieldLabel, ticks, min: axis.min, max: axis.max };
	};

	return {
		cols: Math.max(1, totalCols),
		rows: Math.max(1, totalRows),
		pos,
		axes: {
			x: buildSpec(ax, colStart, colW, colCount),
			y: buildSpec(ay, rowStart, rowH, rowCount),
		},
	};
}
