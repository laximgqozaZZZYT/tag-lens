import type { MiniSettings } from "../types";
import {
	renderViewModeSection,
	renderBipartiteSection,
} from "./settings-sections";
import {
	renderOrderBySection,
	renderExprSection,
	renderPresetSection,
} from "./panel-sections";
import { setIcon, Notice } from "obsidian";
import { applyLens, captureLens, upsertPreset, removePreset } from "../interaction/lens-presets";
import { displayToggleApplies } from "../visual/display-applicability";
import type { LensPreset } from "../types";
import { fieldSourceRegistry } from "../encoding/field-sources";
import { shapeForKey } from "../encoding/shapes";
import type { EncodingBinding, ScaleType } from "../encoding/types";
import type { BindingLegend } from "../encoding/evaluate";
import { clusterHue } from "../draw/canvas-utils";
import { theme } from "../draw/theme";
import {
	renderMatrixMinColumnControl,
	renderHeatmapMinTagControl,
	renderNodeDisplaySection,
	renderMinFontSection,
	renderMatrixDisplayToggles,
	renderHeatmapDisplayToggles,
	renderStreamDisplayToggles,
} from "./settings-sections";
import {
	renderToggleSection,
	toggleArrayMember,
} from "./panel-sections";
import type { LaidOut } from "../layout/layout";
import {
	UNION_LAYER_KEY,
	INTERSECTION_LAYER_KEY,
	SET_LAYER_KEYS,
	SET_LAYER_LABEL,
	type NodeDisplay,
} from "../visual/node-display";

export interface ViewTabDeps {
	settings: MiniSettings;
	save: () => void;
	rebuild: () => void;
	refreshSettingsTab: () => void;
	requestDraw: () => void;
}

export function renderSettingsViewTab(el: HTMLElement, deps: ViewTabDeps): void {
	renderViewModeSection(el, deps);
	if (deps.settings.viewMode === "bipartite") renderBipartiteSection(el, deps);
}

export interface SortTabDeps {
	settings: MiniSettings;
	save: () => void;
	rebuild: () => void;
	limitError: string | null;
	rerender?: () => void;
}

export function renderSettingsSortTab(el: HTMLElement, deps: SortTabDeps): void {
	renderOrderBySection(el, {
		settings: deps.settings,
		save: deps.save,
	});
	renderExprSection(
		el,
		"LIMIT",
		deps.settings.limit,
		deps.limitError ?? "",
		{ settings: deps.settings, save: deps.save, rebuild: deps.rebuild, rerender: deps.rerender ?? (() => {}) },
		{ placeholder: "limit 10 / brief 30", autoKey: "limitAuto" }
	);
}

export interface FilterTabDeps {
	settings: MiniSettings;
	save: () => void;
	rebuild: () => void;
	refreshFilterTab: () => void;
	refreshSettingsTab: () => void;
	whereError: string | null;
	groupByError: string | null;
	havingError: string | null;
	limitError: string | null;
	syncLensCommands?: (presets: LensPreset[]) => void;
}

export function renderSettingsFilterTab(el: HTMLElement, deps: FilterTabDeps): void {
	const isMatrix = deps.settings.viewMode === "matrix";
	const isHeatmap = deps.settings.viewMode === "heatmap";
	if (deps.settings.filterMode === "dvjs") {
		const info = el.createDiv({ text: "Return an array of paths or Dataview pages. Example:\nreturn dv.pages('\"\"').map(p => p.file.path).array();" });
		info.setCssStyles({ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px", whiteSpace: "pre-wrap" });
		
		const textarea = el.createEl("textarea", { cls: "gim-expr-input" });
		textarea.value = deps.settings.dvjsFilter;
		textarea.setCssStyles({ width: "100%", minHeight: "120px", fontFamily: "var(--font-monospace)", fontSize: "11px", resize: "vertical" });
		
		let debounce: number | null = null;
		textarea.addEventListener("input", () => {
			deps.settings.dvjsFilter = textarea.value;
			deps.save();
			if (debounce !== null) window.clearTimeout(debounce);
			debounce = window.setTimeout(() => deps.rebuild(), 600);
		});
		
		if (deps.whereError) {
			const errorDiv = el.createDiv({ text: deps.whereError });
			errorDiv.setCssStyles({ color: "var(--text-error)", fontSize: "11px", marginTop: "4px" });
		}
	} else {
		renderExprSection(
			el,
			"WHERE",
			deps.settings.where,
			deps.whereError ?? "",
			{ settings: deps.settings, save: deps.save, rebuild: deps.rebuild, rerender: () => { deps.refreshSettingsTab(); deps.refreshFilterTab(); } },
			{ autoKey: "whereAuto" }
		);
	}
	
	const expandRow = el.createEl("label", { cls: "gim-toggle-row" });
	expandRow.setCssStyles({ marginTop: "8px", marginBottom: "8px" });
	const expandCb = expandRow.createEl("input", { type: "checkbox" });
	expandCb.checked = deps.settings.expandNeighborhood;
	expandCb.addEventListener("change", () => {
		deps.settings.expandNeighborhood = expandCb.checked;
		deps.save();
		deps.rebuild();
	});
	expandRow.createSpan({ text: "Include 1-hop links & backlinks" });

	renderExprSection(
		el,
		"GROUP_BY",
		deps.settings.groupBy,
		deps.groupByError ?? "",
		{ settings: deps.settings, save: deps.save, rebuild: deps.rebuild, rerender: () => { deps.refreshSettingsTab(); deps.refreshFilterTab(); } },
		{ autoKey: "groupByAuto" }
	);
	const havingSection = renderExprSection(
		el,
		"HAVING",
		deps.settings.having,
		deps.havingError ?? "",
		{ settings: deps.settings, save: deps.save, rebuild: deps.rebuild, rerender: () => { deps.refreshSettingsTab(); deps.refreshFilterTab(); } },
		{ placeholder: "e.g. count >= 3", autoKey: "havingAuto" }
	);
	const havingHeader = havingSection.querySelector(".gim-panel-section-header") as HTMLElement;
	if (havingHeader) {
		const modeToggle = havingHeader.createEl("a", { cls: "view-action clickable-icon", title: "Toggle highlight mode" });
		modeToggle.setAttribute("aria-label", deps.settings.havingMode === "highlight" ? "Switch to filter mode" : "Switch to highlight mode");
		setIcon(modeToggle, deps.settings.havingMode === "highlight" ? "highlighter" : "filter");
		modeToggle.addEventListener("click", () => {
			deps.settings.havingMode = deps.settings.havingMode === "highlight" ? "filter" : "highlight";
			deps.save();
			deps.refreshFilterTab();
			deps.rebuild();
		});
	}
	// Matrix "min column size" / heatmap "min tag size" are tag filters.
	if (isMatrix) renderMatrixMinColumnControl(havingSection, deps);
	if (isHeatmap) renderHeatmapMinTagControl(havingSection, deps);
}

export interface FilterBodyDeps extends FilterTabDeps, SortTabDeps {
	syncLensCommands?: (presets: LensPreset[]) => void;
}

export function renderFilterBodyTab(host: HTMLElement, deps: FilterBodyDeps): void {
	host.empty();
	
	renderPresetSection(host, {
		settings: deps.settings,
		save: deps.save,
		rerender: deps.refreshFilterTab,
		rebuild: deps.rebuild,
		applyPreset: (name) => {
			const preset = deps.settings.lensPresets.find(p => p.name === name);
			if (preset) {
				applyLens(deps.settings, preset);
				deps.save();
				deps.refreshFilterTab();
				deps.rebuild();
			}
		},
		savePreset: (name) => {
			deps.settings.lensPresets = upsertPreset(deps.settings.lensPresets, name, captureLens(deps.settings), deps.settings.encoding);
			deps.save();
			deps.refreshFilterTab();
			if (deps.syncLensCommands) {
				deps.syncLensCommands(deps.settings.lensPresets);
			}
		},
		removePreset: (name) => {
			deps.settings.lensPresets = removePreset(deps.settings.lensPresets, name);
			deps.save();
			deps.refreshFilterTab();
			new Notice(`Lens '${name}' deleted. Note: its command palette entry will disappear on next reload.`);
		}
	});

	// Split into two sub-panels: Filter and Sort
	const filterHeader = host.createDiv({ cls: "gim-panel-section" });
	filterHeader.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", borderBottom: "none" });
	
	const title = filterHeader.createEl("h4", { text: "Filter & Group", cls: "gim-panel-title" });
	title.setCssStyles({ margin: "0" });

	const modeToggle = filterHeader.createEl("a", { cls: "view-action clickable-icon" });
	modeToggle.setAttribute("aria-label", deps.settings.filterMode === "dvjs" ? "Switch to SQL Mode" : "Switch to DataviewJS Mode");
	setIcon(modeToggle, deps.settings.filterMode === "dvjs" ? "database" : "code");
	
	modeToggle.addEventListener("click", () => {
		deps.settings.filterMode = deps.settings.filterMode === "dvjs" ? "sql" : "dvjs";
		deps.save();
		deps.refreshFilterTab();
		deps.rebuild();
	});

	const filterSection = host.createDiv({ cls: "gim-panel-section" });
	renderSettingsFilterTab(filterSection, deps);

	const sortSection = host.createDiv({ cls: "gim-panel-section" });
	sortSection.createEl("h4", { text: "Sort" });
	renderSettingsSortTab(sortSection, { ...deps, rerender: () => { deps.refreshSettingsTab(); deps.refreshFilterTab(); } });
}

export interface DisplayTabDeps {
	settings: MiniSettings;
	save: () => void;
	rebuild: () => void;
	requestDraw: () => void;
	refreshSettingsTab: () => void;
	rebuildMatrixDisplay?: () => void;
	scheduleRebuild?: () => void;
	clearCardCache: () => void;
	resolveFromCluster: (groupKey: string) => NodeDisplay;
}

export function renderSettingsDisplayTab(el: HTMLElement, deps: DisplayTabDeps): void {
	const isMatrix = deps.settings.viewMode === "matrix";
	const isHeatmap = deps.settings.viewMode === "heatmap";

	const autoFollowSection = el.createDiv({ cls: "gim-panel-section" });
	autoFollowSection.createEl("h4", { text: "Active Note View" });
	const autoFollowRow = autoFollowSection.createEl("label", { cls: "gim-toggle-row" });
	const autoFollowCb = autoFollowRow.createEl("input", { type: "checkbox" });
	autoFollowCb.checked = deps.settings.autoFollowActiveNote;
	autoFollowCb.addEventListener("change", () => {
		deps.settings.autoFollowActiveNote = autoFollowCb.checked;
		deps.save();
	});
	autoFollowRow.createSpan({ text: "Auto-follow active note" });

	renderNodeDisplaySection(el, deps);
	renderMinFontSection(el, deps);

	const gdToggles = [
		{ key: "showNodes" as const, label: "Show nodes" },
		{ key: "showEnclosures" as const, label: "Show enclosures" },
		{ key: "showEdges" as const, label: "Show edges" },
		{ key: "showGrid" as const, label: "Show grid" },
	].filter((t) => displayToggleApplies(deps.settings.viewMode, t.key));
	
	const hasModeToggles = isMatrix || isHeatmap || deps.settings.viewMode === "stream";
	if (gdToggles.length > 0 || hasModeToggles) {
		const gdSection = renderToggleSection(
			el,
			{ settings: deps.settings, save: deps.save, redraw: deps.requestDraw },
			"Graph display",
			gdToggles
		);
		if (isMatrix) renderMatrixDisplayToggles(gdSection, deps);
		if (isHeatmap) renderHeatmapDisplayToggles(gdSection, deps);
		if (deps.settings.viewMode === "stream" && deps.scheduleRebuild) {
			renderStreamDisplayToggles(gdSection, {
				settings: deps.settings,
				save: deps.save,
				scheduleRebuild: deps.scheduleRebuild
			});
		}
	}

	if (displayToggleApplies(deps.settings.viewMode, "showEdges")) {
		const bridgeSection = el.createDiv({ cls: "gim-panel-section" });
		bridgeSection.createEl("h4", { text: "Bridge finder" });
		
		const ghostRow = bridgeSection.createEl("label", { cls: "gim-toggle-row" });
		const ghostCb = ghostRow.createEl("input", { type: "checkbox" });
		ghostCb.checked = deps.settings.showGhostEdges;
		ghostCb.addEventListener("change", () => {
			deps.settings.showGhostEdges = ghostCb.checked;
			deps.save();
			deps.rebuild();
		});
		ghostRow.createSpan({ text: "Show ghost edges" });
		
		const jaccardRow = bridgeSection.createDiv({ cls: "gim-setting-row" });
		jaccardRow.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px", paddingLeft: "24px" });
		jaccardRow.createSpan({ text: "Min Jaccard similarity:" });
		const jaccardIn = jaccardRow.createEl("input", { type: "number", cls: "gim-number-input", attr: { step: "0.05", min: "0", max: "1" } });
		jaccardIn.setCssStyles({ width: "60px" });
		jaccardIn.value = String(deps.settings.ghostEdgeMinJaccard);
		jaccardIn.addEventListener("change", () => {
			const v = parseFloat(jaccardIn.value);
			if (!isNaN(v) && v >= 0 && v <= 1) {
				deps.settings.ghostEdgeMinJaccard = v;
				deps.save();
				deps.rebuild();
			} else {
				jaccardIn.value = String(deps.settings.ghostEdgeMinJaccard);
			}
		});
	}
}

export interface EncodeTabDeps {
	settings: MiniSettings;
	save: () => void;
	rebuild: () => Promise<void>;
	requestDraw: () => void;
	refreshSettingsTab: () => void;
	encLegends: BindingLegend[];
	cardCache: { clear: () => void };
	laid: LaidOut;
	activeTab: string;
	setActiveTab: (tab: string) => void;
	tabFilter: string;
	setTabFilter: (filter: string) => void;
	clearCardCache: () => void;
	resolveFromCluster: (groupKey: string) => NodeDisplay;
}

export function renderSettingsEncodeTab(el: HTMLElement, deps: EncodeTabDeps): void {
	const section = el.createDiv({ cls: "gim-panel-section" });
	section.createEl("h4", { text: "Visual Encoding" });
	section.createEl("div", {
		text: "タグ・年齢・フロントマターなどの属性を色・形などの視覚表現に割り当てます。フィルターとは独立しており、表示されるノートの数は変わりません。",
	}).setCssStyles({ fontSize: "10px", color: "var(--text-faint)", marginBottom: "6px" });

	const renderBindingControls = (
		parent: HTMLElement,
		channelId: string,
		label: string,
	) => {
		const cur = (deps.settings.encoding ?? []).find((b) => b.channelId === channelId);
		const curIsFm = !!cur && cur.fieldId.startsWith("frontmatter:");

		const row = parent.createDiv({ cls: "gim-setting-row" });
		row.setCssStyles({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginTop: "8px", paddingBottom: "8px", borderBottom: "1px solid var(--background-modifier-border)" });
		
		row.createSpan({ text: label }).setCssStyles({ minWidth: "70px", fontWeight: "600", fontSize: "12px" });
		const attrLabel = row.createDiv();
		attrLabel.setCssStyles({ width: "100%", fontSize: "10px", color: "var(--text-faint)", marginBottom: "2px" });
		attrLabel.setText("割り当てる属性:");

		const selRow = row.createDiv();
		selRow.setCssStyles({ width: "100%", display: "flex", alignItems: "center", paddingLeft: "8px" });
		const sel = selRow.createEl("select");
		sel.add(new Option("(none)", ""));
		for (const f of fieldSourceRegistry) sel.add(new Option(f.label, f.id));
		sel.add(new Option("フロントマターキー指定…", "frontmatter:"));
		sel.value = curIsFm ? "frontmatter:" : (cur?.fieldId ?? "");

		const fmContainer = row.createDiv();
		fmContainer.setCssStyles({ width: "100%", display: "flex", alignItems: "center", gap: "4px", paddingLeft: "8px" });
		fmContainer.createSpan({ text: "フロントマターキー:" });
		const fmIn = fmContainer.createEl("input", { type: "text", cls: "gim-text-input" });
		fmIn.setCssStyles({ width: "120px" });
		fmIn.value = curIsFm ? cur?.fieldId.slice("frontmatter:".length) ?? "" : "";
		fmContainer.setCssStyles({ display: sel.value === "frontmatter:" ? "" : "none" });

		const scaleRow = row.createDiv();
		scaleRow.setCssStyles({ width: "100%", display: "flex", alignItems: "center", gap: "4px", paddingLeft: "8px" });
		scaleRow.createSpan({ text: "Scale:" });
		const scSel = scaleRow.createEl("select");
		scSel.add(new Option("categorical（カテゴリ別・色分け）", "categorical"));
		scSel.add(new Option("linear（数値・線形）", "linear"));
		scSel.add(new Option("log（数値・対数）", "log"));
		scSel.add(new Option("quantile（数値・分位）", "quantile"));
		scSel.value = cur?.scale?.type ?? "categorical";
		
		const revRow = row.createDiv();
		revRow.setCssStyles({ width: "100%", paddingLeft: "8px" });
		const revLabel = revRow.createEl("label", { cls: "gim-toggle-row" });
		revLabel.setCssStyles({ margin: "0" });
		const revCb = revLabel.createEl("input", { type: "checkbox" });
		revCb.checked = !!cur?.scale?.reverse;
		revLabel.createSpan({ text: "順序を逆にする" });

		const apply = (): void => {
			const fmKey = fmIn.value.trim();
			const fieldId = sel.value === "frontmatter:"
				? (fmKey ? `frontmatter:${fmKey}` : "")
				: sel.value;
			const others = (deps.settings.encoding ?? []).filter((b) => b.channelId !== channelId);
			if (!fieldId) {
				deps.settings.encoding = others;
			} else {
				const binding: EncodingBinding = {
					channelId,
					fieldId,
					enabled: true,
					scale: { type: scSel.value as ScaleType, reverse: revCb.checked },
				};
				deps.settings.encoding = [...others, binding];
			}
			deps.save();
			void deps.rebuild().then(() => deps.refreshSettingsTab());
		};
		sel.addEventListener("change", () => {
			fmContainer.setCssStyles({ display: sel.value === "frontmatter:" ? "" : "none" });
			apply();
		});
		fmIn.addEventListener("change", apply);
		scSel.addEventListener("change", apply);
		revCb.addEventListener("change", apply);

		// Auto-legend from the last evaluated encoding.
		const legItem = deps.encLegends.find((l) => l.channelId === channelId);
		if (legItem) {
			const leg = row.createDiv();
			leg.setCssStyles({ width: "100%", marginTop: "4px" });
			leg.createEl("div", { text: `Legend — ${legItem.fieldLabel}` }).setCssStyles({ fontSize: "11px", fontWeight: "600", marginBottom: "2px" });
			if (legItem.legend.kind === "categorical") {
				for (const e of legItem.legend.entries ?? []) {
					const er = leg.createSpan();
					er.setCssStyles({ display: "inline-flex", alignItems: "center", gap: "4px", marginRight: "8px" });
					if (channelId === "color") {
						er.createSpan().setCssStyles({ width: "10px", height: "10px", borderRadius: "2px", background: e.output, display: "inline-block" });
					} else if (channelId === "shape") {
						er.createSpan({ text: shapeForKey(e.key) }).setCssStyles({ fontSize: "9px", color: "var(--text-faint)", border: "1px solid var(--background-modifier-border)", borderRadius: "2px", padding: "0 3px" });
					}
					er.createSpan({ text: e.key }).setCssStyles({ fontSize: "10px" });
				}
			} else if (legItem.legend.kind === "quantitative") {
				leg.createDiv({
					text: `${(legItem.legend.min ?? 0).toFixed(1)} … ${(legItem.legend.max ?? 0).toFixed(1)}${legItem.legend.reversed ? " (reversed)" : ""}`,
				}).setCssStyles({ fontSize: "10px", color: "var(--text-muted)" });
			}
		}
	};

	renderBindingControls(section, "color", "Color（色）");
	renderBindingControls(section, "shape", "Shape（形）");

	// On-canvas legend toggle (paints the colour/shape/size key on the canvas).
	const legendRow = section.createEl("label", { cls: "gim-toggle-row" });
	legendRow.setCssStyles({ marginTop: "8px" });
	const legendCb = legendRow.createEl("input", { type: "checkbox" });
	legendCb.checked = deps.settings.showLegend;
	legendCb.addEventListener("change", () => {
		deps.settings.showLegend = legendCb.checked;
		if (legendCb.checked) {
			deps.settings.legendHiddenModes = {};
		}
		deps.save();
		deps.requestDraw();
	});
	legendRow.createSpan({ text: "Show legend on canvas" });

	// ---- Experimental / Legacy Section ----
	const expDetails = el.createEl("details", { cls: "gim-panel-section gim-experimental-section" });
	expDetails.setCssStyles({ marginTop: "16px", paddingTop: "8px", borderTop: "1px solid var(--background-modifier-border)" });
	const expSummary = expDetails.createEl("summary");
	expSummary.createSpan({ text: "Experimental (beta)" }).setCssStyles({ fontWeight: "600", cursor: "pointer" });
	expSummary.setCssStyles({ outline: "none", marginBottom: "8px" });

	const expContent = expDetails.createDiv();

	expContent.createEl("div", {
		text: "特定のビューモードでのみ機能する実験的チャンネルです。Position X/Y は Icon Gallery・BubbleSets などのカードレイアウトモードで軸位置に作用します。",
	}).setCssStyles({ fontSize: "10px", color: "var(--text-faint)", marginBottom: "12px" });

	renderBindingControls(expContent, "axisX", "Position X（横軸）");
	renderBindingControls(expContent, "axisY", "Position Y（縦軸）");

	// Legacy Bindings
	const legacySection = expContent.createDiv({ cls: "gim-panel-subsection" });
	legacySection.setCssStyles({ marginTop: "12px", paddingTop: "8px", borderTop: "1px dashed var(--background-modifier-border)" });
	legacySection.createEl("h5", { text: "その他の表示設定" }).setCssStyles({ margin: "0 0 6px 0", fontSize: "12px" });

	// Stale days (used by Opacity encoding and Insight alerts)
		const staleRow = legacySection.createDiv({ cls: "gim-setting-row" });
		staleRow.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px", paddingLeft: "24px" });
		staleRow.createSpan({ text: "鮮度の基準日数:" });
		const staleInput = staleRow.createEl("input", { type: "number", cls: "gim-number-input" });
		staleInput.setCssStyles({ width: "60px" });
		staleInput.value = deps.settings.staleDays.toString();
		staleInput.addEventListener("change", () => {
			const v = parseInt(staleInput.value, 10);
			if (!isNaN(v) && v > 0) {
				deps.settings.staleDays = v;
				deps.save();
				deps.requestDraw();
			} else {
				staleInput.value = deps.settings.staleDays.toString();
			}
		});
	legacySection.createEl("div", {
		text: "この日数を超えたノートを「古い」と判定します（Opacity チャンネルや Insight アラートで使用）",
	}).setCssStyles({ fontSize: "10px", color: "var(--text-faint)", paddingLeft: "24px" });

	// Note maturity badge
	if (displayToggleApplies(deps.settings.viewMode, "showMaturity")) {
		const maturityRow = legacySection.createEl("label", { cls: "gim-toggle-row" });
		maturityRow.setCssStyles({ marginTop: "12px" });
		const maturityCb = maturityRow.createEl("input", { type: "checkbox" });
		maturityCb.checked = deps.settings.showMaturity;
		maturityCb.addEventListener("change", () => {
			deps.settings.showMaturity = maturityCb.checked;
			deps.save();
			deps.requestDraw();
		});
		maturityRow.createSpan({ text: "成熟度バッジを表示（fleeting / literature / permanent）" });
	}



	// ---- Layers & Overrides Section ----
	const layerContainer = el.createDiv({ cls: "gim-panel-section" });
	layerContainer.setCssStyles({ marginTop: "16px", paddingTop: "8px", borderTop: "1px solid var(--background-modifier-border)" });
	layerContainer.createEl("h4", { text: "Layers & Overrides" });
	layerContainer.createEl("div", {
		text: "Structural manipulations and manual display overrides for specific layers (clusters) generated by GROUP BY.",
	}).setCssStyles({ fontSize: "10px", color: "var(--text-faint)", marginBottom: "8px" });
	
	renderLayersSubSection(layerContainer, deps);
}

function renderLayersSubSection(el: HTMLElement, deps: EncodeTabDeps): void {
	const clusters = deps.laid.clusters;
	// The synthetic ∪/∩ set-layers are addressable layers in EVERY view mode and
	// perspective — distinct from the single-tag clusters, with their own
	// NODE_DISPLAY overrides + inheritance (the single-tag clusters are their
	// supersets, so single-set settings still cascade into ∪/∩). Because ∪/∩ are
	// always present, even when the layout has no real clusters (non-enclosure
	// modes: matrix / droste / heatmap, or an empty enclosure graph) the ∪/∩ tabs
	// remain editable — so there is no empty-hint fallback.
	const tabKeys = [
		...clusters.map((c) => c.groupKey),
		...SET_LAYER_KEYS,
	];
	// Keep the selected layer valid; default to the first cluster, or the first
	// set-layer when there are no real clusters.
	const validKeys = new Set(tabKeys);
	if (!validKeys.has(deps.activeTab)) {
		const fallback = clusters.length > 0 ? clusters[0].groupKey : tabKeys[0];
		deps.setActiveTab(fallback);
	}

	const tabBar = el.createDiv({ cls: "gim-panel-tabs" });
	if (clusters.length > 1) {
		const filterInput = tabBar.createEl("input", { cls: "gim-panel-tab-filter", type: "search" });
		filterInput.setAttribute("placeholder", "Filter layers… (type to search)");
		filterInput.value = deps.tabFilter;
		filterInput.addEventListener("input", () => { 
			deps.setTabFilter(filterInput.value); 
			applyTabFilter(el, deps.tabFilter); 
		});
		filterInput.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && deps.tabFilter !== "") {
				e.preventDefault();
				deps.setTabFilter("");
				filterInput.value = "";
				applyTabFilter(el, deps.tabFilter);
			}
		});
	}
	const chipsEl = tabBar.createDiv({ cls: "gim-panel-tabs-chips" });
	for (const c of clusters) {
		renderTabButton(chipsEl, c.groupKey, `${c.label} (${c.memberCount})`, clusterHue(c.groupKey), c.label, deps);
	}
	for (const sk of SET_LAYER_KEYS) {
		renderTabButton(chipsEl, sk, SET_LAYER_LABEL[sk], null, SET_LAYER_LABEL[sk], deps);
	}
	applyTabFilter(el, deps.tabFilter);

	const content = el.createDiv({ cls: "gim-panel-content" });
	if (deps.activeTab === UNION_LAYER_KEY || deps.activeTab === INTERSECTION_LAYER_KEY) {
		renderSetLayerTab(content, deps.activeTab, deps);
	} else {
		renderLayerTab(content, deps.activeTab, deps);
	}
}

// CLOSEUP set-layer (∪/∩) tab: an addressable layer with its own
// nodeDisplayOverrides, an explicit "Inherit from" select, and a full/disable
// toggle backed by `layerInheritFull`. When full inheritance is ON the layer's
// own overrides are ignored (resolve purely via inheritFrom → superset →
// global); OFF lets its own overrides apply where set.
function renderSetLayerTab(el: HTMLElement, setKey: string, deps: EncodeTabDeps): void {
	const head = el.createDiv({ cls: "gim-panel-section" });
	head.createEl("h4", { text: SET_LAYER_LABEL[setKey] });
	head.createEl("div", {
		text:
			setKey === UNION_LAYER_KEY
				? "All notes inside any enclosure (∪). Single-tag layers are supersets, so their settings cascade here."
				: "Notes shared by 2+ enclosures (∩). Single-tag layers are supersets, so their settings cascade here.",
	}).setCssStyles({ fontSize: "10px", color: "var(--text-faint)", marginBottom: "8px" });

	const togs = el.createDiv({ cls: "gim-panel-section" });
	togs.createEl("h4", { text: "Inheritance" });

	// Full inheritance toggle (backed by layerInheritFull).
	const fullRow = togs.createEl("label", { cls: "gim-toggle-row" });
	const fullCb = fullRow.createEl("input", { type: "checkbox" });
	fullCb.checked = deps.settings.layerInheritFull.includes(setKey);
	fullCb.addEventListener("change", () => {
		toggleArrayMember(deps.settings, "layerInheritFull", setKey, fullCb.checked);
		deps.save();
		deps.refreshSettingsTab();
		void deps.rebuild();
	});
	fullRow.createSpan({ text: "Full inheritance (ignore own overrides)" });

	// Inherit-from picker — choose a real cluster as the parent source.
	const inhRow = togs.createDiv({ cls: "gim-order-row" });
	inhRow.createSpan({ text: "Inherit from", cls: "gim-order-field" });
	const inhSel = inhRow.createEl("select", { cls: "gim-order-dir" });
	const noneOpt = inhSel.createEl("option", { value: "", text: "(none)" });
	const current = deps.settings.inheritFrom[setKey] ?? "";
	if (current === "") noneOpt.selected = true;
	for (const other of deps.laid.clusters) {
		const opt = inhSel.createEl("option", { value: other.groupKey, text: other.label });
		if (other.groupKey === current) opt.selected = true;
	}
	inhSel.addEventListener("change", () => {
		if (inhSel.value === "") delete deps.settings.inheritFrom[setKey];
		else deps.settings.inheritFrom[setKey] = inhSel.value;
		deps.save();
		void deps.rebuild();
	});

	// Per-layer NODE_DISPLAY override (disabled visually under full inheritance,
	// where own overrides are ignored anyway).
	renderNodeDisplaySection(el, deps, { groupKey: setKey });
}

function applyTabFilter(hostEl: HTMLElement, filterQuery: string): void {
	const q = filterQuery.trim().toLowerCase();
	const chips = hostEl.querySelectorAll<HTMLElement>(".gim-panel-tab");
	chips.forEach((btn) => {
		if (btn.dataset.alwaysVisible === "1" || btn.classList.contains("active")) {
			btn.setCssStyles({ display: "" });
			return;
		}
		const text = btn.dataset.filterText ?? "";
		btn.setCssStyles({ display: q === "" || text.includes(q) ? "" : "none" });
	});
}

function renderTabButton(
	bar: HTMLElement,
	key: string,
	label: string,
	hue: number | null,
	filterText: string | null,
	deps: EncodeTabDeps
): void {
	const btn = bar.createEl("button", { cls: "gim-panel-tab" });
	if (deps.activeTab === key) btn.addClass("active");
	if (hue !== null) {
		const sw = btn.createSpan({ cls: "gim-panel-tab-swatch" });
		sw.setCssStyles({ background: theme().swatch(hue, "fill") });
	}
	btn.createSpan({ text: label });
	// filterText = null ⇒ pinned (never filtered, e.g. the 全体 tab).
	if (filterText === null) {
		btn.dataset.alwaysVisible = "1";
	} else {
		btn.dataset.filterText = filterText.toLowerCase();
	}
	btn.addEventListener("click", () => {
		deps.setActiveTab(key);
		deps.refreshSettingsTab();
	});
}

function renderLayerTab(el: HTMLElement, groupKey: string, deps: EncodeTabDeps): void {
	const cluster = deps.laid.clusters.find((c) => c.groupKey === groupKey);
	if (!cluster) {
		const hint = el.createDiv({ cls: "gim-panel-hint" });
		hint.setText("This layer no longer exists.");
		return;
	}

	// Header — name, colour, count.
	const head = el.createDiv({ cls: "gim-panel-section" });
	head.createEl("h4", { text: cluster.label });
	const meta = head.createDiv({ cls: "gim-layer-meta" });
	const swatch = meta.createSpan({ cls: "gim-layer-swatch" });
	const hue = clusterHue(cluster.groupKey);
	swatch.setCssStyles({ background: theme().swatch(hue, "fill") });
	meta.createSpan({ text: cluster.label });
	meta.createSpan({
		cls: "gim-layer-count",
		text: `${cluster.memberCount} nodes`,
	});

	// Layer-level toggles: aggregate display + inheritance.
	const togs = el.createDiv({ cls: "gim-panel-section" });
	togs.createEl("h4", { text: "Display" });
	renderLayerToggle(
		togs,
		"aggregatedLayers",
		groupKey,
		"Aggregate (3-card stack)",
		() => {
			// Aggregation shrinks the cluster bbox down to the stack and
			// reroutes edges/trunks into the stack centre, so a rebuild
			// pass is needed to keep enclosures and wiring in sync.
			void deps.rebuild();
		},
		deps
	);
	// Inheritance source picker — choose another cluster as the parent.
	// The child cluster's bbox will grow to engulf the parent's bbox so
	// the two visually merge into one nested region.
	const inhRow = togs.createDiv({ cls: "gim-order-row" });
	inhRow.createSpan({ text: "Inherit from", cls: "gim-order-field" });
	const inhSel = inhRow.createEl("select", { cls: "gim-order-dir" });
	const noneOpt = inhSel.createEl("option", { value: "", text: "(none)" });
	const current = deps.settings.inheritFrom[groupKey] ?? "";
	if (current === "") noneOpt.selected = true;
	for (const other of deps.laid.clusters) {
		if (other.groupKey === groupKey) continue;
		const opt = inhSel.createEl("option", {
			value: other.groupKey,
			text: other.label,
		});
		if (other.groupKey === current) opt.selected = true;
	}
	inhSel.addEventListener("change", () => {
		if (inhSel.value === "") {
			delete deps.settings.inheritFrom[groupKey];
		} else {
			deps.settings.inheritFrom[groupKey] = inhSel.value;
		}
		deps.save();
		void deps.rebuild();
	});

	// Per-cluster NODE_DISPLAY override. Falls back to inheritFrom →
	// strict superset → global when fields are left empty.
	renderNodeDisplaySection(el, deps, { groupKey });

	// Per-card visibility list. The user toggles each card individually;
	// bulk Show/Hide buttons at the top operate on the whole layer.
	const cardsSec = el.createDiv({ cls: "gim-panel-section" });
	cardsSec.createEl("h4", { text: "Cards" });

	const layerNodes = deps.laid.nodes
		.filter((n) => n.memberships.includes(groupKey))
		.sort((a, b) => a.label.localeCompare(b.label));

	const controls = cardsSec.createDiv({ cls: "gim-layer-cards-controls" });
	const showAllBtn = controls.createEl("button", { text: "Show all" });
	showAllBtn.addEventListener("click", () => {
		for (const n of layerNodes) {
			const i = deps.settings.hiddenNodes.indexOf(n.id);
			if (i >= 0) deps.settings.hiddenNodes.splice(i, 1);
		}
		deps.save();
		deps.refreshSettingsTab();
		deps.requestDraw();
	});
	const hideAllBtn = controls.createEl("button", { text: "Hide all" });
	hideAllBtn.addEventListener("click", () => {
		for (const n of layerNodes) {
			if (!deps.settings.hiddenNodes.includes(n.id)) {
				deps.settings.hiddenNodes.push(n.id);
			}
		}
		deps.save();
		deps.refreshSettingsTab();
		deps.requestDraw();
	});

	const list = cardsSec.createDiv({ cls: "gim-layer-cards" });
	for (const n of layerNodes) {
		const row = list.createEl("label", { cls: "gim-toggle-row" });
		const cb = row.createEl("input", { type: "checkbox" });
		cb.checked = !deps.settings.hiddenNodes.includes(n.id);
		cb.addEventListener("change", () => {
			toggleArrayMember(deps.settings, "hiddenNodes", n.id, !cb.checked);
			deps.save();
			deps.requestDraw();
		});
		row.createSpan({ text: n.label });
	}
}

// Helper: a labelled checkbox bound to an array-typed MiniSettings field.
function renderLayerToggle(
	parent: HTMLElement,
	field: "aggregatedLayers",
	groupKey: string,
	label: string,
	onChange: () => void,
	deps: EncodeTabDeps
): void {
	const row = parent.createEl("label", { cls: "gim-toggle-row" });
	const cb = row.createEl("input", { type: "checkbox" });
	cb.checked = deps.settings[field].includes(groupKey);
	cb.addEventListener("change", () => {
		toggleArrayMember(deps.settings, field, groupKey, cb.checked);
		deps.save();
		onChange();
	});
	row.createSpan({ text: label });
}
