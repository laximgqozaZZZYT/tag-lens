// F4 — pure on-canvas legend layout. Turns the encoding's BindingLegend[] into a
// positioned box (sizes computed via an injected text measurer) that the renderer
// paints in screen space. DOM-free + measurer-injected so it unit-tests in Node.
import type { BindingLegend } from "../encoding/evaluate";
import { shapeForKey, type NodeShape } from "../encoding/shapes";

export interface LegendItem {
	label: string;
	color?: string;
	shape?: NodeShape;
	// Absolute offset from the box's top-left (px). Marker centre is at
	// (x + swatch/2, y + swatch/2).
	x: number;
	y: number;
}
export interface LegendSection {
	title: string;
	kind: "categorical" | "quantitative";
	items: LegendItem[];
	min?: number;
	max?: number;
	gradient?: boolean;
	titleY: number;
}
export interface LegendBox {
	width: number;
	height: number;
	sections: LegendSection[];
}

export interface LegendLayoutOpts {
	measure: (text: string) => number; // caller pre-binds the font
	fontPx?: number;
	swatch?: number;
	padX?: number;
	padY?: number;
	rowGap?: number;
	sectionGap?: number;
	maxItemsPerSection?: number;
}

const fmtNum = (n: number): string => {
	if (!isFinite(n)) return "—";
	const r = Math.round(n * 100) / 100;
	return Object.is(r, -0) ? "0" : String(r);
};

// Channels that paint a shape glyph instead of a colour swatch in the legend.
const SHAPE_CHANNELS = new Set(["shape"]);

export function buildLegendBox(legends: BindingLegend[], opts: LegendLayoutOpts): LegendBox {
	const fontPx = opts.fontPx ?? 11;
	const swatch = opts.swatch ?? 10;
	const padX = opts.padX ?? 8;
	const padY = opts.padY ?? 6;
	const rowGap = opts.rowGap ?? 4;
	const sectionGap = opts.sectionGap ?? 6;
	const maxItems = opts.maxItemsPerSection ?? 8;
	const lineH = Math.max(fontPx, swatch);

	const sections: LegendSection[] = [];
	let y = padY;
	let maxContentW = 0;

	for (const lg of legends) {
		const isShape = SHAPE_CHANNELS.has(lg.channelId);
		const title = `${capitalize(lg.channelId)} · ${lg.fieldLabel}`;
		const titleY = y;
		maxContentW = Math.max(maxContentW, opts.measure(title));
		y += fontPx + rowGap;

		const section: LegendSection = { title, kind: lg.legend.kind === "quantitative" ? "quantitative" : "categorical", items: [], titleY };

		if (lg.legend.kind === "quantitative") {
			section.min = lg.legend.min;
			section.max = lg.legend.max;
			section.gradient = true;
			const label = `${fmtNum(lg.legend.min ?? 0)} … ${fmtNum(lg.legend.max ?? 0)}`;
			section.items.push({ label, x: 0, y, color: undefined, shape: undefined });
			maxContentW = Math.max(maxContentW, swatch * 4 + 6 + opts.measure(label));
			y += lineH + rowGap;
		} else {
			const entries = lg.legend.entries ?? [];
			const shown = entries.slice(0, maxItems);
			for (const e of shown) {
				const item: LegendItem = { label: e.key, x: 0, y };
				if (isShape) item.shape = shapeForKey(e.key);
				else item.color = e.output;
				section.items.push(item);
				maxContentW = Math.max(maxContentW, swatch + 6 + opts.measure(e.key));
				y += lineH + rowGap;
			}
			if (entries.length > shown.length) {
				const more = `+${entries.length - shown.length} more`;
				section.items.push({ label: more, x: 0, y });
				maxContentW = Math.max(maxContentW, swatch + 6 + opts.measure(more));
				y += lineH + rowGap;
			}
		}
		y += sectionGap;
		sections.push(section);
	}

	// Trim the trailing sectionGap; add bottom padding.
	if (sections.length) y -= sectionGap;
	const width = Math.ceil(maxContentW + padX * 2);
	const height = Math.ceil(y + padY);
	return { width, height, sections };
}

function capitalize(s: string): string {
	return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
