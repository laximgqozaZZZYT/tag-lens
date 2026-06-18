// F5 — pick the legend spec(s) for a mode from its INTRINSIC encoding, unless the
// user bound an encoding (then that wins — it is what the cards actually paint).
import type { ViewMode } from "../types";
import type { LegendSpec } from "./legend-spec";
import type { LegendAnchor } from "./legend-layout";

export interface ModeLegendInput {
	encodingSpecs: LegendSpec[];                 // from encodingToSpecs(encLegends)
	tags: { key: string; color: string }[];      // distinct tags/clusters present + their hue colour
	counts?: { min: number; max: number };        // for size/gradient ramps
	heatmap?: { jaccard: boolean; tagMin: number; tagMax: number; coMax: number };
	lattice?: {
		lod: "auto" | "overview" | "density" | "individual";
		individualMax: number;
		densityMax: number;
		densityCells: number;
		lodMix?: { overview: number; density: number; individual: number };
	};
	maxItems?: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// Heatmap diagonal in draw-heatmap.ts:
// t = log(size+1)/log(maxSize+1), light = 28 + t*34, hsl(42,85%,light)
const heatmapTagRamp = (t: number): string => `hsl(42, 85%, ${Math.round(28 + clamp01(t) * 34)}%)`;

// Heatmap off-diagonal in draw-heatmap.ts:
// intensity in [0,1], light = 16 + intensity*56, hsl(210,72%,light)
const heatmapCoRamp = (t: number): string => `hsl(210, 72%, ${Math.round(16 + clamp01(t) * 56)}%)`;

// Many stops so the legend bar reads as a SMOOTH gradient (drawLegend samples
// nearest-stop; >=11 stops makes banding invisible).
const rampStops = (f: (t: number) => string): string[] =>
	Array.from({ length: 11 }, (_, i) => f(i / 10));

const fmt = (n: number): string => {
	if (!isFinite(n)) return "—";
	const r = Math.round(n * 100) / 100;
	return Object.is(r, -0) ? "0" : String(r);
};

function tagKey(input: ModeLegendInput, title: string): LegendSpec {
	const max = input.maxItems ?? 8;
	const shown: { label: string; color?: string }[] = input.tags.slice(0, max).map((t) => ({ label: t.key, color: t.color }));
	if (input.tags.length > shown.length) shown.push({ label: `+${input.tags.length - shown.length} more` });
	return { title, kind: "categorical", entries: shown };
}

function sizeKey(title: string, input: ModeLegendInput): LegendSpec {
	const lo = input.counts?.min ?? 1, hi = input.counts?.max ?? 1;
	return { title, kind: "size", sizes: [
		{ label: String(lo), radius: 3 },
		{ label: String(hi), radius: 7 },
	] };
}

function latticeLegend(input: ModeLegendInput): LegendSpec[] {
	const lat = input.lattice;
	if (!lat) return [sizeKey("Bar ∝ notes", input)];
	const minC = Math.max(1, input.counts?.min ?? 1);
	const maxC = Math.max(minC, input.counts?.max ?? minC);
	const perCellMin = Math.max(1, Math.ceil(minC / Math.max(1, lat.densityCells)));
	const perCellMax = Math.max(1, Math.ceil(maxC / Math.max(1, lat.densityCells)));
	const indivCap = Math.max(1, lat.densityCells * 4);

	switch (lat.lod) {
		case "overview":
			return [sizeKey("Bar ∝ notes", input)];
		case "density":
			return [{
				title: "Waffle density",
				kind: "categorical",
				entries: [
					{ label: perCellMin === perCellMax ? `1 cell ≈ ${perCellMin} notes` : `1 cell ≈ ${perCellMin}..${perCellMax} notes` },
					{ label: `Max ${lat.densityCells} cells / node` },
				],
			}];
		case "individual":
			return [{
				title: "Cells",
				kind: "categorical",
				entries: [
					{ label: "1 cell = 1 note" },
					{ label: `Grid cap ${indivCap} cells` },
					{ label: maxC > indivCap ? "Overflow shown as +N" : "No overflow at current max" },
				],
			}];
		case "auto":
		default: {
			const mix = lat.lodMix;
			const entries: { label: string; color?: string }[] = [
				{ label: "effective count = count / zoom" },
				{ label: `≤ ${lat.individualMax}: individual` },
				{ label: `≤ ${lat.densityMax}: density` },
				{ label: `> ${lat.densityMax}: overview` },
			];
			if (mix) entries.push({ label: `Now I:${mix.individual} D:${mix.density} O:${mix.overview}` });
			return [{ title: "LOD (auto)", kind: "categorical", entries }];
		}
	}
}

export function buildModeLegend(mode: ViewMode, input: ModeLegendInput): LegendSpec[] {
	// Heatmap / Lattice have intrinsic scales/structure. Even when encoding
	// bindings exist globally, these legends must reflect their own view grammar.
	if (mode !== "heatmap" && mode !== "lattice" && input.encodingSpecs.length) {
		return input.encodingSpecs;
	}
	switch (mode) {
		case "heatmap": {
			const co = input.heatmap?.jaccard ? "Co-occurrence (Jaccard)" : "Co-occurrence";
			const tagMin = input.heatmap?.tagMin ?? 1;
			const tagMax = input.heatmap?.tagMax ?? 1;
			const coMax = input.heatmap?.jaccard ? 1 : (input.heatmap?.coMax ?? 1);
			return [
				{ title: "Tag size", kind: "gradient", ramp: { stops: rampStops(heatmapTagRamp), minLabel: fmt(tagMin), maxLabel: fmt(tagMax) } },
				{ title: co, kind: "gradient", ramp: { stops: rampStops(heatmapCoRamp), minLabel: "0", maxLabel: fmt(coMax) } },
			];
		}
		case "stream":
			return [tagKey(input, "Row · Tag"), sizeKey("Circle ∝ notes", input)];
		case "upset":
			return [tagKey(input, "Dot · in set"), sizeKey("Bar ∝ set size", input)];
		case "lattice":
			return latticeLegend(input);
		case "matrix":
			return [tagKey(input, "Dot · Tag")];
		case "droste":
		case "euler":
		case "euler-true":
		case "euler-venn":
		case "bipartite":
		case "bubblesets":
		default:
			return [tagKey(input, "Color · Tag")];
	}
}

// Anchor that clears each mode's fixed UI bands: matrix/heatmap have left label
// bands + top headers; stream left+bottom margins; lattice left gutter; droste
// top/left headers; upset a bottom footer + top-right toolbar. Card modes
// (euler*, bipartite, bubblesets) have no fixed bands -> bottom-left (clears the
// top-left meta badges and the top-right toolbar).
export function legendAnchor(mode: ViewMode): LegendAnchor {
	switch (mode) {
		case "matrix":
		case "heatmap":
		case "stream":
		case "lattice":
		case "droste":
		case "upset":
			return "bottom-right";
		default:
			return "bottom-left";
	}
}
