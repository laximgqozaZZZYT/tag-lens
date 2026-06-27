// Scales: turn a node's RAW field value into a normalized ScaledValue.
// Pure (no DOM/Obsidian). Quantitative scales emit { t: 0..1 }; categorical
// scales emit { category, output } where output is a concrete colour string.
// Reuses clusterHue (canvas-utils) for stable auto palettes.
import { clusterHue } from "../draw/canvas-utils";
import type { ScaleConfig, ScaledValue } from "./types";

interface LegendEntry {
	key: string;
	output: string;
}
export interface LegendInfo {
	kind: "categorical" | "quantitative" | "none";
	entries?: LegendEntry[];
	min?: number;
	max?: number;
	reversed?: boolean;
}
export interface PreparedScale {
	apply: (raw: string | number | null) => ScaledValue;
	legend: LegendInfo;
}

// Per-key auto colour (same key -> same colour). Kept as a defensive fallback for
// keys not present when the scale was prepared; reuses clusterHue which is tuned
// for TAG NAMES and clusters for short/numeric keys — see categoricalColor.
function autoColor(key: string): string {
	return `hsl(${Math.round(clusterHue(key))}, 65%, 55%)`;
}

const GOLDEN_ANGLE = 137.50776405003785;

// Evenly-distributed, maximally-distinct categorical colour BY INDEX. Successive
// indices land ~137.5° apart on the hue wheel (golden angle) so neighbours never
// collapse — unlike autoColor's per-key hash, which maps numeric keys "0".."9" to
// near-identical greens (hue 109-139). A 3-band lightness cycle keeps even
// hue-near neighbours (large N) separable. The categorical scale assigns these by
// the key's position in the distinct-value list, so the legend and the nodes that
// share that one map always correspond.
function categoricalColor(i: number): string {
	const hue = Math.round(((i * GOLDEN_ANGLE) % 360 + 360) % 360);
	const light = [56, 48, 64][i % 3];
	return `hsl(${hue}, 65%, ${light}%)`;
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
	return sorted[idx];
}

function isQuantType(t: ScaleConfig["type"]): boolean {
	return t === "linear" || t === "log" || t === "quantile";
}

// Precompute a scale over the dataset's raw values, then `apply` per node.
export function prepareScale(config: ScaleConfig, rawValues: (string | number | null)[]): PreparedScale {
	if (isQuantType(config.type)) {
		const nums = rawValues
			.filter((v): v is number => typeof v === "number" && isFinite(v))
			.sort((a, b) => a - b);
		let min = nums.length ? nums[0] : 0;
		let max = nums.length ? nums[nums.length - 1] : 1;
		if (Array.isArray(config.domain)) {
			[min, max] = config.domain;
		} else if (config.clampPctl != null && nums.length) {
			max = percentile(nums, config.clampPctl);
		}
		if (max <= min) max = min + 1; // avoid divide-by-zero
		const reverse = !!config.reverse;

		const norm = (raw: number): number => {
			const r = Math.max(min, Math.min(max, raw));
			let t: number;
			if (config.type === "log") {
				const denom = Math.log(max - min + 1) || 1;
				t = Math.log(r - min + 1) / denom;
			} else if (config.type === "quantile") {
				// fraction of dataset values <= raw (binary search upper bound)
				let lo = 0,
					hi = nums.length;
				while (lo < hi) {
					const mid = (lo + hi) >> 1;
					if (nums[mid] <= raw) lo = mid + 1;
					else hi = mid;
				}
				t = nums.length ? lo / nums.length : 0;
			} else {
				t = (r - min) / (max - min);
			}
			t = Math.max(0, Math.min(1, t));
			return reverse ? 1 - t : t;
		};

		return {
			apply: (raw) =>
				typeof raw === "number" && isFinite(raw) ? { t: norm(raw) } : { missing: true },
			legend: { kind: "quantitative", min, max, reversed: reverse },
		};
	}

	// categorical / ordinal
	const palette = config.palette ?? {};
	const seen = new Set<string>();
	const distinct: string[] = [];
	for (const v of rawValues) {
		if (v == null) continue;
		const key = String(v);
		if (seen.has(key)) continue;
		seen.add(key);
		distinct.push(key);
	}
	if (config.type === "ordinal") distinct.sort((a, b) => a.localeCompare(b));

	// Assign a distinct colour to each category BY INDEX (palette overrides win),
	// then resolve BOTH the legend entries and per-node apply() through this one
	// map — so a displayed node and its legend swatch can never disagree.
	const colorByKey = new Map<string, string>();
	distinct.forEach((key, i) => { colorByKey.set(key, palette[key] ?? categoricalColor(i)); });
	const outFor = (key: string): string => colorByKey.get(key) ?? palette[key] ?? autoColor(key);
	const entries: LegendEntry[] = distinct.map((key) => ({ key, output: outFor(key) }));

	return {
		apply: (raw) => {
			if (raw == null) return { missing: true };
			const key = String(raw);
			return { category: key, output: outFor(key) };
		},
		legend: { kind: "categorical", entries },
	};
}
