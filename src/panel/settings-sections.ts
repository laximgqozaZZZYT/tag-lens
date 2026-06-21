import type { MiniSettings } from "../types";
import { MATRIX_ORDER_CRITERIA, HEATMAP_ORDER_CRITERIA, VIEW_MODES, isPanorama, isCloseup } from "../types";
import type { NodeDisplay } from "../visual/node-display";

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
				ov.nodeCols === undefined
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


}

export interface StreamSectionDeps {
	settings: MiniSettings;
	save: () => void;
	scheduleRebuild: () => void;
}

export function renderStreamDisplayToggles(section: HTMLElement, deps: StreamSectionDeps): void {
	section.createEl("h4", { text: "Sequence Stream", cls: "gim-panel-heading" });

	const axisRow = section.createDiv({ cls: "gim-setting-row" });
	axisRow.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" });
	axisRow.createSpan({ text: "Axis field:" });
	const axisInput = axisRow.createEl("input", { type: "text", cls: "gim-text-input" });
	axisInput.setCssStyles({ width: "100px" });
	axisInput.value = deps.settings.streamAxisField;
	axisInput.addEventListener("change", () => {
		deps.settings.streamAxisField = axisInput.value.trim() || "mtime";
		deps.save();
		deps.scheduleRebuild();
	});

	const binRow = section.createDiv({ cls: "gim-setting-row" });
	binRow.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" });
	binRow.createSpan({ text: "Binning:" });
	const binSel = binRow.createEl("select");
	binSel.add(new Option("Value", "value"));
	binSel.add(new Option("Month", "month"));
	binSel.add(new Option("Week", "week"));
	binSel.value = deps.settings.streamBinning;
	binSel.addEventListener("change", () => {
		deps.settings.streamBinning = binSel.value as MiniSettings["streamBinning"];
		deps.save();
		deps.scheduleRebuild();
	});

	const rowSortRow = section.createDiv({ cls: "gim-setting-row" });
	rowSortRow.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" });
	rowSortRow.createSpan({ text: "Row sort:" });
	const rsSel = rowSortRow.createEl("select");
	rsSel.add(new Option("Size", "size"));
	rsSel.add(new Option("First appearance", "first-appearance"));
	rsSel.value = deps.settings.streamRowSort;
	rsSel.addEventListener("change", () => {
		deps.settings.streamRowSort = rsSel.value as MiniSettings["streamRowSort"];
		deps.save();
		deps.scheduleRebuild();
	});
}

export function renderLatticeSection(parent: HTMLElement, deps: GenericSectionDeps): void {
	const section = parent.createDiv({ cls: "gim-panel-section" });
	section.createEl("h4", { text: "Lattice" });

	const lodRow = section.createDiv({ cls: "gim-row" });
	lodRow.createSpan({ text: "Node LOD" });
	const lodSel = lodRow.createEl("select");
	const lodOpts: Array<[string, string]> = [
		["auto", "Auto (zoom-based)"],
		["overview", "Overview"],
		["density", "Density"],
		["individual", "Individual"],
	];
	for (const [v, label] of lodOpts) {
		const o = lodSel.createEl("option", { text: label });
		o.value = v;
		if (deps.settings.latticeNodeLOD === v) o.selected = true;
	}
	lodSel.addEventListener("change", () => {
		deps.settings.latticeNodeLOD = lodSel.value as MiniSettings["latticeNodeLOD"];
		deps.save();
		deps.rebuild();
	});

	const minRow = section.createDiv({ cls: "gim-row" });
	minRow.createSpan({ text: "Min intersection size" });
	const minIn = minRow.createEl("input", {
		type: "number",
		attr: { min: "1", step: "1" },
	});
	minIn.value = String(deps.settings.latticeMinNodeSize);
	minIn.setCssStyles({ width: "60px" });
	minIn.addEventListener("change", () => {
		const v = Math.max(1, Math.floor(Number(minIn.value) || 1));
		deps.settings.latticeMinNodeSize = v;
		minIn.value = String(v);
		deps.save();
		deps.rebuild();
	});

	const capRow = section.createDiv({ cls: "gim-row" });
	capRow.createSpan({ text: "Max nodes per tier" });
	const capIn = capRow.createEl("input", {
		type: "number",
		attr: { min: "1", step: "1" },
	});
	capIn.value = String(deps.settings.latticeMaxNodesPerTier);
	capIn.setCssStyles({ width: "60px" });
	capIn.addEventListener("change", () => {
		const v = Math.max(1, Math.floor(Number(capIn.value) || 1));
		deps.settings.latticeMaxNodesPerTier = v;
		capIn.value = String(v);
		deps.save();
		deps.rebuild();
	});

	const namedRow = section.createDiv({ cls: "gim-row" });
	namedRow.createSpan({ text: "Max names per node" });
	const namedIn = namedRow.createEl("input", {
		type: "number",
		attr: { min: "1", step: "1" },
	});
	namedIn.value = String(deps.settings.latticeNamedMax);
	namedIn.setCssStyles({ width: "60px" });
	namedIn.addEventListener("change", () => {
		const v = Math.max(1, Math.floor(Number(namedIn.value) || 1));
		deps.settings.latticeNamedMax = v;
		namedIn.value = String(v);
		deps.save();
		deps.rebuild();
	});

	const linkRow = section.createEl("label", { cls: "gim-toggle-row" });
	const linkCb = linkRow.createEl("input", { type: "checkbox" });
	linkCb.checked = deps.settings.latticeShowSubsetLinks;
	linkCb.addEventListener("change", () => {
		deps.settings.latticeShowSubsetLinks = linkCb.checked;
		deps.save();
		deps.requestDraw?.();
	});
	linkRow.createSpan({ text: "Show subset links" });

	const topRow = section.createEl("label", { cls: "gim-toggle-row" });
	const topCb = topRow.createEl("input", { type: "checkbox" });
	topCb.checked = deps.settings.latticeSpecificTop;
	topCb.addEventListener("change", () => {
		deps.settings.latticeSpecificTop = topCb.checked;
		deps.save();
		deps.rebuild();
	});
	topRow.createSpan({ text: "Most-specific tier on top" });
}

export function renderViewModeOption(
	container: HTMLElement,
	opt: (typeof VIEW_MODES)[number],
	deps: GenericSectionDeps,
	type: "panorama" | "closeup"
): void {
	const item = container.createEl("label", { cls: "gim-viewmode-option" });
	const input = item.createEl("input", {
		type: "radio",
		attr: { name: `gim-viewmode-${type}` },
	});
	input.value = opt.id;
	
	if (type === "panorama") {
		input.checked = deps.settings.panoramaMode === opt.id;
	} else {
		input.checked = deps.settings.closeupMode === opt.id;
	}

	input.addEventListener("change", () => {
		if (!input.checked) return;
		const next = input.value as MiniSettings["viewMode"];

		// Clicking a radio is navigation, not just a remembered preference:
		// it must always switch the live canvas to that mode (and its
		// perspective), even when the panel is currently showing the other
		// perspective. Previously the panorama/closeup mode was only updated
		// when its own perspective was already active, so e.g. clicking
		// "Co-occurrence heatmap" (Panorama) while viewing BubbleSets
		// (Close-up) silently recorded the preference without ever drawing
		// heatmap or its legend — the radio looked selected but nothing
		// visibly happened.
		let changed = false;
		if (type === "panorama") {
			if (deps.settings.panoramaMode !== next) {
				deps.settings.panoramaMode = next;
				changed = true;
			}
			if (deps.settings.perspective !== "panorama" || deps.settings.viewMode !== next) {
				deps.settings.perspective = "panorama";
				deps.settings.viewMode = next;
				changed = true;
			}
			// Returning to Panorama must show the WHOLE vault again, same as the
			// toolbar's "Return to Panorama" button (see view.ts switchToPanorama).
			// Close-up leaves `focusNodeIds` set to its (sub)set of notes; without
			// clearing it here, navigating to Panorama via this radio kept the
			// graph filtered to that stale closeup subset — vault-wide content
			// never reappeared (the actual regression this fix addresses).
			if (deps.settings.focusNodeIds !== undefined) {
				delete deps.settings.focusNodeIds;
				changed = true;
			}
		} else {
			if (deps.settings.closeupMode !== next) {
				deps.settings.closeupMode = next;
				changed = true;
			}
			if (deps.settings.perspective !== "closeup" || deps.settings.viewMode !== next) {
				deps.settings.perspective = "closeup";
				deps.settings.viewMode = next;
				changed = true;
			}
		}

		if (!changed) return;

		deps.save();
		deps.rebuild();
		deps.refreshSettingsTab?.();
	});
	const text = item.createDiv({ cls: "gim-viewmode-text" });
	text.createEl("strong", {
		text: opt.experimental ? `${opt.label} (beta)` : opt.label,
	});
	if (opt.description) {
		text.createEl("span", { cls: "gim-viewmode-desc", text: opt.description });
	}
}

export function renderViewModeSection(parent: HTMLElement, deps: GenericSectionDeps): void {
	const section = parent.createDiv({ cls: "gim-panel-section" });
	section.createEl("h4", { text: "View mode" });

	// Close-up: per-node detail views (currently Icon Gallery only).
	const closeup = VIEW_MODES.filter((o) => isCloseup(o));
	if (closeup.length > 0) {
		const closeupHeader = section.createDiv({ cls: "gim-viewmode-perspective-header" });
		closeupHeader.setCssStyles({ margin: "4px 0 2px", fontSize: "11px", color: "var(--text-muted)", fontWeight: "600" });
		closeupHeader.createSpan({ text: "Close-up" });
		const closeupGroup = section.createDiv({ cls: "gim-viewmode-options" });
		for (const opt of closeup) renderViewModeOption(closeupGroup, opt, deps, "closeup");
	}

	// Panorama: vault-wide structural overview modes (non-experimental).
	const panoramaStable = VIEW_MODES.filter((o) => isPanorama(o) && !o.experimental);
	if (panoramaStable.length > 0) {
		const panoramaHeader = section.createDiv({ cls: "gim-viewmode-perspective-header" });
		panoramaHeader.setCssStyles({ margin: "8px 0 2px", fontSize: "11px", color: "var(--text-muted)", fontWeight: "600" });
		panoramaHeader.createSpan({ text: "Panorama" });
		const panoramaGroup = section.createDiv({ cls: "gim-viewmode-options" });
		for (const opt of panoramaStable) renderViewModeOption(panoramaGroup, opt, deps, "panorama");
	}

	// Experimental (beta): collapsible, regardless of perspective.
	const experimental = VIEW_MODES.filter((o) => o.experimental);
	if (experimental.length === 0) return;
	const expSelected = experimental.some((o) => o.id === deps.settings.viewMode);

	const header = section.createDiv({ cls: "gim-viewmode-exp-header" });
	header.setCssStyles({
		cursor: "pointer",
		userSelect: "none",
		margin: "8px 0 4px",
		fontSize: "12px",
		color: "var(--text-muted)",
	});
	const caret = header.createSpan({ text: expSelected ? "▾ " : "▸ " });
	header.createSpan({ text: "Experimental (beta)" });

	const expGroup = section.createDiv({ cls: "gim-viewmode-options" });
	expGroup.setCssStyles({ display: expSelected ? "" : "none" });
	for (const opt of experimental) {
		const type = isCloseup(opt) ? "closeup" : "panorama";
		renderViewModeOption(expGroup, opt, deps, type);
	}

	header.addEventListener("click", () => {
		const open = expGroup.style.display === "none";
		expGroup.setCssStyles({ display: open ? "" : "none" });
		caret.setText(open ? "▾ " : "▸ ");
	});

}

export function renderBipartiteSection(parent: HTMLElement, deps: GenericSectionDeps): void {
	const section = parent.createDiv({ cls: "gim-panel-section" });
	section.createEl("h4", { text: "Tag graph" });

	const layRow = section.createDiv({ cls: "gim-order-row" });
	layRow.createSpan({ text: "Layout", cls: "gim-order-field" });
	const laySel = layRow.createEl("select");
	for (const [val, label] of [
		["force", "Force"],
		["concentric", "Concentric"],
		["clustered", "Clustered"],
	] as const) {
		const o = laySel.createEl("option", { value: val, text: label });
		if (val === deps.settings.bipartiteLayout) o.selected = true;
	}
	laySel.addEventListener("change", () => {
		deps.settings.bipartiteLayout = laySel.value as
			| "force"
			| "concentric"
			| "clustered";
		deps.save();
		deps.rebuild();
	});

	const row = section.createDiv({ cls: "gim-order-row" });
	row.createSpan({ text: "Max tags", cls: "gim-order-field" });
	const inp = row.createEl("input", { type: "number" });
	inp.min = "1";
	inp.setCssStyles({ width: "56px" });
	inp.value = String(deps.settings.bipartiteMaxTags);
	inp.addEventListener("change", () => {
		const v = Math.max(1, Math.floor(Number(inp.value) || 1));
		deps.settings.bipartiteMaxTags = v;
		inp.value = String(v);
		deps.save();
		deps.rebuild();
	});
	section.createEl("p", {
		cls: "gim-panel-hint",
		text: "Singleton + giant (>40% of notes) tags are dropped first; then the top-N by size are kept. Click a tag node to highlight its notes; click a note to open it.",
	});
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
	header.createEl("h4", { text: "Sort columns by" });

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
	header.createEl("h4", { text: "Sort tags by" });
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
