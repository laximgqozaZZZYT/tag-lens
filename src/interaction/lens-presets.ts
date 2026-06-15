import type { MiniSettings, LensPreset, LensQuerySettings } from "../types";

/**
 * Extracts the query-related settings from the current application settings
 * into a self-contained preset object. Arrays are deep-copied.
 */
export function captureLens(settings: MiniSettings): LensQuerySettings {
	return {
		filterMode: settings.filterMode,
		dvjsFilter: settings.dvjsFilter,
		where: [...settings.where],
		groupBy: [...settings.groupBy],
		having: [...settings.having],
		limit: [...settings.limit],
		orderField: settings.orderField,
		orderDir: settings.orderDir,
		viewMode: settings.viewMode,
		whereAuto: settings.whereAuto,
		groupByAuto: settings.groupByAuto,
		havingAuto: settings.havingAuto,
		limitAuto: settings.limitAuto,
	};
}

/**
 * Applies a preset's query settings to the target settings object.
 * Arrays are deep-copied to prevent reference sharing.
 */
export function applyLens(settings: MiniSettings, preset: LensPreset): void {
	const q = preset.query;
	settings.filterMode = q.filterMode;
	settings.dvjsFilter = q.dvjsFilter;
	settings.where = [...q.where];
	settings.groupBy = [...q.groupBy];
	settings.having = [...q.having];
	settings.limit = [...q.limit];
	settings.orderField = q.orderField;
	settings.orderDir = q.orderDir;
	settings.viewMode = q.viewMode;
	settings.whereAuto = q.whereAuto;
	settings.groupByAuto = q.groupByAuto;
	settings.havingAuto = q.havingAuto;
	settings.limitAuto = q.limitAuto;
}

/**
 * Adds a new preset or replaces an existing one with the same name.
 * Order of existing presets is maintained; new presets are appended.
 */
export function upsertPreset(
	presets: LensPreset[],
	name: string,
	query: LensQuerySettings
): LensPreset[] {
	const result = [...presets];
	const index = result.findIndex((p) => p.name === name);
	if (index >= 0) {
		result[index] = { name, query: captureLens({ ...query } as MiniSettings) };
	} else {
		result.push({ name, query: captureLens({ ...query } as MiniSettings) });
	}
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
export function validatePresetName(name: string, existing: LensPreset[]): string | null {
	const trimmed = name.trim();
	if (trimmed.length === 0) {
		return "Preset name cannot be empty.";
	}
	return null;
}
