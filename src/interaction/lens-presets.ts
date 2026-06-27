import type { MiniSettings, LensPreset, LensQuerySettings } from "../types";
import type { EncodingBinding } from "../encoding/types";

// Deep-copy an encoding array so a preset and the live settings never share
// nested binding/scale references. Encoding is plain config data (no functions),
// so a JSON round-trip is a safe, total clone.
function cloneEncoding(enc: EncodingBinding[]): EncodingBinding[] {
	return JSON.parse(JSON.stringify(enc)) as EncodingBinding[];
}

/**
 * Extracts the query-related settings from the current application settings
 * into a self-contained preset object. Arrays are deep-copied.
 */
export function captureLens(settings: MiniSettings): LensQuerySettings {
	return {
		viewMode: settings.viewMode,
		selectedBases: [...settings.selectedBases],
		basesLinkEdges: settings.basesLinkEdges,
		basesSharedTagEdges: settings.basesSharedTagEdges,
		basesSharedPropEdges: settings.basesSharedPropEdges,
		basesClusterByView: settings.basesClusterByView,
	};
}

/**
 * Captures the full current view — query settings AND the Visual Encoding
 * snapshot — into a self-contained preset. All arrays/objects are deep-copied.
 */
export function capturePreset(settings: MiniSettings, name: string): LensPreset {
	return { name, query: captureLens(settings), encoding: cloneEncoding(settings.encoding) };
}

/**
 * Applies a preset's query settings to the target settings object.
 * Arrays are deep-copied to prevent reference sharing. If the preset carries an
 * encoding snapshot it is applied too; legacy query-only presets leave the
 * current encoding untouched.
 */
export function applyLens(settings: MiniSettings, preset: LensPreset): void {
	const q = preset.query;
	settings.viewMode = q.viewMode;
	settings.selectedBases = [...q.selectedBases];
	settings.basesLinkEdges = q.basesLinkEdges;
	settings.basesSharedTagEdges = q.basesSharedTagEdges;
	settings.basesSharedPropEdges = q.basesSharedPropEdges;
	settings.basesClusterByView = q.basesClusterByView;
	if (Array.isArray(preset.encoding)) {
		settings.encoding = cloneEncoding(preset.encoding);
	}
}

/**
 * Adds a new preset or replaces an existing one with the same name.
 * Order of existing presets is maintained; new presets are appended.
 */
export function upsertPreset(
	presets: LensPreset[],
	name: string,
	query: LensQuerySettings,
	encoding?: EncodingBinding[]
): LensPreset[] {
	const result = [...presets];
	const entry: LensPreset = { name, query: captureLens({ ...query } as MiniSettings) };
	if (Array.isArray(encoding)) entry.encoding = cloneEncoding(encoding);
	const index = result.findIndex((p) => p.name === name);
	if (index >= 0) result[index] = entry;
	else result.push(entry);
	return result;
}

/**
 * Removes a preset by name.
 */
export function removePreset(presets: LensPreset[], name: string): LensPreset[] {
	return presets.filter((p) => p.name !== name);
}

/**
 * Validates a preset name.
 * Returns an error message if invalid, or null if valid.
 */
export function validatePresetName(name: string, _existing: LensPreset[]): string | null {
	const trimmed = name.trim();
	if (trimmed.length === 0) {
		return "Preset name cannot be empty.";
	}
	return null;
}
