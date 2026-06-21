import type { MiniSettings } from "../types";
// Removed deprecated ExprSection and TagPicker code.
// Generic checkbox-row group for boolean settings fields.
export interface ToggleSectionDeps {
	settings: MiniSettings;
	save: () => void;
	redraw?: () => void;
}
export function toggleArrayMember<T extends Record<string, any>>(obj: T, field: keyof T, value: string, active: boolean): void {
	const arr = (obj[field] || []) as string[];
	if (active && !arr.includes(value)) obj[field] = [...arr, value] as any;
	if (!active && arr.includes(value)) obj[field] = arr.filter((x) => x !== value) as any;
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

export interface PresetSectionDeps {
	settings: MiniSettings;
	save: () => void;
	rerender: () => void;
	rebuild: () => void;
	applyPreset: (presetName: string) => void;
	savePreset: (name: string) => void;
	removePreset: (name: string) => void;
}

export function renderPresetSection(
	parent: HTMLElement,
	deps: PresetSectionDeps
): HTMLElement {
	const section = parent.createDiv({ cls: "gim-panel-section gim-preset-section" });
	const header = section.createDiv({ cls: "gim-panel-section-header" });
	header.createEl("h4", { text: "Saved Lenses" });

	// Existing presets
	if (deps.settings.lensPresets.length > 0) {
		const list = section.createDiv({ cls: "gim-preset-list" });
		list.setCssStyles({ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "8px" });
		for (const preset of deps.settings.lensPresets) {
			const chip = list.createDiv({ cls: "gim-preset-chip" });
			chip.setCssStyles({
				display: "flex",
				alignItems: "center",
				background: "var(--background-modifier-border)",
				padding: "2px 8px",
				borderRadius: "12px",
				fontSize: "11px",
				cursor: "pointer"
			});
			
			const nameSpan = chip.createSpan({ text: preset.name });
			nameSpan.addEventListener("click", () => {
				deps.applyPreset(preset.name);
			});

			const delBtn = chip.createSpan({ text: "×", cls: "gim-preset-del" });
			delBtn.setCssStyles({ marginLeft: "4px", color: "var(--text-muted)", cursor: "pointer", fontWeight: "bold" });
			delBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				deps.removePreset(preset.name);
			});
		}
	}

	// New preset input
	const row = section.createDiv({ cls: "gim-preset-row" });
	row.setCssStyles({ display: "flex", gap: "4px" });
	const input = row.createEl("input", { type: "text", cls: "gim-preset-input", placeholder: "Lens name..." });
	input.setCssStyles({ flex: "1" });
	const saveBtn = row.createEl("button", { text: "Save", cls: "gim-preset-save" });
	saveBtn.addEventListener("click", () => {
		const name = input.value.trim();
		if (!name) return;
		deps.savePreset(name);
		input.value = "";
	});
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			saveBtn.click();
		}
	});

	return section;
}
