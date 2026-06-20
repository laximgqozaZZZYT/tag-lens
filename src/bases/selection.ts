// Pure helpers for the Bases logic UI's selected-file list. Kept Obsidian-free
// and side-effect-free so the add/remove logic is unit-testable in isolation
// (the surrounding UI in panel/settings-tabs.ts wires save/rebuild around them).

// Append a base path if not already present (dedup; preserves order). Returns a
// NEW array so callers can assign it back and trigger reactive saves cleanly.
export function addBaseFileToSelected(
	selected: readonly string[],
	path: string,
): string[] {
	return selected.includes(path) ? [...selected] : [...selected, path];
}

// Remove every occurrence of a base path. Returns a NEW array.
export function removeBaseFileFromSelected(
	selected: readonly string[],
	path: string,
): string[] {
	return selected.filter((p) => p !== path);
}
