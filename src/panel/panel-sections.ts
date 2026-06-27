import type { MiniSettings } from "../types";
// Removed deprecated ExprSection and TagPicker code.
// Generic checkbox-row group for boolean settings fields.
export interface ToggleSectionDeps {
	settings: MiniSettings;
	save: () => void;
	redraw?: () => void;
}
export function toggleArrayMember<T>(obj: T, field: keyof T, value: string, active: boolean): void {
	const arr = (obj[field] || []) as string[];
	if (active && !arr.includes(value)) obj[field] = [...arr, value] as T[keyof T];
	if (!active && arr.includes(value)) obj[field] = arr.filter((x) => x !== value) as T[keyof T];
}

export function renderToggleSection<
	K extends "showNodes" | "showBody" | "showEnclosures" | "showEdges" | "showGrid" | "showMaturity",
>(
	parent: HTMLElement,
	deps: ToggleSectionDeps,
	heading: string,
	toggles: { key: K; label: string }[],
): HTMLElement {
	const section = parent.createDiv({ cls: "gim-panel-section" });
	section.createEl("h4", { text: heading });
	for (const t of toggles) {
		const row = section.createEl("label", { cls: "gim-toggle-row" });
		const cb = row.createEl("input", { type: "checkbox" });
		cb.checked = deps.settings[t.key];
		cb.addEventListener("change", () => {
			deps.settings[t.key] = cb.checked;
			void deps.save();
			deps.redraw?.();
		});
		row.createSpan({ text: t.label });
	}
	return section;
}
// ORDER_BY is no longer used in Bases mode.
// ────────────────────────────────────────────────────────────────────
// Saved Lenses
// ────────────────────────────────────────────────────────────────────

interface PresetSectionDeps {
	settings: MiniSettings;
	save: () => void;
	rerender: () => void;
	rebuild: () => void;
	applyPreset: (presetName: string) => void;
	savePreset: (name: string) => void;
	removePreset: (name: string) => void;
}
