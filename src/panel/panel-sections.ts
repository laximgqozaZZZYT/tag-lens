import type { MiniSettings } from "../types";
import { AbstractInputSuggest, type App } from "obsidian";
import { friendlyError } from "./friendly-error";
import {
	TagFieldSuggest,
	collectSuggestSources,
	type SuggestSources,
} from "./tag-field-suggest";
import {
	classifyTagPickerRows,
	tagRowString,
	tagPickerRowLabel,
	buildBuilderSources,
	buildPickerCandidates,
	computePickerCandidates,
	collectPropertyValueMap,
	type TagPickerRow,
	type PickerCandidate,
} from "./query-builder";

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
export function toggleArrayMember<
	K extends "hiddenNodes" | "aggregatedLayers" | "layerInheritFull" | "selectedBases",
>(
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
	// Called after the expression value changes so the graph + menu rebuild.
	// WHERE / GROUP_BY / HAVING / LIMIT are query-pipeline settings — editing
	// them must produce a full rebuild, not just a repaint.
	rebuild?: () => void;
	// Optional — only WHERE/GROUP_BY (in SQL mode) pass this so the tag/property
	// typeahead can read vault metadata. Absent ⇒ no suggester is attached
	// (behaviour identical to before this feature).
	app?: App;
}

// Per-section beginner help + quick-insert chip config. All optional and purely
// additive: a section with no entry behaves exactly as before.
export interface ExprSectionUiOpts {
	placeholder?: string;
	autoKey?: AutoKey;
	// Plain one-line explanation shown under the heading.
	help?: string;
	// Attach the tag/property typeahead to each row input (needs deps.app).
	suggest?: boolean;
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
	opts: ExprSectionUiOpts = {},
): HTMLElement {
	const section = parent.createDiv({ cls: "gim-panel-section" });
	const header = section.createDiv({ cls: "gim-panel-section-header" });
	// Empty label ⇒ no heading (used when embedded inside the Advanced disclosure
	// of the tag picker, which already provides the section heading).
	if (label) header.createEl("h4", { text: label });
	if (opts.autoKey) {
		const autoLabel = header.createEl("label", { cls: "gim-auto-toggle" });
		const cb = autoLabel.createEl("input", { type: "checkbox" });
		const key = opts.autoKey;
		cb.checked = deps.settings[key];
		cb.addEventListener("change", () => {
			deps.settings[key] = cb.checked;
			void deps.save();
			deps.rebuild?.();
		});
		autoLabel.createSpan({ text: "auto" });
	}

	// Beginner help line under the heading (additive; placeholder kept too).
	if (opts.help) {
		const helpEl = section.createDiv({ cls: "gim-expr-help", text: opts.help });
		helpEl.setCssStyles({
			fontSize: "11px",
			color: "var(--text-muted)",
			marginBottom: "6px",
		});
	}

	// Vault sources for the typeahead are gathered once per render (lazily) and
	// shared across all rows in this section. Only when suggest + app present.
	let sources: SuggestSources | null = null;
	const getSources = (): SuggestSources => {
		if (!sources) sources = collectSuggestSources(deps.app!);
		return sources;
	};

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
			deps.rebuild?.();
		});
		if (opts.suggest && deps.app) {
			new TagFieldSuggest(deps.app, input, getSources);
		}
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

	// Error is shown via the plain-language mapper (display-layer only; the raw
	// `error` string passed in / stored in settings is never altered).
	if (error) section.createDiv({ cls: "gim-expr-msg", text: friendlyError(error) });
	return section;
}

// ────────────────────────────────────────────────────────────────────
// Beginner tag picker for WHERE / GROUP_BY.
//
// This is the DEFAULT, deliberately minimal UI over the SAME `rows: string[]`
// array that the text editor edits. It introduces NO new save format and NO new
// query capability — it can only ADD a plain positive `tag:#x` row (the single
// most common case) and REMOVE any existing row.
//
// Layout (mirrors the approved Bases file-picker pattern in settings-tabs.ts):
//   1. ONE text input with a tag-name typeahead. Pick/Enter ⇒ a `tag:#name`
//      row is appended to `rows[]`. No operator/field/value choices exist here.
//   2. A list below the input, one removable entry per saved row:
//        • plain `tag:#x` rows  → a tag chip showing the bare name + ×
//        • everything else      → the raw string shown verbatim (read-only) + ×
//      Non-simple rows are NEVER rewritten by this UI, so AND/OR/parens/NOT/
//      property/wildcard conditions survive untouched (edit them in Advanced).
//   3. A single, collapsed-by-default "Advanced" disclosure that reveals the
//      UNCHANGED full text editor (renderExprSection) — the complete SQL-like
//      power (AND/OR/parens/wildcards/property refs) lives there, untouched.
// ────────────────────────────────────────────────────────────────────

// Remembers which sections have the Advanced text editor expanded. Transient,
// in-memory only (NOT persisted) — beginners always start collapsed.
const advancedOpenState = new Set<string>();

// Mixed-candidate suggester for the beginner input. Same ONE input + popover +
// chip pattern as before, but the popover now offers four candidate kinds (tag
// value, property = value, "one group per tag", "one group per <field> value"),
// all of which insert a SIMPLE saved-row string the existing parser understands.
// No new input widget, no new save format — only the popover CONTENT is richer.
//
// `getCandidates(query)` returns the already-filtered/ranked candidate list for
// the current input text (built from the cached vault sources). `onPick` appends
// the chosen candidate's `insert` string to rows[].
class TagPickerSuggest extends AbstractInputSuggest<PickerCandidate> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly getCandidates: (query: string) => PickerCandidate[],
		private readonly onPick: (c: PickerCandidate) => void,
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): PickerCandidate[] {
		return this.getCandidates(query);
	}

	renderSuggestion(c: PickerCandidate, el: HTMLElement): void {
		el.createSpan({ text: c.label });
		const sub = el.createSpan({ text: `  ${c.hint}` });
		sub.setCssStyles({ fontSize: "10px", color: "var(--text-muted)" });
	}

	selectSuggestion(c: PickerCandidate): void {
		this.onPick(c);
	}
}

// Beginner-facing section: tag input + selected-row list + Advanced disclosure.
// Operates on the SAME `rows` array as renderExprSection. `app` is required for
// the typeahead; without it the input is a plain text box that still appends a
// `tag:#x` row on Enter. `sectionId` keys the (transient) Advanced open state.
export function renderTagPickerSection(
	parent: HTMLElement,
	sectionId: string,
	label: string,
	rows: string[],
	error: string,
	deps: ExprSectionDeps,
	opts: ExprSectionUiOpts = {},
): HTMLElement {
	const section = parent.createDiv({ cls: "gim-panel-section" });
	const header = section.createDiv({ cls: "gim-panel-section-header" });
	// Empty label ⇒ no heading (used when embedded inside the Advanced disclosure
	// of the tag picker, which already provides the section heading).
	if (label) header.createEl("h4", { text: label });
	if (opts.autoKey) {
		const autoLabel = header.createEl("label", { cls: "gim-auto-toggle" });
		const cb = autoLabel.createEl("input", { type: "checkbox" });
		const key = opts.autoKey;
		cb.checked = deps.settings[key];
		cb.addEventListener("change", () => {
			deps.settings[key] = cb.checked;
			void deps.save();
			deps.rebuild?.();
		});
		autoLabel.createSpan({ text: "auto" });
	}

	if (opts.help) {
		const helpEl = section.createDiv({ cls: "gim-expr-help", text: opts.help });
		helpEl.setCssStyles({ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" });
	}

	// 1. The single input (typeahead over tags + property=value + auto-split).
	const input = section.createEl("input", { type: "text", cls: "gim-tag-picker-input" });
	input.setAttribute("placeholder", "Tag, property, or “one group per…”");
	input.spellcheck = false;
	input.setCssStyles({ width: "100%", marginBottom: "6px" });

	// Append a finished saved-row string (the candidate's canonical insert, or a
	// hand-typed bare tag). Idempotent — never appends a duplicate of an existing
	// identical row. Shared by the suggester pick and the Enter-to-commit path.
	const addRowString = (rowString: string): void => {
		const r = rowString.trim();
		if (r === "") return;
		if (!rows.includes(r)) {
			rows.push(r);
			void deps.save();
			deps.rebuild?.();
		}
		input.value = "";
		deps.rerender();
	};

	if (deps.app) {
		// Cache the vault sources + property-value map ONCE per render so the
		// per-keystroke filter is pure string work (no metadataCache walk per key).
		const app = deps.app;
		let cachedPool: PickerCandidate[] | null = null;
		const getPool = (): PickerCandidate[] => {
			if (!cachedPool) {
				const builderSources = buildBuilderSources(collectSuggestSources(app));
				const valueMap = collectPropertyValueMap(app, builderSources.fields);
				cachedPool = buildPickerCandidates(builderSources, valueMap);
			}
			return cachedPool;
		};
		new TagPickerSuggest(
			app,
			input,
			(query) => computePickerCandidates(getPool(), query, rows),
			(c) => addRowString(c.insert),
		);
	}
	// Enter commits the typed text as a bare tag (covers tags not in the vault
	// yet, or when no app is wired). The canonical `tag:#name` row is produced so
	// it round-trips identically to a picked tag candidate.
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			const typed = input.value.trim();
			if (typed !== "") addRowString(tagRowString(typed.replace(/^#/, "")));
		}
	});

	// 2. Selected-row list — friendly labels for the six simple conditions
	//    (tag / property=value / auto-split), raw verbatim text for the rest.
	const picked: TagPickerRow[] = classifyTagPickerRows(rows);
	if (picked.length === 0) {
		const empty = section.createDiv({ cls: "gim-expr-help", text: "Nothing chosen yet." });
		empty.setCssStyles({ fontSize: "11px", color: "var(--text-muted)" });
	} else {
		const list = section.createDiv({ cls: "gim-tag-picker-list" });
		for (const item of picked) {
			const row = list.createDiv({ cls: "gim-tag-picker-row" });
			row.setCssStyles({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", padding: "2px 0" });
			const lbl = tagPickerRowLabel(item.raw);
			const labelEl = row.createSpan({ text: lbl.text });
			labelEl.setCssStyles({ flex: "1 1 auto", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px" });
			if (!lbl.simple) {
				labelEl.setAttr("title", "Advanced condition — edit it under Advanced below.");
				labelEl.setCssStyles({ fontFamily: "var(--font-monospace)", color: "var(--text-muted)" });
			}
			const del = row.createEl("button", { cls: "gim-expr-del", text: "×" });
			del.setAttr("aria-label", "Remove");
			// Capture the original string; index can shift, so match by value.
			const raw = item.raw;
			del.addEventListener("click", () => {
				const i = rows.indexOf(raw);
				if (i >= 0) removeRow(rows, i);
				void deps.save();
				deps.rebuild?.();
				deps.rerender();
			});
		}
	}

	// Beginner-facing error (plain-language). The raw stored string is unchanged.
	if (error) section.createDiv({ cls: "gim-expr-msg", text: friendlyError(error) });

	// 3. Advanced disclosure — the UNCHANGED full text editor. Collapsed by
	// default so beginners never see it; toggling reveals renderExprSection
	// verbatim (full SQL-like power: AND/OR/parens/wildcards/property refs).
	const advWrap = section.createDiv({ cls: "gim-expr-advanced" });
	advWrap.setCssStyles({ marginTop: "8px" });
	const toggle = advWrap.createEl("a", { cls: "gim-expr-advanced-toggle" });
	toggle.setCssStyles({ fontSize: "11px", color: "var(--text-muted)", cursor: "pointer" });
	const isOpen = advancedOpenState.has(sectionId);
	toggle.setText(isOpen ? "▾ Advanced (text)" : "▸ Advanced (text)");
	toggle.addEventListener("click", () => {
		if (advancedOpenState.has(sectionId)) advancedOpenState.delete(sectionId);
		else advancedOpenState.add(sectionId);
		deps.rerender();
	});
	if (isOpen) {
		const body = advWrap.createDiv({ cls: "gim-expr-advanced-body" });
		// Reuse the original text editor untouched (no suggest needed here, but it
		// stays available if opts.suggest is set). Pass the same rows + error.
		renderExprSection(body, "", rows, "", deps, { ...opts, autoKey: undefined, help: undefined });
	}

	return section;
}


// Generic checkbox-row group for boolean settings fields.
export interface ToggleSectionDeps {
	settings: MiniSettings;
	save: () => void;
	redraw?: () => void;
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
	header.createEl("h4", { text: "Sort notes by" });

	const help = section.createDiv({ cls: "gim-expr-help", text: "Choose how notes are sorted." });
	help.setCssStyles({ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" });

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
	customInput.setCssStyles({ display: isCustom ? "" : "none" });

	fieldSel.addEventListener("change", () => {
		if (fieldSel.value === "__custom__") {
			customInput.setCssStyles({ display: "" });
			customInput.focus();
			deps.settings.orderField = customInput.value.trim() || "name";
		} else {
			customInput.setCssStyles({ display: "none" });
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
