// Scales: turn a node's RAW field value into a normalized ScaledValue.
// Pure (no DOM/Obsidian). Quantitative scales emit { t: 0..1 }; categorical
// scales emit { category, output } where output is a concrete colour string.
// Reuses clusterHue (canvas-utils) for stable auto palettes.
import { clusterHue } from "../canvas-utils";
import type { ScaleConfig, ScaledValue } from "./types";

export interface LegendEntry {
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

// Stable auto colour for a categorical key (same key -> same colour).
export function autoColor(key: string): string {
	return `hsl(${Math.round(clusterHue(key))}, 65%, 55%)`;
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
	const outFor = (key: string): string => palette[key] ?? autoColor(key);
	const seen = new Set<string>();
	const entries: LegendEntry[] = [];
	for (const v of rawValues) {
		if (v == null) continue;
		const key = String(v);
		if (seen.has(key)) continue;
		seen.add(key);
		entries.push({ key, output: outFor(key) });
	}
	if (config.type === "ordinal") entries.sort((a, b) => a.key.localeCompare(b.key));

	return {
		apply: (raw) => {
			if (raw == null) return { missing: true };
			const key = String(raw);
			return { category: key, output: outFor(key) };
		},
		legend: { kind: "categorical", entries },
	};
}
