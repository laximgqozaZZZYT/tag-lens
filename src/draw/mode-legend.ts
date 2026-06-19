// F5 — pick the legend spec(s) for a mode from its INTRINSIC encoding, unless the
// user bound an encoding (then that wins — it is what the cards actually paint).
import type { ViewMode } from "../types";
import type { LegendSpec } from "./legend-spec";
import type { LegendAnchor } from "./legend-layout";

export interface ModeLegendInput {
	encodingSpecs: LegendSpec[];                 // from encodingToSpecs(encLegends)
	// distinct tags/clusters present + their hue colour. `label` (optional) carries
	// the LAYERS & OVERRIDES content (size R×C · n visible · aggregate) when set.
	tags: { key: string; color: string; label?: string }[];
	// Group enclosures (euler/bubblesets): each cluster + the exact enclosure tint.
	groups?: { key: string; label: string; color: string }[];
	// CLOSEUP-only: ∪ / ∩ addressable layers (own NODE_DISPLAY R×C · n · aggregate),
	// surfaced under enclosure modes as their own legend rows. Empty/absent in
	// panorama. Each `label` already carries the resolved suffix.
	setLayers?: { key: string; label: string; color: string | CanvasPattern }[];
	// CLOSEUP perspective flag. In closeup the ∪/∩ set-layers are surfaced as a
	// DISPLAY-INDEPENDENT section (their own spec) in EVERY mode — including the
	// enclosure family — instead of being folded into the single-tag "Groups &
	// overlap" spec. This is purely a DISPLAY-UNIT split: the labels/values are
	// still the resolveSetLayer()-backed suffixes built in view.ts, so single-set
	// settings keep cascading into ∪/∩. Panorama keeps the prior folded layout.
	closeup?: boolean;
	counts?: { min: number; max: number };        // for size/gradient ramps
	heatmap?: { jaccard: boolean; tagMin: number; tagMax: number; coMax: number };
	droste?: {
		focusColor: string;
		intersectionColor: string;
		unionColor: string;
	};
	lattice?: {
		lod: "auto" | "overview" | "density" | "individual";
		effectiveLod?: "overview" | "density" | "individual" | "mixed";
		individualMax: number;
		densityMax: number;
		densityCells: number;
		lodMix?: { overview: number; density: number; individual: number };
		classColors?: {
			overview: { label: string; color: string }[];
			density: { label: string; color: string }[];
			individual: { label: string; color: string }[];
		};
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
	const shown: { label: string; color?: string }[] = input.tags.map((t) => ({ label: t.label ?? t.key, color: t.color }));
	return { title, kind: "categorical", entries: shown };
}

function sizeKey(title: string, input: ModeLegendInput): LegendSpec {
	const lo = input.counts?.min ?? 1, hi = input.counts?.max ?? 1;
	return { title, kind: "size", sizes: [
		{ label: String(lo), radius: 3 },
		{ label: String(hi), radius: 7 },
	] };
}

// Group enclosures: each cluster is the frame drawn around one tag's notes
// (a "group"); overlapping frames mark notes that carry two tags at once (the
// "overlap"). Mirrors draw-enclosures (swatch tint @0.32). Labelled in plain
// words instead of bare ∪/∩ glyphs so the row is legible without a legend-for-
// the-legend.
//
// DISPLAY-UNIT split (closeup): single-tag clusters are the ONLY thing this spec
// represents in closeup — the ∪/∩ set-layers are surfaced as their own
// independent section by `setLayersLegend`, so this spec must NOT also fold them
// in (no duplicate ∪/∩ rows, no "Overlap" row that doubles for ∩). The trailing
// overlap/∪∩ rows are therefore ONLY emitted in panorama, where there is no
// separate addressable set-layer section.
function groupEnclosures(input: ModeLegendInput): LegendSpec {
	const groups = input.groups ?? [];
	const entries: { label: string; color?: string | CanvasPattern }[] = groups
		.map((g) => ({ label: g.label, color: g.color }));
	// No separate addressable set-layer section for enclosure modes, so describe ∪/∩ here.
	// List them with their content alongside single sets.
	const setLayers = input.setLayers ?? [];
	if (setLayers.length) {
		for (const sl of setLayers) entries.push({ label: sl.label, color: sl.color });
	} else {
		entries.push({ label: "Overlap: note shared by 2+ groups" });
	}
	return { title: "Groups & overlap", kind: "categorical", entries };
}

// Union/Intersection are addressable layers DISTINCT from the single-tag
// clusters, surfaced as their own unified "Union / Intersection layers" spec so
// the LAYERS & OVERRIDES content (resolved card size + note count + aggregate
// state) is visible as an INDEPENDENT display unit. Their values are the
// resolveSetLayer()-backed labels view.ts already built — this only changes the
// DISPLAY UNIT (a dedicated row), never the resolution/settings cascade.
//
// Purely additive — the mode's intrinsic specs are never altered.
function setLayersLegend(input: ModeLegendInput): LegendSpec | null {
	const setLayers = input.setLayers ?? [];
	if (!setLayers.length) return null;
	const entries: { label: string; color?: string | CanvasPattern }[] = setLayers.map((sl) => ({ label: sl.label, color: sl.color }));
	return { title: "Union / Intersection layers", kind: "categorical", entries };
}

function drosteSetOps(input: ModeLegendInput): LegendSpec {
	const d = input.droste;
	const entries: { label: string; color?: string }[] = [
		{ label: "Focus note", color: d?.focusColor },
		{ label: "Intersection: has every focus tag", color: d?.intersectionColor },
		{ label: "Union frame: shares a subset of focus tags", color: d?.unionColor },
	];
	return { title: "Gallery key", kind: "categorical", entries };
}

function latticeLegend(input: ModeLegendInput): LegendSpec[] {
	const lat = input.lattice;
	if (!lat) return [sizeKey("Bar ∝ notes", input)];
	if (lat.classColors) {
		const classes: Array<{
			key: "overview" | "density" | "individual";
			title: string;
		}> = [
			{ key: "overview", title: "Overview (bar)" },
			{ key: "density", title: "Density (waffle)" },
			{ key: "individual", title: "Individual (cells)" },
		];
		return classes.map(({ key, title }) => {
			const all = lat.classColors?.[key] ?? [];
			const entries: { label: string; color?: string }[] = all.length
				? all.map((e) => ({ label: e.label, color: e.color }))
				: [{ label: "(none)" }];
			const n = lat.lodMix?.[key] ?? all.length;
			return {
				title: `${title} · ${n} nodes`,
				kind: "categorical" as const,
				entries,
			};
		});
	}
	const minC = Math.max(1, input.counts?.min ?? 1);
	const maxC = Math.max(minC, input.counts?.max ?? minC);
	const perCellMin = Math.max(1, Math.ceil(minC / Math.max(1, lat.densityCells)));
	const perCellMax = Math.max(1, Math.ceil(maxC / Math.max(1, lat.densityCells)));
	const indivCap = Math.max(1, lat.densityCells * 4);
	const eff = lat.effectiveLod ?? lat.lod;
	if (eff === "mixed") {
		const mix = lat.lodMix ?? { overview: 0, density: 0, individual: 0 };
		return [{
			title: "LOD (current zoom)",
			kind: "categorical",
			entries: [
				{ label: `Overview (bar): ${mix.overview}` },
				{ label: `Density (waffle): ${mix.density}` },
				{ label: `Individual (cells): ${mix.individual}` },
			],
		}];
	}

	switch (eff) {
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
		default: {
			const mix = lat.lodMix;
			const entries: { label: string; color?: string }[] = [
				{ label: "1 cell = 1 note" },
				{ label: `Grid cap ${indivCap} cells` },
			];
			if (mix) entries.push({ label: `Now I:${mix.individual} D:${mix.density} O:${mix.overview}` });
			return [{ title: "Cells", kind: "categorical", entries }];
		}
	}
}

export function buildModeLegend(mode: ViewMode, input: ModeLegendInput): LegendSpec[] {
	// Heatmap / Lattice have intrinsic scales/structure. Even when encoding
	// bindings exist globally, these legends must reflect their own view grammar.
	const isEnclosure = mode === "euler" || mode === "euler-true" || mode === "euler-venn" || mode === "bubblesets";
	// ∪/∩ set-layers are surfaced as a DISPLAY-INDEPENDENT "Union / Intersection
	// layers" spec, appended after the intrinsic specs (incl. the bound-encoding
	// early return) so nothing intrinsic changes — strictly additive.
	//   • non-enclosure modes: always append the separate spec (long-standing).
	//   • enclosure modes: keep the folded layout (no separate spec), where ∪/∩
	//     are listed alongside single-set groups.
	const wantSeparateSetLayers = !isEnclosure && mode !== "lattice";
	const extraSetLayers = wantSeparateSetLayers ? setLayersLegend(input) : null;
	const withSetLayers = (specs: LegendSpec[]): LegendSpec[] =>
		extraSetLayers ? [...specs, extraSetLayers] : specs;
	if (mode !== "heatmap" && mode !== "lattice" && mode !== "droste" && !isEnclosure && input.encodingSpecs.length) {
		return withSetLayers(input.encodingSpecs);
	}
	return withSetLayers(buildModeLegendBody(mode, input));
}

function buildModeLegendBody(mode: ViewMode, input: ModeLegendInput): LegendSpec[] {
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
		case "lattice": {
			const out = latticeLegend(input);
			if (input.groups?.length || input.setLayers?.length) out.unshift(groupEnclosures(input));
			return out;
		}
		case "matrix":
			return [tagKey(input, "Dot · Tag")];
		case "droste":
			return [tagKey(input, "Color · Tag"), drosteSetOps(input)];
		case "euler":
		case "euler-true":
		case "euler-venn":
		case "bubblesets": {
			const out: LegendSpec[] = [];
			if (input.groups?.length) out.push(groupEnclosures(input));
			// Node colour key: the bound encoding (what the cards paint) wins, else tags.
			if (input.encodingSpecs.length) out.push(...input.encodingSpecs);
			else out.push(tagKey(input, "Color · Tag"));
			return out;
		}
		case "bipartite":
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
		case "upset":
			return "bottom-right";
		case "droste":
			return "bottom-left";
		default:
			return "bottom-left";
	}
}
