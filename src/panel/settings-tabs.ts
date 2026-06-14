import type { MiniSettings } from "../types";
import {
	renderViewModeSection,
	renderBipartiteSection,
	renderLatticeSection,
} from "./settings-sections";
import {
	renderOrderBySection,
	renderExprSection,
	renderPresetSection,
} from "../panel-sections";
import { setIcon, Notice } from "obsidian";
import { applyLens, captureLens, upsertPreset, removePreset } from "../lens-presets";
import { displayToggleApplies } from "../display-applicability";
import type { LensPreset } from "../types";
import { fieldSourceRegistry } from "../encoding/field-sources";
import type { EncodingBinding, ScaleType } from "../encoding/types";
import type { BindingLegend } from "../encoding/evaluate";
import { clusterHue } from "../canvas-utils";
import { theme } from "../theme";
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
} from "../panel-sections";
import type { LaidOut } from "../layout";

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
	if (deps.settings.viewMode === "lattice") renderLatticeSection(el, deps);
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
			deps.settings.lensPresets = upsertPreset(deps.settings.lensPresets, name, captureLens(deps.settings));
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
	resolveFromCluster: (groupKey: string) => any;
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
	activeStatusColors: Record<string, string>;
	cardCache: { clear: () => void };
}

export function renderSettingsEncodeTab(el: HTMLElement, deps: EncodeTabDeps): void {
	const section = el.createDiv({ cls: "gim-panel-section" });
	section.createEl("h4", { text: "Encode — Visual Channels" });
	section.createEl("div", {
		text: "Map note attributes to visual channels. Does not filter — only changes appearance or layout.",
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
		
		row.createSpan({ text: `${label} ←` }).setCssStyles({ minWidth: "60px", fontWeight: "600" });
		const sel = row.createEl("select");
		sel.add(new Option("(none)", ""));
		for (const f of fieldSourceRegistry) sel.add(new Option(f.label, f.id));
		sel.value = cur && !curIsFm ? cur.fieldId : "";

		row.createSpan({ text: "or FM:" });
		const fmIn = row.createEl("input", { type: "text", cls: "gim-text-input" });
		fmIn.setCssStyles({ width: "100px" });
		fmIn.value = curIsFm ? cur!.fieldId.slice("frontmatter:".length) : "";

		row.createSpan({ text: "Scale:" });
		const scSel = row.createEl("select");
		for (const t of ["categorical", "linear", "log", "quantile"]) scSel.add(new Option(t, t));
		scSel.value = cur?.scale?.type ?? "categorical";
		
		const revLabel = row.createEl("label", { cls: "gim-toggle-row" });
		revLabel.setCssStyles({ margin: "0" });
		const revCb = revLabel.createEl("input", { type: "checkbox" });
		revCb.checked = !!cur?.scale?.reverse;
		revLabel.createSpan({ text: "reverse" });

		const apply = (): void => {
			const fmKey = fmIn.value.trim();
			const fieldId = fmKey ? `frontmatter:${fmKey}` : sel.value;
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
		sel.addEventListener("change", apply);
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

	renderBindingControls(section, "color", "Color");
	renderBindingControls(section, "axisX", "Position X");
	renderBindingControls(section, "axisY", "Position Y");
	// ---- Legacy Bindings Section ----
	const legacySection = el.createDiv({ cls: "gim-panel-section" });
	legacySection.setCssStyles({ marginTop: "16px", paddingTop: "8px", borderTop: "1px solid var(--background-modifier-border)" });
	legacySection.createEl("h4", { text: "Legacy Bindings" });
	legacySection.createEl("div", {
		text: "These are legacy bindings mapping data to visuals. They will be fully integrated into the generic engine in the future.",
	}).setCssStyles({ fontSize: "10px", color: "var(--text-faint)", marginBottom: "8px" });

	// Freshness overlay
	if (displayToggleApplies(deps.settings.viewMode, "freshnessOverlay")) {
		const freshnessRow = legacySection.createEl("label", { cls: "gim-toggle-row" });
		const freshnessCb = freshnessRow.createEl("input", { type: "checkbox" });
		freshnessCb.checked = deps.settings.freshnessOverlay;
		freshnessCb.addEventListener("change", () => {
			deps.settings.freshnessOverlay = freshnessCb.checked;
			deps.save();
			deps.requestDraw();
		});
		freshnessRow.createSpan({ text: "Freshness overlay (Opacity ← ageDays)" });
		
		const staleRow = legacySection.createDiv({ cls: "gim-setting-row" });
		staleRow.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px", paddingLeft: "24px" });
		staleRow.createSpan({ text: "Stale after N days:" });
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
	}

	// Status overlay
	if (displayToggleApplies(deps.settings.viewMode, "statusField")) {
		const statusFieldRow = legacySection.createDiv({ cls: "gim-setting-row" });
		statusFieldRow.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" });
		statusFieldRow.createSpan({ text: "Status overlay (Color ← frontmatter):" });
		const statusFieldInput = statusFieldRow.createEl("input", { type: "text", cls: "gim-text-input" });
		statusFieldInput.setCssStyles({ width: "80px" });
		statusFieldInput.value = deps.settings.statusField;
		statusFieldInput.addEventListener("change", () => {
			deps.settings.statusField = statusFieldInput.value.trim();
			deps.save();
			void deps.rebuild();
		});

		if (deps.settings.statusField && Object.keys(deps.activeStatusColors).length > 0) {
			const colorsContainer = legacySection.createDiv();
			colorsContainer.setCssStyles({ marginTop: "4px", paddingLeft: "8px", display: "flex", flexDirection: "column", gap: "4px" });
			
			for (const key of Object.keys(deps.activeStatusColors).sort()) {
				const colorRow = colorsContainer.createDiv({ cls: "gim-setting-row" });
				colorRow.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center" });
				colorRow.createSpan({ text: key });
				
				const colorInput = colorRow.createEl("input", { type: "color" });
				colorInput.value = deps.settings.statusColors[key] || deps.activeStatusColors[key] || "#ffffff";
				colorInput.addEventListener("change", () => {
					deps.settings.statusColors[key] = colorInput.value;
					deps.save();
					deps.requestDraw();
				});
			}
		}
	}

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
		maturityRow.createSpan({ text: "Note maturity badge (Shape ← maturity)" });
	}

	// Scale card size by degree
	const sizeRow = legacySection.createDiv({ cls: "gim-order-row" });
	sizeRow.setCssStyles({ marginTop: "12px" });
	sizeRow.createSpan({ text: "Scale card size by", cls: "gim-order-field" });
	const sizeSel = sizeRow.createEl("select", { cls: "gim-order-dir" });
	for (const opt of [
		{ v: "fixed", t: "Fixed (None)" },
		{ v: "indegree", t: "Incoming links" },
		{ v: "outdegree", t: "Outgoing links" },
	]) {
		sizeSel.createEl("option", { value: opt.v, text: opt.t });
	}
	sizeSel.value = deps.settings.nodeSizeMode;
	sizeSel.addEventListener("change", () => {
		deps.settings.nodeSizeMode = sizeSel.value as "fixed" | "indegree" | "outdegree";
		deps.cardCache.clear();
		deps.save();
		void deps.rebuild();
	});
}

export interface LayersTabDeps {
	settings: MiniSettings;
	save: () => void;
	rebuild: () => Promise<void>;
	requestDraw: () => void;
	refreshSettingsTab: () => void;
	laid: LaidOut;
	activeTab: string;
	setActiveTab: (tab: string) => void;
	tabFilter: string;
	setTabFilter: (filter: string) => void;
	clearCardCache: () => void;
	resolveFromCluster: (groupKey: string) => any;
}

export function renderSettingsLayersTab(el: HTMLElement, deps: LayersTabDeps): void {
	const clusters = deps.laid.clusters;
	if (clusters.length === 0) {
		const hint = el.createDiv({ cls: "gim-panel-hint" });
		hint.setText("No layers in the current graph (set GROUP_BY to create clusters).");
		return;
	}
	// Keep the selected layer valid; default to the first cluster.
	const validKeys = new Set(clusters.map((c) => c.groupKey));
	if (!validKeys.has(deps.activeTab)) deps.setActiveTab(clusters[0].groupKey);

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
	applyTabFilter(el, deps.tabFilter);

	const content = el.createDiv({ cls: "gim-panel-content" });
	renderLayerTab(content, deps.activeTab, deps);
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
	deps: LayersTabDeps
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

function renderLayerTab(el: HTMLElement, groupKey: string, deps: LayersTabDeps): void {
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
	deps: LayersTabDeps
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
