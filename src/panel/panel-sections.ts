import type { MiniSettings } from "../types";
import type { App } from "obsidian";
import { friendlyError } from "./friendly-error";
import {
	TagFieldSuggest,
	collectSuggestSources,
	type SuggestSources,
} from "./tag-field-suggest";
import {
	parseSimpleRow,
	stringifySimpleCondition,
	buildBuilderSources,
	collectPropertyValues,
	type SimpleCondition,
	type SimpleKind,
	type BuilderSources,
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
	// Clickable templates inserted as a NEW row when clicked. Each rides the
	// existing addRow + change pipeline; no new save format is introduced.
	chips?: { label: string; insert: string }[];
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
	header.createEl("h4", { text: label });
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

	// Quick-insert chips: clicking appends a NEW row pre-filled with a template
	// the user can then edit/delete like any other row (rides addRow/updateRow).
	if (opts.chips && opts.chips.length > 0) {
		const chipBar = section.createDiv({ cls: "gim-expr-chips" });
		chipBar.setCssStyles({ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "6px" });
		const hint = chipBar.createSpan({ text: "Quick add:" });
		hint.setCssStyles({ fontSize: "11px", color: "var(--text-muted)", alignSelf: "center" });
		for (const chip of opts.chips) {
			const btn = chipBar.createEl("button", { text: chip.label, cls: "gim-expr-chip" });
			btn.setCssStyles({
				fontSize: "11px",
				padding: "1px 8px",
				borderRadius: "10px",
				cursor: "pointer",
			});
			btn.setAttr("title", `Adds a row: ${chip.insert}`);
			btn.addEventListener("click", () => {
				// updateRow on a fresh appended index commits the template value,
				// so it persists like a hand-typed row.
				addRow(rows);
				updateRow(rows, rows.length - 1, chip.insert);
				void deps.save();
				deps.rebuild?.();
				deps.rerender();
			});
		}
	}

	// Error is shown via the plain-language mapper (display-layer only; the raw
	// `error` string passed in / stored in settings is never altered).
	if (error) section.createDiv({ cls: "gim-expr-msg", text: friendlyError(error) });
	return section;
}

// ────────────────────────────────────────────────────────────────────
// Visual builder for WHERE / GROUP_BY.
//
// This is an ALTERNATE UI over the SAME `rows: string[]` array that the text
// editor edits. No new save format: every builder row is round-tripped through
// query-builder.ts to one of the simple textual patterns and written straight
// back into `rows`. Rows that aren't builder-simple (AND/OR/parens, tagN:, …)
// are shown as read-anywhere raw text inputs so the original string is never
// lost. A per-section in-memory toggle flips between Builder (default) and Text.
// ────────────────────────────────────────────────────────────────────

// Per-section UI display mode. NOT persisted to settings — a transient,
// in-memory map keyed by a caller-supplied section id (e.g. "where").
type ExprMode = "builder" | "text";
const exprModeState = new Map<string, ExprMode>();

function getExprMode(id: string): ExprMode {
	return exprModeState.get(id) ?? "builder"; // default = Builder
}
function setExprMode(id: string, mode: ExprMode): void {
	exprModeState.set(id, mode);
}

// Pending (uncommitted, valueless) builder selections. When the user picks a
// field/operator but hasn't chosen a value yet, the row string stays "" (not
// saved) and the in-progress field/kind is parked here so the UI re-renders the
// correct stages. Keyed sectionId → rowIndex → {field, kind}. Cleared for the
// whole section whenever rows are structurally changed (add/remove/commit) so
// stale index keys can't leak.
interface Pending {
	field: string;
	kind: SimpleKind;
}
const pendingState = new Map<string, Map<number, Pending>>();

function getPending(sectionId: string, idx: number): Pending | undefined {
	return pendingState.get(sectionId)?.get(idx);
}
function setPending(sectionId: string, idx: number, p: Pending): void {
	let m = pendingState.get(sectionId);
	if (!m) {
		m = new Map();
		pendingState.set(sectionId, m);
	}
	m.set(idx, p);
}
function clearPending(sectionId: string): void {
	pendingState.delete(sectionId);
}

// Builder-row field selection: "tag" (fixed) or a frontmatter key string.
// The 2nd-stage operator options depend on this.
const TAG_OPS: { value: SimpleKind; text: string }[] = [
	{ value: "tag-has", text: "Has this tag" },
	{ value: "tag-not", text: "Does not have this tag" },
	{ value: "tag-any", text: "Has any tag (split by value)" },
];
const FM_OPS: { value: SimpleKind; text: string }[] = [
	{ value: "fm-eq", text: "Equals" },
	{ value: "fm-not", text: "Not equals" },
	{ value: "fm-any", text: "Has any value (split by value)" },
];

function opNeedsValue(kind: SimpleKind): boolean {
	return kind !== "tag-any" && kind !== "fm-any";
}

// Builder-capable section: renders the Builder/Text toggle, then either the
// 3-stage builder rows or delegates to renderExprSection (text). `sectionId`
// keys the in-memory mode. `app` is required for the builder dropdowns.
export function renderBuilderExprSection(
	parent: HTMLElement,
	sectionId: string,
	label: string,
	rows: string[],
	error: string,
	deps: ExprSectionDeps,
	opts: ExprSectionUiOpts = {},
): HTMLElement {
	const mode = getExprMode(sectionId);

	// Text mode (or no app available) → reuse the existing renderer verbatim,
	// then graft the toggle into its header so behaviour/markup stay identical.
	if (mode === "text" || !deps.app) {
		const section = renderExprSection(parent, label, rows, error, deps, opts);
		attachModeToggle(section, sectionId, mode, deps);
		return section;
	}

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
			deps.rebuild?.();
		});
		autoLabel.createSpan({ text: "auto" });
	}
	attachModeToggleToHeader(header, sectionId, mode, deps);

	if (opts.help) {
		const helpEl = section.createDiv({ cls: "gim-expr-help", text: opts.help });
		helpEl.setCssStyles({ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" });
	}

	const sources: BuilderSources = buildBuilderSources(collectSuggestSources(deps.app));

	// Render each existing row. Simple rows → 3-stage selects; non-simple rows →
	// raw text input (fallback) so the original string is preserved verbatim.
	const displayRows = rows;
	if (displayRows.length === 0) {
		const empty = section.createDiv({ cls: "gim-expr-help" });
		empty.setText("No conditions yet. Click “+ Add condition” to start.");
		empty.setCssStyles({ fontSize: "11px", color: "var(--text-muted)" });
	}
	displayRows.forEach((value, idx) => {
		if (idx > 0) {
			const and = section.createDiv({ cls: "gim-builder-and", text: "AND" });
			and.setCssStyles({
				fontSize: "10px",
				fontWeight: "bold",
				color: "var(--text-muted)",
				margin: "2px 0",
			});
		}
		// An empty-string row is a fresh/placeholder builder row (added via
		// "+ Add condition" or after a field/op reset): show the 3 selects with
		// no value chosen yet, NOT the raw-text fallback. Any in-progress field/op
		// for this slot is restored from pendingState.
		if (value.trim() === "") {
			const p = getPending(sectionId, idx);
			const seed: SimpleCondition = p
				? { kind: p.kind, field: p.field, value: "" }
				: { kind: "tag-has", field: "tag", value: "" };
			renderBuilderRow(section, sectionId, rows, idx, seed, sources, deps);
			return;
		}
		const cond = parseSimpleRow(value);
		if (cond) renderBuilderRow(section, sectionId, rows, idx, cond, sources, deps);
		else renderRawFallbackRow(section, rows, idx, value, deps);
	});

	const addBtn = section.createEl("button", { cls: "gim-expr-add", text: "+ Add condition" });
	addBtn.addEventListener("click", () => {
		// Append a placeholder row (empty string). It renders as the 3 selects with
		// no value chosen and is NOT persisted as a real condition until a value is
		// picked. Structural change ⇒ clear stale pending keys.
		clearPending(sectionId);
		addRow(rows);
		deps.rerender();
	});

	if (error) section.createDiv({ cls: "gim-expr-msg", text: friendlyError(error) });
	return section;
}

// Commit a fully-specified SimpleCondition into rows[idx] (canonical string),
// clear any pending placeholder for the section, then save + rebuild + rerender.
function commitBuilderRow(
	sectionId: string,
	rows: string[],
	idx: number,
	cond: SimpleCondition,
	deps: ExprSectionDeps,
): void {
	clearPending(sectionId);
	updateRow(rows, idx, stringifySimpleCondition(cond));
	void deps.save();
	deps.rebuild?.();
	deps.rerender();
}

// Park an uncommitted field/op selection (value not yet chosen): keep the row
// slot present as "" and remember the in-progress field/kind so the rerender
// shows the right stages. Does NOT save (placeholder isn't a real condition).
function parkPending(
	sectionId: string,
	rows: string[],
	idx: number,
	field: string,
	kind: SimpleKind,
	deps: ExprSectionDeps,
): void {
	if (idx >= 0 && idx < rows.length) rows[idx] = "";
	setPending(sectionId, idx, { field, kind });
	deps.rerender();
}

// One builder row: [field select][operator select][value select/input][×].
function renderBuilderRow(
	section: HTMLElement,
	sectionId: string,
	rows: string[],
	idx: number,
	cond: SimpleCondition,
	sources: BuilderSources,
	deps: ExprSectionDeps,
): void {
	const row = section.createDiv({ cls: "gim-expr-row gim-builder-row" });
	row.setCssStyles({ display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" });

	const isTag = cond.kind === "tag-has" || cond.kind === "tag-not" || cond.kind === "tag-any";
	const fieldKey = isTag ? "tag" : cond.field;

	// Stage 1 — field.
	const fieldSel = row.createEl("select", { cls: "gim-builder-field" });
	const tagGrp = fieldSel.createEl("optgroup");
	tagGrp.setAttr("label", "Tag");
	const tagOpt = tagGrp.createEl("option", { value: "tag", text: "Tag" });
	if (isTag) tagOpt.selected = true;
	if (sources.fields.length > 0) {
		const fmGrp = fieldSel.createEl("optgroup");
		fmGrp.setAttr("label", "Property");
		for (const f of sources.fields) {
			const o = fmGrp.createEl("option", { value: `fm:${f}`, text: f });
			if (!isTag && cond.field === f) o.selected = true;
		}
	}
	// If the current fm field isn't in the vault list (e.g. typed earlier), add it
	// so the select reflects the saved value rather than silently dropping it.
	if (!isTag && cond.field !== "" && !sources.fields.includes(cond.field)) {
		const extra = fieldSel.createEl("option", { value: `fm:${cond.field}`, text: cond.field });
		extra.selected = true;
	}

	// Stage 2 — operator.
	const opSel = row.createEl("select", { cls: "gim-builder-op" });
	const ops = isTag ? TAG_OPS : FM_OPS;
	for (const op of ops) {
		const o = opSel.createEl("option", { value: op.value, text: op.text });
		if (op.value === cond.kind) o.selected = true;
	}

	// Stage 3 — value (hidden for the *-any kinds).
	const valueWrap = row.createDiv({ cls: "gim-builder-value" });
	valueWrap.setCssStyles({ display: opNeedsValue(cond.kind) ? "" : "none", flex: "1", minWidth: "100px" });
	renderValueControl(valueWrap, sectionId, rows, idx, cond, isTag, sources, deps);

	fieldSel.addEventListener("change", () => {
		const v = fieldSel.value;
		// Switching field resets to that field's default operator with an empty
		// value → parked placeholder (kept visible, not saved).
		if (v === "tag") parkPending(sectionId, rows, idx, "tag", "tag-has", deps);
		else parkPending(sectionId, rows, idx, v.slice(3), "fm-eq", deps);
	});

	opSel.addEventListener("change", () => {
		const kind = opSel.value as SimpleKind;
		if (!opNeedsValue(kind)) {
			// any-kind: commit immediately (no value needed).
			commitBuilderRow(sectionId, rows, idx, { kind, field: fieldKey, value: "" }, deps);
			return;
		}
		if (cond.value.trim() !== "") {
			commitBuilderRow(sectionId, rows, idx, { kind, field: fieldKey, value: cond.value }, deps);
		} else {
			parkPending(sectionId, rows, idx, fieldKey, kind, deps);
		}
	});

	const del = row.createEl("button", { cls: "gim-expr-del", text: "×" });
	del.setAttr("aria-label", "Remove condition");
	del.addEventListener("click", () => {
		clearPending(sectionId);
		removeRow(rows, idx);
		void deps.save();
		deps.rebuild?.();
		deps.rerender();
	});
}

// Value control: a <select> of real candidates when available, else a free-text
// input. Tag → vault tag values; Property → distinct values of that key.
function renderValueControl(
	wrap: HTMLElement,
	sectionId: string,
	rows: string[],
	idx: number,
	cond: SimpleCondition,
	isTag: boolean,
	sources: BuilderSources,
	deps: ExprSectionDeps,
): void {
	wrap.empty();
	const candidates = isTag
		? sources.tags
		: deps.app
			? collectPropertyValues(deps.app, cond.field)
			: [];

	if (candidates.length > 0) {
		const sel = wrap.createEl("select", { cls: "gim-builder-val-select" });
		sel.setCssStyles({ width: "100%" });
		const ph = sel.createEl("option", { value: "", text: "Choose a value…" });
		if (cond.value === "") ph.selected = true;
		for (const c of candidates) {
			const o = sel.createEl("option", { value: c, text: c });
			if (c === cond.value) o.selected = true;
		}
		// Preserve a saved value not present in the current candidate set.
		if (cond.value !== "" && !candidates.includes(cond.value)) {
			const extra = sel.createEl("option", { value: cond.value, text: cond.value });
			extra.selected = true;
		}
		sel.addEventListener("change", () => {
			if (sel.value === "") parkPending(sectionId, rows, idx, cond.field, cond.kind, deps);
			else commitBuilderRow(sectionId, rows, idx, { ...cond, value: sel.value }, deps);
		});
	} else {
		// No candidates → free-text fallback (e.g. property has no scanned values).
		const input = wrap.createEl("input", { type: "text", cls: "gim-expr" });
		input.value = cond.value;
		input.placeholder = "value";
		input.spellcheck = false;
		input.setCssStyles({ width: "100%" });
		input.addEventListener("change", () => {
			const v = input.value.trim();
			if (v === "") parkPending(sectionId, rows, idx, cond.field, cond.kind, deps);
			else commitBuilderRow(sectionId, rows, idx, { ...cond, value: v }, deps);
		});
	}
}

// Non-simple row fallback: a raw text input bound to the row string. Editing it
// goes through the SAME updateRow pipeline, so a complex expression (OR/parens/
// tagN:) is preserved exactly and never coerced by the builder.
function renderRawFallbackRow(
	section: HTMLElement,
	rows: string[],
	idx: number,
	value: string,
	deps: ExprSectionDeps,
): void {
	const row = section.createDiv({ cls: "gim-expr-row gim-builder-raw-row" });
	row.setCssStyles({ display: "flex", gap: "4px", alignItems: "center" });
	const tag = row.createSpan({ text: "Advanced" });
	tag.setCssStyles({
		fontSize: "10px",
		color: "var(--text-muted)",
		border: "1px solid var(--background-modifier-border)",
		borderRadius: "8px",
		padding: "0 6px",
	});
	const input = row.createEl("input", { type: "text", cls: "gim-expr" });
	input.value = value;
	input.spellcheck = false;
	input.setCssStyles({ flex: "1" });
	input.setAttr("title", "This condition uses advanced syntax; edit as text.");
	input.addEventListener("change", () => {
		updateRow(rows, idx, input.value.trim());
		void deps.save();
		deps.rebuild?.();
		deps.rerender();
	});
	const del = row.createEl("button", { cls: "gim-expr-del", text: "×" });
	del.setAttr("aria-label", "Remove condition");
	del.addEventListener("click", () => {
		removeRow(rows, idx);
		void deps.save();
		deps.rebuild?.();
		deps.rerender();
	});
}

// Toggle inserted into a section produced by renderExprSection (text mode).
function attachModeToggle(
	section: HTMLElement,
	sectionId: string,
	mode: ExprMode,
	deps: ExprSectionDeps,
): void {
	const header = section.querySelector(".gim-panel-section-header") as HTMLElement | null;
	if (header) attachModeToggleToHeader(header, sectionId, mode, deps);
}

function attachModeToggleToHeader(
	header: HTMLElement,
	sectionId: string,
	mode: ExprMode,
	deps: ExprSectionDeps,
): void {
	const toggle = header.createDiv({ cls: "gim-builder-toggle" });
	toggle.setCssStyles({ marginLeft: "auto", display: "flex", gap: "2px" });
	const mk = (m: ExprMode, text: string): void => {
		const btn = toggle.createEl("button", { text });
		const active = mode === m;
		btn.setCssStyles({
			fontSize: "10px",
			padding: "1px 8px",
			borderRadius: "8px",
			cursor: "pointer",
			opacity: active ? "1" : "0.6",
			fontWeight: active ? "bold" : "normal",
		});
		if (active) btn.setAttr("aria-current", "true");
		btn.addEventListener("click", () => {
			if (mode === m) return;
			setExprMode(sectionId, m);
			deps.rerender();
		});
	};
	mk("builder", "Builder");
	mk("text", "Text");
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
