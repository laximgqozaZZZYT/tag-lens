// F1-1 — pure (de)serialization for Lens/Encoding presets. No DOM, no settings
// mutation, never throws on bad input: parsePresets collects errors and returns
// whatever valid presets it could recover. The UI layer (Data ▸ JSON) drives it.
import type { LensPreset } from "../types";
import { validatePresetName } from "./lens-presets";

export const PRESET_SCHEMA = "tag-lens/presets";
export const PRESET_SCHEMA_VERSION = 1;

export interface PresetBundle {
	schema: string;
	version: number;
	presets: LensPreset[];
}

// Query fields that MUST be arrays / a string for a preset to be applyLens-safe.
const QUERY_ARRAY_KEYS = ["selectedBases"] as const;

// Pretty-printed bundle, suitable for a textarea or a .json file in the vault.
export function serializePresets(presets: LensPreset[]): string {
	const bundle: PresetBundle = {
		schema: PRESET_SCHEMA,
		version: PRESET_SCHEMA_VERSION,
		presets,
	};
	return JSON.stringify(bundle, null, 2);
}

function pad2(n: number): string {
	return n < 10 ? `0${n}` : `${n}`;
}

// `tag-lens-presets-YYYYMMDD-HHmmss.json`. Distinct from the PNG exportFileName
// (which hardcodes .png) so image and preset exports never collide.
export function presetFileName(d: Date): string {
	const stamp =
		`${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
		`-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
	return `tag-lens-presets-${stamp}.json`;
}

// Merge imported presets into the existing list: an incoming preset with the
// same name OVERWRITES the existing one (it's the user's own export being
// re-imported), new names are appended. Returns a new array; inputs untouched.
export function mergePresets(existing: LensPreset[], incoming: LensPreset[]): LensPreset[] {
	const result = [...existing];
	for (const p of incoming) {
		const i = result.findIndex((e) => e.name === p.name);
		if (i >= 0) result[i] = p;
		else result.push(p);
	}
	return result;
}

export interface ParseResult {
	presets: LensPreset[];
	errors: string[];
}

// Tolerant parse. Accepts either a bundle {schema,version,presets:[]} or a bare
// array of presets. Each preset is validated independently; a bad one becomes an
// error string and is skipped, the rest are kept.
export function parsePresets(json: string): ParseResult {
	const errors: string[] = [];
	let root: unknown;
	try {
		root = JSON.parse(json);
	} catch (e) {
		return { presets: [], errors: [`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`] };
	}

	let rawList: unknown;
	if (Array.isArray(root)) {
		rawList = root;
	} else if (root && typeof root === "object" && "presets" in root) {
		const b = root as Record<string, unknown>;
		if (b.schema !== undefined && b.schema !== PRESET_SCHEMA) {
			errors.push(`Unexpected schema "${String(b.schema)}" (expected "${PRESET_SCHEMA}").`);
		}
		rawList = b.presets;
	} else {
		return { presets: [], errors: ["JSON is not a preset bundle or a preset array."] };
	}

	if (!Array.isArray(rawList)) {
		return { presets: [], errors: ["`presets` is not an array."] };
	}

	const out: LensPreset[] = [];
	rawList.forEach((item, i) => {
		const v = validateOnePreset(item, i);
		if (typeof v === "string") errors.push(v);
		else out.push(v);
	});
	return { presets: out, errors };
}

// Returns a validated LensPreset or an error message string. Forward-compatible:
// an optional `encoding` array (added by F1-2) is passed through when present,
// and unknown fields on the preset are dropped.
function validateOnePreset(item: unknown, index: number): LensPreset | string {
	const where = `preset #${index + 1}`;
	if (!item || typeof item !== "object") return `${where}: not an object.`;
	const p = item as Record<string, unknown>;

	if (typeof p.name !== "string") return `${where}: missing string "name".`;
	const nameErr = validatePresetName(p.name, []);
	if (nameErr) return `${where}: ${nameErr}`;

	const q = p.query;
	if (!q || typeof q !== "object") return `${where} ("${p.name}"): missing "query" object.`;
	const query = q as Record<string, unknown>;
	for (const k of QUERY_ARRAY_KEYS) {
		if (!Array.isArray(query[k])) return `${where} ("${p.name}"): query.${k} must be an array.`;
	}
	if (typeof query.viewMode !== "string") {
		return `${where} ("${p.name}"): query.viewMode must be a string.`;
	}

	const preset: LensPreset = { name: p.name, query: query as LensPreset["query"] };
	// Forward-compat (F1-2): carry an encoding array through round-trips.
	if (Array.isArray((p as { encoding?: unknown }).encoding)) {
		(preset as { encoding?: unknown[] }).encoding = (p as { encoding: unknown[] }).encoding;
	}
	return preset;
}
