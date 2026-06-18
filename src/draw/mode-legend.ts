// F5 — pick the legend spec(s) for a mode from its INTRINSIC encoding, unless the
// user bound an encoding (then that wins — it is what the cards actually paint).
import type { ViewMode } from "../types";
import type { LegendSpec } from "./legend-spec";
import type { LegendAnchor } from "./legend-layout";
import { sequentialColorRamp } from "./legend-spec";

export interface ModeLegendInput {
	encodingSpecs: LegendSpec[];                 // from encodingToSpecs(encLegends)
	tags: { key: string; color: string }[];      // distinct tags/clusters present + their hue colour
	counts?: { min: number; max: number };        // for size/gradient ramps
	heatmap?: { jaccard: boolean };
	maxItems?: number;
}

// Amber ramp mirroring the heatmap diagonal (light=small, dark=large tag).
const amberRamp = (t: number): string => `hsl(42, 85%, ${Math.round(80 - Math.max(0, Math.min(1, t)) * 45)}%)`;

// Many stops so the legend bar reads as a SMOOTH gradient (drawLegend samples
// nearest-stop; >=11 stops makes banding invisible).
const rampStops = (f: (t: number) => string): string[] =>
	Array.from({ length: 11 }, (_, i) => f(i / 10));

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

export function buildModeLegend(mode: ViewMode, input: ModeLegendInput): LegendSpec[] {
	if (input.encodingSpecs.length) return input.encodingSpecs; // bound encoding wins
	switch (mode) {
		case "heatmap": {
			const co = input.heatmap?.jaccard ? "Co-occurrence (Jaccard)" : "Co-occurrence";
			return [
				{ title: "Tag size", kind: "gradient", ramp: { stops: rampStops(amberRamp), minLabel: "small", maxLabel: "large" } },
				{ title: co, kind: "gradient", ramp: { stops: rampStops(sequentialColorRamp), minLabel: "low", maxLabel: "high" } },
			];
		}
		case "stream":
			return [tagKey(input, "Row · Tag"), sizeKey("Circle ∝ notes", input)];
		case "upset":
			return [tagKey(input, "Dot · in set"), sizeKey("Bar ∝ set size", input)];
		case "lattice":
			return [sizeKey("Bar ∝ notes", input)];
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
