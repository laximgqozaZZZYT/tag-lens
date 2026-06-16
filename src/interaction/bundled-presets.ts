// F1-3 — bundled starter presets. Pure data: a handful of query lenses across
// the main view modes so a fresh vault has something to click. They carry NO
// encoding snapshot (legacy query-only shape) on purpose, so applying one never
// wipes the user's current Visual Encoding. Offered via Data ▸ JSON (not
// auto-injected into settings — no silent migration).
import type { LensPreset } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { captureLens } from "./lens-presets";

// Base query = the app defaults; each preset only overrides the view mode.
const base = (): LensPreset["query"] => captureLens(DEFAULT_SETTINGS);

export const BUNDLED_PRESETS: LensPreset[] = [
	{ name: "Tag Overview (Euler)", query: { ...base(), viewMode: "euler" } },
	{ name: "Co-occurrence Heatmap", query: { ...base(), viewMode: "heatmap" } },
	{ name: "Intersection Lattice", query: { ...base(), viewMode: "lattice" } },
	{ name: "Icon Gallery", query: { ...base(), viewMode: "droste" } },
	{ name: "UpSet Plot", query: { ...base(), viewMode: "upset" } },
];

// Append the bundled presets that aren't already present (matched by name), so a
// user's own preset with the same name is never overwritten. Returns a new array.
export function mergeBundled(existing: LensPreset[]): LensPreset[] {
	const names = new Set(existing.map((p) => p.name));
	const additions = BUNDLED_PRESETS.filter((p) => !names.has(p.name));
	return [...existing, ...additions];
}
