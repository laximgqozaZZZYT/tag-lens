import type { MiniSettings } from "../types";
import { MATRIX_ORDER_CRITERIA, HEATMAP_ORDER_CRITERIA } from "../types";
import type { NodeDisplay } from "../node-display";

export interface MinFontSectionDeps {
	settings: MiniSettings;
	save: () => void;
	requestDraw: () => void;
}

export function renderMinFontSection(parent: HTMLElement, deps: MinFontSectionDeps): void {
	const section = parent.createDiv({ cls: "gim-panel-section" });
	section.createEl("h4", { text: "Min font size (px)" });
	const wrap = section.createDiv({ cls: "gim-min-font-row" });
	const input = wrap.createEl("input", {
		type: "number",
		attr: { min: "0", max: "48", step: "1" },
	});
	input.value = String(deps.settings.minFontPx);
	input.setCssStyles({ width: "60px" });
	const hint = wrap.createSpan({
		cls: "gim-min-font-hint",
		text: "Floor for every label / card font",
	});
	hint.setCssStyles({ marginLeft: "8px" });
	hint.setCssStyles({ color: "var(--text-muted, #7a8aa0)" });
	hint.setCssStyles({ fontSize: "11px" });
	input.addEventListener("change", () => {
		const v = Math.max(0, Math.min(48, Math.floor(Number(input.value) || 0)));
		input.value = String(v);
		if (deps.settings.minFontPx === v) return;
		deps.settings.minFontPx = v;
		deps.save();
		deps.requestDraw();
	});
}

export interface NodeDisplaySectionDeps {
	settings: MiniSettings;
	save: () => void;
	rebuild: () => void;
	clearCardCache: () => void;
	resolveFromCluster: (groupKey: string) => NodeDisplay;
}

export function renderNodeDisplaySection(
	parent: HTMLElement,
	deps: NodeDisplaySectionDeps,
	scope?: { groupKey: string },
): void {
	const section = parent.createDiv({ cls: "gim-panel-section" });
	section.createEl("h4", { text: "Node display" });

	const overrideFor = (): {
		nodeRows?: number;
		nodeCols?: number;
		nodeSizeMode?: "fixed" | "indegree" | "outdegree";
	} => {
		if (!scope) return {};
		let ov = deps.settings.nodeDisplayOverrides[scope.groupKey];
		if (!ov) {
			ov = {};
			deps.settings.nodeDisplayOverrides[scope.groupKey] = ov;
		}
		return ov;
	};
	// In layer scope, look up resolved value (= what the renderer uses)
	// to display as placeholder so the user can see what they'll override.
	const resolvedFor = scope
		? deps.resolveFromCluster(scope.groupKey)
		: {
				nodeRows: deps.settings.nodeRows,
				nodeCols: deps.settings.nodeCols,
				nodeSizeMode: deps.settings.nodeSizeMode,
			};

	// "Size (m × n)". For layer scope, empty value means "use inherited".
	const sizeRow = section.createDiv({ cls: "gim-order-row" });
	sizeRow.createSpan({ text: "Size (m × n)", cls: "gim-order-field" });
	const mIn = sizeRow.createEl("input", { type: "number" });
	const nIn = (() => {
		sizeRow.createSpan({ text: "×" });
		return sizeRow.createEl("input", { type: "number" });
	})();
	mIn.min = nIn.min = "1";
	mIn.max = nIn.max = "8";
	mIn.step = nIn.step = "1";
	mIn.setCssStyles({ width: "50px" });
	nIn.setCssStyles({ width: "50px" });
	if (scope) {
		const ov = deps.settings.nodeDisplayOverrides[scope.groupKey];
		mIn.value = ov?.nodeRows !== undefined ? String(ov.nodeRows) : "";
		nIn.value = ov?.nodeCols !== undefined ? String(ov.nodeCols) : "";
		mIn.placeholder = String(resolvedFor.nodeRows);
		nIn.placeholder = String(resolvedFor.nodeCols);
	} else {
		mIn.value = String(deps.settings.nodeRows);
		nIn.value = String(deps.settings.nodeCols);
	}
	const applySize = (): void => {
		const m = parseInt(mIn.value, 10);
		const n = parseInt(nIn.value, 10);
		if (scope) {
			const ov = overrideFor();
			if (Number.isFinite(m) && m >= 1 && m <= 8) ov.nodeRows = m;
			else delete ov.nodeRows;
			if (Number.isFinite(n) && n >= 1 && n <= 8) ov.nodeCols = n;
			else delete ov.nodeCols;
			if (
				ov.nodeRows === undefined &&
				ov.nodeCols === undefined &&
				ov.nodeSizeMode === undefined
			) {
				delete deps.settings.nodeDisplayOverrides[scope.groupKey];
			}
		} else {
			if (Number.isFinite(m) && m >= 1 && m <= 12) deps.settings.nodeRows = m;
			if (Number.isFinite(n) && n >= 1 && n <= 12) deps.settings.nodeCols = n;
		}
		deps.clearCardCache();
		deps.save();
		deps.rebuild();
	};
	mIn.addEventListener("change", applySize);
	nIn.addEventListener("change", applySize);

	if (scope) {
		const modeRow = section.createDiv({ cls: "gim-order-row" });
		modeRow.createSpan({ text: "Size by", cls: "gim-order-field" });
		const sel = modeRow.createEl("select", { cls: "gim-order-dir" });
		const formatSizeMode = (m: "fixed" | "indegree" | "outdegree"): string => {
			return m === "fixed" ? "Fixed" : m === "indegree" ? "Incoming" : "Outgoing";
		};
		sel.createEl("option", {
			value: "",
			text: `Inherited (${formatSizeMode(resolvedFor.nodeSizeMode)})`,
		});
		for (const opt of [
			{ v: "fixed", t: "Fixed" },
			{ v: "indegree", t: "Incoming links" },
			{ v: "outdegree", t: "Outgoing links" },
		]) {
			sel.createEl("option", { value: opt.v, text: opt.t });
		}
		const ov = deps.settings.nodeDisplayOverrides[scope.groupKey];
		sel.value = ov?.nodeSizeMode ?? "";
		sel.addEventListener("change", () => {
			const ov = overrideFor();
			if (sel.value === "") delete ov.nodeSizeMode;
			else
				ov.nodeSizeMode = sel.value as
					| "fixed"
					| "indegree"
					| "outdegree";
			if (
				ov.nodeRows === undefined &&
				ov.nodeCols === undefined &&
				ov.nodeSizeMode === undefined
			) {
				delete deps.settings.nodeDisplayOverrides[scope.groupKey];
			}
			deps.clearCardCache();
			deps.save();
			deps.rebuild();
		});
	}
}

export interface GenericSectionDeps {
	settings: MiniSettings;
	save: () => void;
	rebuild: () => void;
	requestDraw?: () => void;
	refreshSettingsTab?: () => void;
	rebuildMatrixDisplay?: () => void;
}

export function renderMatrixOrderBySection(parent: HTMLElement, deps: GenericSectionDeps): void {
	const section = parent.createDiv({ cls: "gim-panel-section" });
	const header = section.createDiv({ cls: "gim-panel-section-header" });
	header.createEl("h4", { text: "ORDER_BY" });

	const row = section.createDiv({ cls: "gim-order-row" });
	const fieldSel = row.createEl("select", { cls: "gim-order-field" });
	const current = deps.settings.matrixBlockPriority
		? "block-priority"
		: "co-occurrence";
	for (const o of MATRIX_ORDER_CRITERIA) {
		const opt = fieldSel.createEl("option", { value: o.value, text: o.text });
		if (o.value === current) opt.selected = true;
	}
	fieldSel.addEventListener("change", () => {
		deps.settings.matrixSort = "cooccurrence";
		deps.settings.matrixBlockPriority = fieldSel.value === "block-priority";
		deps.save();
		deps.rebuild();
	});

	const dirSel = row.createEl("select", { cls: "gim-order-dir" });
	for (const d of ["asc", "desc"] as const) {
		const opt = dirSel.createEl("option", { value: d, text: d });
		if (deps.settings.matrixSortDir === d) opt.selected = true;
	}
	dirSel.addEventListener("change", () => {
		deps.settings.matrixSortDir = dirSel.value as "asc" | "desc";
		deps.save();
		deps.rebuild();
	});
}

export function renderMatrixMinColumnControl(section: HTMLElement, deps: GenericSectionDeps): void {
	const row = section.createDiv({ cls: "gim-order-row" });
	row.createSpan({ text: "Min column size", cls: "gim-order-field" });
	const inp = row.createEl("input", { type: "number" });
	inp.min = "1";
	inp.setCssStyles({ width: "56px" });
	inp.value = String(deps.settings.matrixMinColumnSize);
	inp.addEventListener("change", () => {
		const v = Math.max(1, Math.floor(Number(inp.value) || 1));
		deps.settings.matrixMinColumnSize = v;
		inp.value = String(v);
		deps.save();
		deps.rebuild();
	});
}

export function renderHeatmapOrderBySection(parent: HTMLElement, deps: GenericSectionDeps): void {
	const section = parent.createDiv({ cls: "gim-panel-section" });
	const header = section.createDiv({ cls: "gim-panel-section-header" });
	header.createEl("h4", { text: "ORDER_BY" });
	const row = section.createDiv({ cls: "gim-order-row" });
	const fieldSel = row.createEl("select", { cls: "gim-order-field" });
	for (const o of HEATMAP_ORDER_CRITERIA) {
		const opt = fieldSel.createEl("option", { value: o.value, text: o.text });
		if (o.value === deps.settings.heatmapCriterion) opt.selected = true;
	}
	fieldSel.addEventListener("change", () => {
		deps.settings.heatmapCriterion = fieldSel.value as "co-occurrence" | "size";
		deps.save();
		deps.rebuild();
	});
	const dirSel = row.createEl("select", { cls: "gim-order-dir" });
	for (const d of ["asc", "desc"] as const) {
		const opt = dirSel.createEl("option", { value: d, text: d });
		if (deps.settings.heatmapSortDir === d) opt.selected = true;
	}
	dirSel.addEventListener("change", () => {
		deps.settings.heatmapSortDir = dirSel.value as "asc" | "desc";
		deps.save();
		deps.rebuild();
	});

	const jaccardRow = section.createEl("label", { cls: "gim-toggle-row" });
	const jaccardCb = jaccardRow.createEl("input", { type: "checkbox" });
	jaccardCb.checked = deps.settings.heatmapJaccard;
	jaccardCb.addEventListener("change", () => {
		deps.settings.heatmapJaccard = jaccardCb.checked;
		deps.save();
		deps.requestDraw?.();
	});
	jaccardRow.createSpan({ text: "Jaccard similarity color scale" });

	const gapRow = section.createEl("label", { cls: "gim-toggle-row" });
	const gapCb = gapRow.createEl("input", { type: "checkbox" });
	gapCb.checked = deps.settings.gapFinder;
	gapCb.addEventListener("change", () => {
		deps.settings.gapFinder = gapCb.checked;
		deps.save();
		deps.rebuild();
	});
	gapRow.createSpan({ text: "Highlight gaps" });
}

export function renderHeatmapMinTagControl(section: HTMLElement, deps: GenericSectionDeps): void {
	const row = section.createDiv({ cls: "gim-order-row" });
	row.createSpan({ text: "Min tag size", cls: "gim-order-field" });
	const inp = row.createEl("input", { type: "number" });
	inp.min = "1";
	inp.setCssStyles({ width: "56px" });
	inp.value = String(deps.settings.heatmapMinTagSize);
	inp.addEventListener("change", () => {
		const v = Math.max(1, Math.floor(Number(inp.value) || 1));
		deps.settings.heatmapMinTagSize = v;
		inp.value = String(v);
		deps.save();
		deps.rebuild();
	});
}

export function renderHeatmapDisplayToggles(section: HTMLElement, deps: GenericSectionDeps): void {
	const row = section.createEl("label", { cls: "gim-toggle-row" });
	const cb = row.createEl("input", { type: "checkbox" });
	cb.checked = deps.settings.heatmapJaccard;
	cb.addEventListener("change", () => {
		deps.settings.heatmapJaccard = cb.checked;
		deps.save();
		deps.requestDraw?.();
	});
	row.createSpan({ text: "Jaccard color scale" });
}

export function renderMatrixDisplayToggles(section: HTMLElement, deps: GenericSectionDeps): void {
	const add = (
		label: string,
		get: () => boolean,
		set: (v: boolean) => void,
		enabled: boolean,
	): void => {
		const row = section.createEl("label", { cls: "gim-toggle-row" });
		if (!enabled) row.setCssStyles({ opacity: "0.45" });
		const cb = row.createEl("input", { type: "checkbox" });
		cb.checked = get();
		cb.disabled = !enabled;
		cb.addEventListener("change", () => {
			set(cb.checked);
			deps.save();
			deps.refreshSettingsTab?.();
			deps.rebuildMatrixDisplay?.();
			deps.requestDraw?.();
		});
		row.createSpan({ text: label });
	};
	add(
		"Group identical rows",
		() => deps.settings.matrixGroupBySignature,
		(v) => (deps.settings.matrixGroupBySignature = v),
		true,
	);
	add(
		"Collapse groups",
		() => deps.settings.matrixCollapseGroups,
		(v) => (deps.settings.matrixCollapseGroups = v),
		deps.settings.matrixGroupBySignature,
	);
}
