// Visual Query Builder — Bases-style interactive filter/group/having/limit UI.
//
// Replaces the old SQL text-row editor in "Simple" (sql) mode with four
// collapsible sections that build queries visually. Operates on the SAME
// string[] arrays (where/groupBy/having/limit) as the text editor — no new
// persistence format. Advanced rows (those `parseSimpleRow` can't parse) are
// shown read-only; everything else gets a structured property/operator/value
// row.

import { setIcon, type App } from "obsidian";
import {
	parseSimpleRow,
	stringifySimpleCondition,
	buildBuilderSources,
	collectPropertyValueMap,
	type SimpleCondition,
	type SimpleKind,
} from "./query-builder";
import {
	createSearchableDropdown,
	type DropdownItem,
	type SearchableDropdownHandle,
} from "./searchable-dropdown";
import { collectSuggestSources, type SuggestSources } from "./tag-field-suggest";
import type { MiniSettings } from "../types";

let datalistSeq = 0;

function nextDatalistId(prefix: string): string {
	datalistSeq += 1;
	return `${prefix}-${datalistSeq}`;
}

function valueCandidatesForProperty(
	propId: string,
	sources: SuggestSources,
	propertyValueMap: Record<string, string[]>,
): string[] {
	if (propId === "tag") return sources.tags;
	return propertyValueMap[propId] ?? [];
}

function bindDatalistHints(
	host: HTMLElement,
	input: HTMLInputElement,
	values: string[],
	prefix: string,
	cap = 60,
): void {
	const uniq = [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))].slice(0, cap);
	if (uniq.length === 0) return;
	const listId = nextDatalistId(prefix);
	const dl = host.createEl("datalist");
	dl.id = listId;
	for (const v of uniq) {
		dl.createEl("option", { value: v });
	}
	input.setAttribute("list", listId);
}

// ── Public interface ────────────────────────────────────────────────────────

export interface VisualBuilderDeps {
	app: App;
	settings: MiniSettings;
	save: () => void;
	rebuild: () => void;
	rerender: () => void;
	havingError: string;
}

/**
 * Render the full visual builder (4 sections) into `host`.
 * Called from `renderSettingsFilterTab` when filterMode === "sql".
 */
export function renderVisualBuilder(host: HTMLElement, deps: VisualBuilderDeps): void {
	// Gather vault metadata once per render (tags + frontmatter keys).
	const sources = collectSuggestSources(deps.app);
	const propertyItems = buildPropertyItems(sources);
	const builderSources = buildBuilderSources(sources);
	const propertyValueMap = collectPropertyValueMap(deps.app, builderSources.fields);

	// Track dropdown handles so we can clean them up on re-render.
	const handles: SearchableDropdownHandle[] = [];
	const track = (h: SearchableDropdownHandle): SearchableDropdownHandle => {
		handles.push(h);
		return h;
	};

	// 1. Filter (WHERE)
	renderFilterSection(host, deps, propertyItems, sources, propertyValueMap, track);

	// 2. Group By
	renderGroupBySection(host, deps, propertyItems, sources, propertyValueMap, track);

	// 3. Group Filter (HAVING)
	renderHavingSection(host, deps);

	// 4. Limit
	renderLimitSection(host, deps);
}

// ── Property & Operator items ───────────────────────────────────────────────

function buildPropertyItems(sources: SuggestSources): DropdownItem[] {
	const items: DropdownItem[] = [];
	// Tag entry — always first
	items.push({
		id: "tag",
		label: "タグ",
		hint: "tag",
		icon: "tag",
	});
	// Frontmatter fields
	for (const f of sources.fields) {
		// Skip internal Obsidian cache artefacts
		if (f === "position" || f === "tags" || f === "cssclasses" || f === "aliases") continue;
		items.push({
			id: f,
			label: f,
			hint: `fm.${f}`,
			icon: "file-text",
		});
	}
	return items;
}

// Operator sets keyed by property kind.
const TAG_OPERATORS: DropdownItem[] = [
	{ id: "tag-has", label: "has tag" },
	{ id: "tag-not", label: "does not have tag" },
	{ id: "tag-any", label: "any tag (auto-split)" },
];

const FM_OPERATORS: DropdownItem[] = [
	{ id: "fm-eq", label: "equals" },
	{ id: "fm-not", label: "not equals" },
	{ id: "fm-any", label: "has any value (auto-split)" },
];

function operatorsForProperty(propId: string): DropdownItem[] {
	return propId === "tag" ? TAG_OPERATORS : FM_OPERATORS;
}

// Map SimpleKind back to operator dropdown id (they happen to be the same).
function operatorIdFromKind(kind: SimpleKind): string {
	return kind;
}

// Map operator id + property id to SimpleKind.
function kindFromOperatorId(opId: string): SimpleKind {
	return opId as SimpleKind;
}

// Determine which property was used in a parsed condition.
function propertyFromCondition(c: SimpleCondition): string {
	if (c.kind === "tag-has" || c.kind === "tag-not" || c.kind === "tag-any") return "tag";
	return c.field;
}

// ── Section 1: Filter (WHERE) ───────────────────────────────────────────────

function renderFilterSection(
	host: HTMLElement,
	deps: VisualBuilderDeps,
	propertyItems: DropdownItem[],
	sources: SuggestSources,
	propertyValueMap: Record<string, string[]>,
	track: (h: SearchableDropdownHandle) => SearchableDropdownHandle,
): void {
	const section = host.createDiv({ cls: "gim-vb-section" });
	const header = section.createDiv({ cls: "gim-vb-section-header" });
	const chevron = header.createSpan({ cls: "gim-vb-chevron", text: "▾" });
	header.createSpan({ text: "フィルター", cls: "gim-vb-section-title" });

	const body = section.createDiv({ cls: "gim-vb-section-body" });

	// Accordion: "このビュー" (the only active tier for now)
	const viewAccordion = body.createDiv({ cls: "gim-vb-view-accordion" });
	const viewHeader = viewAccordion.createDiv({ cls: "gim-vb-view-header" });
	viewHeader.createSpan({ text: "このビュー", cls: "gim-vb-view-label" });

	const viewBody = viewAccordion.createDiv({ cls: "gim-vb-view-body" });

	// AND/OR conjunction indicator (visual only — AND is the actual behaviour)
	const conjRow = viewBody.createDiv({ cls: "gim-vb-conjunction" });
	conjRow.createSpan({ text: "次のすべてが真 (AND)" });

	// Condition rows
	const rows = deps.settings.where;
	renderConditionRows(viewBody, rows, deps, propertyItems, sources, propertyValueMap, track, "where");

	// Toggle section open/close
	header.addEventListener("click", () => {
		const isOpen = !body.hasClass("is-collapsed");
		body.toggleClass("is-collapsed", isOpen);
		chevron.setText(isOpen ? "▸" : "▾");
	});
}

function renderConditionRows(
	container: HTMLElement,
	rows: string[],
	deps: VisualBuilderDeps,
	propertyItems: DropdownItem[],
	sources: SuggestSources,
	propertyValueMap: Record<string, string[]>,
	track: (h: SearchableDropdownHandle) => SearchableDropdownHandle,
	section: "where" | "groupBy",
): void {
	const rowsContainer = container.createDiv({ cls: "gim-vb-rows" });

	if (rows.length === 0 && section === "where") {
		const empty = rowsContainer.createDiv({ cls: "gim-vb-empty-hint" });
		empty.setText("フィルターが設定されていません。下のボタンから追加してください。");
	}

	for (let idx = 0; idx < rows.length; idx++) {
		const raw = rows[idx];
		if (raw.trim() === "") continue;
		const parsed = parseSimpleRow(raw);

		if (parsed) {
			renderVisualRow(rowsContainer, parsed, raw, idx, rows, deps, propertyItems, sources, propertyValueMap, track, section);
		} else {
			renderAdvancedRow(rowsContainer, raw, idx, rows, deps);
		}
	}

	// Action buttons
	const actions = container.createDiv({ cls: "gim-vb-actions" });
	const addBtn = actions.createEl("button", {
		cls: "gim-vb-add-btn",
		text: section === "where" ? "+ フィルターを追加" : "+ グループ化条件を追加",
	});
	addBtn.addEventListener("click", () => {
		// Add a default row: tag:? for groupBy, empty for where
		if (section === "groupBy") {
			rows.push("tag:?");
		} else {
			rows.push("");
		}
		deps.save();
		deps.rerender();
		deps.rebuild();
	});

	if (section === "where") {
		const groupBtn = actions.createEl("button", {
			cls: "gim-vb-add-btn gim-vb-add-group-btn",
			text: "+ フィルターグループを追加",
		});
		groupBtn.setAttr("disabled", "true");
		groupBtn.setAttr("title", "将来実装: ネストされたAND/ORグループ");
	}
}

function renderVisualRow(
	container: HTMLElement,
	parsed: SimpleCondition,
	raw: string,
	idx: number,
	rows: string[],
	deps: VisualBuilderDeps,
	propertyItems: DropdownItem[],
	sources: SuggestSources,
	propertyValueMap: Record<string, string[]>,
	track: (h: SearchableDropdownHandle) => SearchableDropdownHandle,
	section: "where" | "groupBy",
): void {
	const row = container.createDiv({ cls: "gim-vb-row" });

	// ── Code view state (toggle between visual and raw) ──
	let showingCode = false;
	const codeDisplay = row.createEl("code", { cls: "gim-vb-row-code" });
	codeDisplay.setText(raw);
	codeDisplay.setCssStyles({ display: "none" });

	const visualPart = row.createDiv({ cls: "gim-vb-row-visual" });

	// 1. Property dropdown
	const propId = propertyFromCondition(parsed);
	const propContainer = visualPart.createDiv({ cls: "gim-vb-field-cell" });
	track(createSearchableDropdown(propContainer, {
		items: propertyItems,
		selected: propId,
		placeholder: "プロパティを検索...",
		emptyLabel: "プロパティ",
		onSelect: (newPropId) => {
			// When property changes, reset to a sensible default
			const newOps = operatorsForProperty(newPropId);
			const defaultOp = newOps[0].id;
			const newCond: SimpleCondition = {
				kind: kindFromOperatorId(defaultOp),
				field: newPropId === "tag" ? "tag" : newPropId,
				value: "",
			};
			rows[idx] = stringifySimpleCondition(newCond);
			deps.save();
			deps.rerender();
			deps.rebuild();
		},
	}));

	// 2. Operator dropdown
	const operators = operatorsForProperty(propId);
	const currentOpId = operatorIdFromKind(parsed.kind);
	const opContainer = visualPart.createDiv({ cls: "gim-vb-field-cell" });
	track(createSearchableDropdown(opContainer, {
		items: operators,
		selected: currentOpId,
		placeholder: "演算子を検索...",
		emptyLabel: "演算子",
		onSelect: (newOpId) => {
			const newKind = kindFromOperatorId(newOpId);
			// "any" kinds clear the value
			const isAny = newKind === "tag-any" || newKind === "fm-any";
			const newCond: SimpleCondition = {
				kind: newKind,
				field: parsed.field,
				value: isAny ? "" : parsed.value,
			};
			rows[idx] = stringifySimpleCondition(newCond);
			deps.save();
			deps.rerender();
			deps.rebuild();
		},
	}));

	// 3. Value input (hidden for "any" operators)
	const isAnyOp = parsed.kind === "tag-any" || parsed.kind === "fm-any";
	if (!isAnyOp) {
		const valueInput = visualPart.createEl("input", {
			type: "text",
			cls: "gim-vb-value-input",
		});
		valueInput.value = parsed.value;
		valueInput.placeholder = "値がありません";
		valueInput.spellcheck = false;
		const valueHints = valueCandidatesForProperty(propId, sources, propertyValueMap);
		bindDatalistHints(visualPart, valueInput, valueHints, `gim-vb-${section}-${propId}`);

		let debounce: number | null = null;
		valueInput.addEventListener("input", () => {
			if (debounce !== null) window.clearTimeout(debounce);
			debounce = window.setTimeout(() => {
				const newCond: SimpleCondition = {
					kind: parsed.kind,
					field: parsed.field,
					value: valueInput.value.trim(),
				};
				rows[idx] = stringifySimpleCondition(newCond);
				deps.save();
				deps.rebuild();
			}, 400);
		});
	}

	// 4. Code toggle icon
	const codeBtn = row.createEl("button", {
		cls: "gim-vb-icon-btn",
		attr: { "aria-label": "コード表示切替", title: "コード表示切替" },
	});
	setIcon(codeBtn, "code");
	codeBtn.addEventListener("click", () => {
		showingCode = !showingCode;
		codeDisplay.setCssStyles({ display: showingCode ? "" : "none" });
		visualPart.setCssStyles({ display: showingCode ? "none" : "" });
	});

	// 5. Delete icon
	const delBtn = row.createEl("button", {
		cls: "gim-vb-icon-btn gim-vb-delete-btn",
		attr: { "aria-label": "削除", title: "削除" },
	});
	setIcon(delBtn, "trash-2");
	delBtn.addEventListener("click", () => {
		rows.splice(idx, 1);
		deps.save();
		deps.rerender();
		deps.rebuild();
	});
}

function renderAdvancedRow(
	container: HTMLElement,
	raw: string,
	idx: number,
	rows: string[],
	deps: VisualBuilderDeps,
): void {
	const row = container.createDiv({ cls: "gim-vb-row gim-vb-row-advanced" });

	const codeEl = row.createEl("code", { cls: "gim-vb-row-code-inline" });
	codeEl.setText(raw);
	codeEl.setAttr("title", "Advanced条件 — Advancedエディタで編集してください");

	const delBtn = row.createEl("button", {
		cls: "gim-vb-icon-btn gim-vb-delete-btn",
		attr: { "aria-label": "削除", title: "削除" },
	});
	setIcon(delBtn, "trash-2");
	delBtn.addEventListener("click", () => {
		rows.splice(idx, 1);
		deps.save();
		deps.rerender();
		deps.rebuild();
	});
}

// ── Section 2: Group By ─────────────────────────────────────────────────────

function renderGroupBySection(
	host: HTMLElement,
	deps: VisualBuilderDeps,
	propertyItems: DropdownItem[],
	sources: SuggestSources,
	propertyValueMap: Record<string, string[]>,
	track: (h: SearchableDropdownHandle) => SearchableDropdownHandle,
): void {
	const section = host.createDiv({ cls: "gim-vb-section" });
	const header = section.createDiv({ cls: "gim-vb-section-header" });
	const chevron = header.createSpan({ cls: "gim-vb-chevron", text: "▾" });
	header.createSpan({ text: "グループ化", cls: "gim-vb-section-title" });

	const body = section.createDiv({ cls: "gim-vb-section-body" });

	renderConditionRows(body, deps.settings.groupBy, deps, propertyItems, sources, propertyValueMap, track, "groupBy");

	header.addEventListener("click", () => {
		const isOpen = !body.hasClass("is-collapsed");
		body.toggleClass("is-collapsed", isOpen);
		chevron.setText(isOpen ? "▸" : "▾");
	});
}

// ── Section 3: Group Filter (HAVING) ────────────────────────────────────────

function renderHavingSection(
	host: HTMLElement,
	deps: VisualBuilderDeps,
): void {
	const section = host.createDiv({ cls: "gim-vb-section" });
	const header = section.createDiv({ cls: "gim-vb-section-header" });
	const chevron = header.createSpan({ cls: "gim-vb-chevron", text: "▾" });
	header.createSpan({ text: "グループフィルター", cls: "gim-vb-section-title" });

	// Highlight/Filter mode toggle (migrated from the old HAVING header)
	const modeToggle = header.createEl("button", {
		cls: "gim-vb-icon-btn",
		attr: {
			"aria-label":
				deps.settings.havingMode === "highlight"
					? "フィルターモードに切替"
					: "ハイライトモードに切替",
			title:
				deps.settings.havingMode === "highlight"
					? "フィルターモードに切替"
					: "ハイライトモードに切替",
		},
	});
	setIcon(
		modeToggle,
		deps.settings.havingMode === "highlight" ? "highlighter" : "filter",
	);
	modeToggle.addEventListener("click", (e) => {
		e.stopPropagation();
		deps.settings.havingMode =
			deps.settings.havingMode === "highlight" ? "filter" : "highlight";
		deps.save();
		deps.rerender();
		deps.rebuild();
	});

	// Auto toggle
	const autoLabel = header.createEl("label", { cls: "gim-auto-toggle" });
	const autoCb = autoLabel.createEl("input", { type: "checkbox" });
	autoCb.checked = deps.settings.havingAuto;
	autoCb.addEventListener("click", (e) => e.stopPropagation());
	autoCb.addEventListener("change", () => {
		deps.settings.havingAuto = autoCb.checked;
		deps.save();
		deps.rebuild();
	});
	autoLabel.createSpan({ text: "auto" });

	const body = section.createDiv({ cls: "gim-vb-section-body" });

	const hasGroupBy = deps.settings.groupBy.some((r) => r.trim().length > 0);

	if (!hasGroupBy) {
		const hint = body.createDiv({ cls: "gim-vb-disabled-hint" });
		hint.setText(
			"グループ化を設定するとこのセクションが有効になります。",
		);
	} else {
		renderHavingRows(body, deps);
	}

	header.addEventListener("click", () => {
		const isOpen = !body.hasClass("is-collapsed");
		body.toggleClass("is-collapsed", isOpen);
		chevron.setText(isOpen ? "▸" : "▾");
	});
}

// HAVING aggregate operators
const HAVING_AGGREGATES: DropdownItem[] = [
	{ id: "count", label: "Count" },
];

const HAVING_OPERATORS: DropdownItem[] = [
	{ id: ">=", label: ">=" },
	{ id: "<=", label: "<=" },
	{ id: ">", label: ">" },
	{ id: "<", label: "<" },
	{ id: "==", label: "==" },
	{ id: "!=", label: "!=" },
];

const HAVING_VALUE_HINTS = ["1", "3", "10", "30", "_noteCount * 0.05", "_noteCount * 0.6"];

// Parse a HAVING row like "count >= 3" into parts. Returns null for unparseable.
interface HavingParts {
	aggregate: string;
	operator: string;
	value: string;
}

function parseHavingRow(raw: string): HavingParts | null {
	const m = raw
		.trim()
		.match(/^\s*([A-Za-z_]+)\s*(>=|<=|==|!=|>|<)\s*(.+)\s*$/);
	if (!m) return null;
	return { aggregate: m[1].toLowerCase(), operator: m[2], value: m[3].trim() };
}

function stringifyHavingRow(parts: HavingParts): string {
	return `${parts.aggregate} ${parts.operator} ${parts.value}`;
}

function renderHavingRows(container: HTMLElement, deps: VisualBuilderDeps): void {
	const rows = deps.settings.having;
	const rowsContainer = container.createDiv({ cls: "gim-vb-rows" });

	for (let idx = 0; idx < rows.length; idx++) {
		const raw = rows[idx];
		if (raw.trim() === "") continue;
		const parts = parseHavingRow(raw);

		if (parts) {
			renderHavingVisualRow(rowsContainer, parts, raw, idx, rows, deps);
		} else {
			renderAdvancedRow(rowsContainer, raw, idx, rows, deps);
		}
	}

	// Error display
	if (deps.havingError) {
		const errEl = container.createDiv({ cls: "gim-expr-msg" });
		errEl.setText(deps.havingError);
	}

	// Add button
	const actions = container.createDiv({ cls: "gim-vb-actions" });
	const addBtn = actions.createEl("button", {
		cls: "gim-vb-add-btn",
		text: "+ フィルターを追加",
	});
	addBtn.addEventListener("click", () => {
		rows.push("count >= 1");
		deps.save();
		deps.rerender();
		deps.rebuild();
	});
}

function renderHavingVisualRow(
	container: HTMLElement,
	parts: HavingParts,
	raw: string,
	idx: number,
	rows: string[],
	deps: VisualBuilderDeps,
): void {
	const row = container.createDiv({ cls: "gim-vb-row" });

	let showingCode = false;
	const codeDisplay = row.createEl("code", { cls: "gim-vb-row-code" });
	codeDisplay.setText(raw);
	codeDisplay.setCssStyles({ display: "none" });

	const visualPart = row.createDiv({ cls: "gim-vb-row-visual" });

	// Aggregate selector (Count only for now)
	const aggSel = visualPart.createEl("select", { cls: "gim-vb-select" });
	for (const agg of HAVING_AGGREGATES) {
		const opt = aggSel.createEl("option", { value: agg.id, text: agg.label });
		if (agg.id === parts.aggregate) opt.selected = true;
	}

	// Operator selector
	const opSel = visualPart.createEl("select", { cls: "gim-vb-select" });
	for (const op of HAVING_OPERATORS) {
		const opt = opSel.createEl("option", { value: op.id, text: op.label });
		if (op.id === parts.operator) opt.selected = true;
	}

	// Value input
	const valInput = visualPart.createEl("input", {
		type: "text",
		cls: "gim-vb-value-input gim-vb-having-value",
	});
	valInput.value = parts.value;
	valInput.placeholder = "値";
	bindDatalistHints(visualPart, valInput, HAVING_VALUE_HINTS, "gim-vb-having");

	const commit = (): void => {
		const newParts: HavingParts = {
			aggregate: aggSel.value,
			operator: opSel.value,
			value: valInput.value.trim(),
		};
		rows[idx] = stringifyHavingRow(newParts);
		deps.save();
		deps.rebuild();
	};
	aggSel.addEventListener("change", commit);
	opSel.addEventListener("change", commit);
	valInput.addEventListener("change", commit);

	// Code toggle
	const codeBtn = row.createEl("button", {
		cls: "gim-vb-icon-btn",
		attr: { "aria-label": "コード表示切替", title: "コード表示切替" },
	});
	setIcon(codeBtn, "code");
	codeBtn.addEventListener("click", () => {
		showingCode = !showingCode;
		codeDisplay.setCssStyles({ display: showingCode ? "" : "none" });
		visualPart.setCssStyles({ display: showingCode ? "none" : "" });
	});

	// Delete
	const delBtn = row.createEl("button", {
		cls: "gim-vb-icon-btn gim-vb-delete-btn",
		attr: { "aria-label": "削除", title: "削除" },
	});
	setIcon(delBtn, "trash-2");
	delBtn.addEventListener("click", () => {
		rows.splice(idx, 1);
		deps.save();
		deps.rerender();
		deps.rebuild();
	});
}

// ── Section 4: Limit ────────────────────────────────────────────────────────

function renderLimitSection(
	host: HTMLElement,
	deps: VisualBuilderDeps,
): void {
	const section = host.createDiv({ cls: "gim-vb-section" });
	const header = section.createDiv({ cls: "gim-vb-section-header" });
	const chevron = header.createSpan({ cls: "gim-vb-chevron", text: "▾" });
	header.createSpan({ text: "表示件数", cls: "gim-vb-section-title" });

	// Auto toggle
	const autoLabel = header.createEl("label", { cls: "gim-auto-toggle" });
	const autoCb = autoLabel.createEl("input", { type: "checkbox" });
	autoCb.checked = deps.settings.limitAuto;
	autoCb.addEventListener("click", (e) => e.stopPropagation());
	autoCb.addEventListener("change", () => {
		deps.settings.limitAuto = autoCb.checked;
		deps.save();
		deps.rebuild();
	});
	autoLabel.createSpan({ text: "auto" });

	const body = section.createDiv({ cls: "gim-vb-section-body" });

	// Parse current limit rows into limit/brief values
	const limitRows = deps.settings.limit;
	let limitVal = "";
	let briefVal = "";
	for (const r of limitRows) {
		const trimmed = r.trim().toLowerCase();
		const lm = trimmed.match(/^limit\s+(\d+)$/);
		if (lm) limitVal = lm[1];
		const bm = trimmed.match(/^brief\s+(\d+)$/);
		if (bm) briefVal = bm[1];
	}

	// Limit input
	const limitRow = body.createDiv({ cls: "gim-vb-limit-row" });
	limitRow.createSpan({ text: "表示上限 (Limit):", cls: "gim-vb-limit-label" });
	const limitInput = limitRow.createEl("input", {
		type: "number",
		cls: "gim-vb-number-input",
		attr: { min: "0", step: "1" },
	});
	limitInput.value = limitVal;
	limitInput.placeholder = "無制限";

	// Brief input
	const briefRow = body.createDiv({ cls: "gim-vb-limit-row" });
	briefRow.createSpan({
		text: "概要表示 (Brief):",
		cls: "gim-vb-limit-label",
	});
	const briefInput = briefRow.createEl("input", {
		type: "number",
		cls: "gim-vb-number-input",
		attr: { min: "0", step: "1" },
	});
	briefInput.value = briefVal;
	briefInput.placeholder = "なし";

	const commitLimit = (): void => {
		const newRows: string[] = [];
		const lv = limitInput.value.trim();
		const bv = briefInput.value.trim();
		if (lv && Number(lv) > 0) newRows.push(`limit ${lv}`);
		if (bv && Number(bv) > 0) newRows.push(`brief ${bv}`);
		// Preserve any non-limit/brief rows the user typed in Advanced
		for (const r of deps.settings.limit) {
			const t = r.trim().toLowerCase();
			if (t.startsWith("limit ") || t.startsWith("brief ")) continue;
			if (t.length > 0) newRows.push(r);
		}
		deps.settings.limit = newRows;
		deps.save();
		deps.rebuild();
	};

	limitInput.addEventListener("change", commitLimit);
	briefInput.addEventListener("change", commitLimit);

	// Help text
	const hint = body.createDiv({ cls: "gim-vb-hint" });
	hint.setText("空欄の場合は無制限になります。");

	header.addEventListener("click", () => {
		const isOpen = !body.hasClass("is-collapsed");
		body.toggleClass("is-collapsed", isOpen);
		chevron.setText(isOpen ? "▸" : "▾");
	});
}
