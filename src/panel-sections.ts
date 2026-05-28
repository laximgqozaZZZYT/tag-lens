import type { MiniSettings } from "./types";

// ORDER_BY field schema. Listed by source group so the dropdown reads
// like a labelled menu. Centralised here so a new field can be added
// in ONE place (vs. previously inline in view.ts).
export const ORDER_BY_GROUPS: {
	label: string;
	opts: { value: string; text: string }[];
}[] = [
	{
		label: "File",
		opts: [
			{ value: "name", text: "name" },
			{ value: "path", text: "path" },
			{ value: "extension", text: "extension" },
			{ value: "mtime", text: "modified" },
			{ value: "ctime", text: "created" },
			{ value: "size", text: "size" },
		],
	},
	{
		label: "Graph",
		opts: [
			{ value: "degree", text: "degree (links)" },
			{ value: "memberships", text: "memberships (cluster count)" },
		],
	},
	{
		label: "Frontmatter",
		opts: [{ value: "title", text: "title" }],
	},
	{
		label: "Other",
		opts: [{ value: "random", text: "random" }],
	},
];

// Set of all built-in ORDER_BY field keys. A field NOT in this set is
// treated as a custom frontmatter field name.
export const KNOWN_ORDER_FIELDS: Set<string> = new Set(
	ORDER_BY_GROUPS.flatMap((g) => g.opts.map((o) => o.value)),
);

// ────────────────────────────────────────────────────────────────────
// Pure mutators (no DOM, no `this`) for the expression-row arrays
// ────────────────────────────────────────────────────────────────────
// `updateRow` is special-cased: a blank value REMOVES the row so empty
// rows don't silently pile up in saved settings.
export function updateRow(rows: string[], idx: number, value: string): void {
	if (rows.length === 0) {
		if (value) rows.push(value);
		return;
	}
	if (value) rows[idx] = value;
	else rows.splice(idx, 1);
}

export function addRow(rows: string[]): void {
	rows.push("");
}

export function removeRow(rows: string[], idx: number): void {
	if (rows.length === 0) return;
	rows.splice(idx, 1);
}

// Generic array-membership toggle for the boolean-set settings fields
// (= hiddenNodes, aggregatedLayers). `present === true` inserts (idempotent),
// `present === false` removes (no-op if absent).
export function toggleArrayMember<K extends "hiddenNodes" | "aggregatedLayers">(
	settings: MiniSettings,
	field: K,
	value: string,
	present: boolean,
): void {
	const arr = settings[field];
	const i = arr.indexOf(value);
	if (present && i === -1) arr.push(value);
	if (!present && i >= 0) arr.splice(i, 1);
}

// ────────────────────────────────────────────────────────────────────
// UI builders. All callbacks are passed in explicitly so the renderer
// has no dependency on `this` — they can be tested with stub DOM nodes.
// ────────────────────────────────────────────────────────────────────

// Auto-flag toggle types for the WHERE / GROUP_BY / HAVING / LIMIT sections.
export type AutoKey =
	| "whereAuto"
	| "groupByAuto"
	| "havingAuto"
	| "limitAuto";

export interface ExprSectionDeps {
	settings: MiniSettings;
	save: () => void;
	rerender: () => void;
}

// Expression-row section (WHERE / GROUP_BY / HAVING / LIMIT). Each row
// is an editable string; "+" appends; "×" deletes. The auto checkbox
// in the header toggles `settings[autoKey]` when present.
export function renderExprSection(
	parent: HTMLElement,
	label: string,
	rows: string[],
	error: string,
	deps: ExprSectionDeps,
	opts: { placeholder?: string; autoKey?: AutoKey } = {},
): HTMLElement {
	const section = parent.createDiv({ cls: "gim-panel-section" });
	const header = section.createDiv({ cls: "gim-panel-section-header" });
	header.createEl("h4", { text: label });
	if (opts.autoKey) {
		const autoLabel = header.createEl("label", { cls: "gim-auto-toggle" });
		const cb = autoLabel.createEl("input", { type: "checkbox" });
		const key = opts.autoKey;
		cb.checked = deps.settings[key];
		cb.addEventListener("change", () => {
			deps.settings[key] = cb.checked;
			void deps.save();
		});
		autoLabel.createSpan({ text: "auto" });
	}

	// Ensure at least one editable row is shown so users can type into it.
	const displayRows = rows.length > 0 ? rows : [""];
	const placeholder = opts.placeholder ?? "e.g. tag:#wip AND status:draft";

	displayRows.forEach((value, idx) => {
		const row = section.createDiv({ cls: "gim-expr-row" });
		const input = row.createEl("input", {
			type: "text",
			cls: "gim-expr",
		});
		input.value = value;
		input.placeholder = placeholder;
		input.spellcheck = false;
		input.addEventListener("change", () => {
			updateRow(rows, idx, input.value.trim());
			void deps.save();
		});
		const del = row.createEl("button", { cls: "gim-expr-del", text: "×" });
		del.setAttr("aria-label", "Remove row");
		del.disabled = rows.length === 0;
		del.addEventListener("click", () => {
			removeRow(rows, idx);
			void deps.save();
			deps.rerender();
		});
	});

	const addBtn = section.createEl("button", {
		cls: "gim-expr-add",
		text: "+ Add row",
	});
	addBtn.addEventListener("click", () => {
		addRow(rows);
		deps.rerender();
	});

	if (error) section.createDiv({ cls: "gim-expr-msg", text: error });
	return section;
}

// Generic checkbox-row group for boolean settings fields.
export interface ToggleSectionDeps {
	settings: MiniSettings;
	save: () => void;
}

export function renderToggleSection<
	K extends "showNodes" | "showBody" | "showEnclosures" | "showEdges" | "showGrid",
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
		});
		row.createSpan({ text: t.label });
	}
	return section;
}

// ORDER_BY: scalar (field + direction) rather than rows, so it has
// its own UI: two selects + an optional text input that surfaces only
// when the user picks a custom frontmatter field.
export interface OrderBySectionDeps {
	settings: MiniSettings;
	save: () => void;
}

export function renderOrderBySection(
	parent: HTMLElement,
	deps: OrderBySectionDeps,
): void {
	const section = parent.createDiv({ cls: "gim-panel-section" });
	const header = section.createDiv({ cls: "gim-panel-section-header" });
	header.createEl("h4", { text: "ORDER_BY" });

	const row = section.createDiv({ cls: "gim-order-row" });
	const isCustom = !KNOWN_ORDER_FIELDS.has(deps.settings.orderField);

	const fieldSel = row.createEl("select", { cls: "gim-order-field" });
	for (const g of ORDER_BY_GROUPS) {
		const grp = fieldSel.createEl("optgroup");
		grp.setAttr("label", g.label);
		for (const o of g.opts) {
			const opt = grp.createEl("option", {
				value: o.value,
				text: o.text,
			});
			if (!isCustom && deps.settings.orderField === o.value)
				opt.selected = true;
		}
	}
	const customOpt = fieldSel.createEl("option", {
		value: "__custom__",
		text: "custom frontmatter…",
	});
	if (isCustom) customOpt.selected = true;

	const customInput = row.createEl("input", {
		type: "text",
		cls: "gim-order-custom",
	});
	customInput.value = isCustom ? deps.settings.orderField : "";
	customInput.placeholder = "frontmatter field";
	customInput.style.display = isCustom ? "" : "none";

	fieldSel.addEventListener("change", () => {
		if (fieldSel.value === "__custom__") {
			customInput.style.display = "";
			customInput.focus();
			deps.settings.orderField = customInput.value.trim() || "name";
		} else {
			customInput.style.display = "none";
			deps.settings.orderField = fieldSel.value;
		}
		void deps.save();
	});
	customInput.addEventListener("change", () => {
		const v = customInput.value.trim();
		deps.settings.orderField = v || "name";
		void deps.save();
	});

	const dirSel = row.createEl("select", { cls: "gim-order-dir" });
	for (const d of ["asc", "desc"] as const) {
		const opt = dirSel.createEl("option", { value: d, text: d });
		if (deps.settings.orderDir === d) opt.selected = true;
	}
	dirSel.addEventListener("change", () => {
		deps.settings.orderDir = dirSel.value as "asc" | "desc";
		void deps.save();
	});
}
