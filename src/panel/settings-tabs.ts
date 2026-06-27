import type { MiniSettings } from "../types";
import { renderViewModeSection } from "./settings-sections";
import { setIcon, AbstractInputSuggest, type App, type TFile } from "obsidian";
import { scanBaseFiles } from "../bases/parser";
import { addBaseFileToSelected, removeBaseFileFromSelected } from "../bases/selection";
import { displayToggleApplies } from "../visual/display-applicability";
import type { LensPreset } from "../types";
import type { BindingLegend } from "../encoding/evaluate";
import { clusterHue } from "../draw/canvas-utils";
import { theme } from "../draw/theme";
import {
	renderHeatmapMinTagControl,
	renderNodeDisplaySection,
	renderMinFontSection,
	renderHeatmapDisplayToggles,
} from "./settings-sections";
import { renderToggleSection, toggleArrayMember } from "./panel-sections";
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
}

// Sort tab removed as LIMIT and ORDER_BY are deprecated

interface FilterTabDeps {
	settings: MiniSettings;
	save: () => void;
	rebuild: () => void;
	refreshFilterTab: () => void;
	refreshSettingsTab: () => void;
	syncLensCommands?: (presets: LensPreset[]) => void;
	// Obsidian app — only needed to scan `.base` files for the Bases sub-section.
	// Optional so non-Bases call sites / tests don't have to provide it.
	app?: App;
}

function renderSettingsFilterTab(el: HTMLElement, deps: FilterTabDeps): void {
	const isHeatmap = deps.settings.viewMode === "heatmap";

	renderBasesSection(el, deps);

	// Heatmap "min tag size" is a tag filter.
	if (isHeatmap) renderHeatmapMinTagControl(el, deps);
}

// Typeahead suggester for `.base` files. Filters scanBaseFiles(app) by the
// current input substring (matched on basename OR path, case-insensitive) and,
// on selection, hands the chosen file back to the caller via onPick. Already-
// selected files are excluded so they can't be added twice. The input is an
// `<input>` text box; AbstractInputSuggest renders the popover under it.
class BaseFileSuggest extends AbstractInputSuggest<TFile> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private getFiles: () => TFile[],
		private isSelected: (path: string) => boolean,
		private onPick: (file: TFile) => void,
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): TFile[] {
		const q = query.trim().toLowerCase();
		return this.getFiles()
			.filter((f) => !this.isSelected(f.path))
			.filter(
				(f) =>
					q === "" ||
					f.basename.toLowerCase().includes(q) ||
					f.path.toLowerCase().includes(q),
			);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.createDiv({ text: file.basename });
		const sub = el.createDiv({ text: file.path });
		sub.setCssStyles({ fontSize: "10px", color: "var(--text-muted)" });
	}

	selectSuggestion(file: TFile): void {
		this.onPick(file);
	}
}

// Bases integration (Stage 2). Selecting one or more `.base` files SCOPES the
// graph to those bases' elements/edges (replaces WHERE/GROUP_BY); deselecting
// all restores the classic pipeline. This UI is intentionally minimal and
// COMPLETELY separate from the SQL-like pipeline: a typeahead input to add
// bases + a list of the selected ones (each removable). Edge-kind and cluster
// granularity live in Settings > Display, NOT here. Each change saves + rebuilds.
function renderBasesSection(el: HTMLElement, deps: FilterTabDeps): void {
	const section = el.createDiv({ cls: "gim-panel-section" });
	section.createEl("h4", { text: "Bases" });

	const hint = section.createDiv({
		text: "Add .base files to scope the graph to their notes (replaces WHERE / GROUP_BY).",
	});
	hint.setCssStyles({ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" });

	const baseFiles = deps.app ? scanBaseFiles(deps.app) : [];
	if (baseFiles.length === 0) {
		const none = section.createDiv({ text: "No .base files found" });
		none.setCssStyles({ fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic" });
		return;
	}

	// Typeahead input — type to search `.base` files; pick one to add it.
	const input = section.createEl("input", { type: "text", cls: "gim-base-suggest-input" });
	input.setAttribute("placeholder", "Search .base files…");
	input.setCssStyles({ width: "100%", marginBottom: "6px" });
	const app = deps.app;
	if (app) {
		new BaseFileSuggest(
			app,
			input,
			() => scanBaseFiles(app),
			(path) => deps.settings.selectedBases.includes(path),
			(file) => {
				deps.settings.selectedBases = addBaseFileToSelected(
					deps.settings.selectedBases,
					file.path,
				);
				input.value = "";
				deps.save();
				deps.refreshFilterTab();
				deps.rebuild();
			},
		);
	}

	// Bases mode but nothing selected ⇒ no SCOPE is applied (the graph falls back
	// to the classic WHERE/GROUP_BY result). Nudge the user to pick a base.
	if (deps.settings.selectedBases.length === 0) {
		const empty = section.createDiv({ text: "Select at least one .base to scope the graph." });
		empty.setCssStyles({ fontSize: "11px", color: "var(--text-warning, var(--text-muted))", marginBottom: "6px" });
		return;
	}

	// Selected list — one removable row per selected base. Stale entries whose
	// `.base` no longer exists still show (so the user can clear them).
	const byPath = new Map(baseFiles.map((f) => [f.path, f]));
	const list = section.createDiv({ cls: "gim-base-selected-list" });
	for (const path of deps.settings.selectedBases) {
		const row = list.createDiv({ cls: "gim-base-selected-row" });
		row.setCssStyles({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", padding: "2px 0" });
		const file = byPath.get(path);
		const label = row.createSpan({ text: file ? file.basename : path });
		label.setCssStyles({ flex: "1 1 auto", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px" });
		if (file) label.setAttribute("title", file.path);
		const remove = row.createEl("a", { cls: "view-action clickable-icon", title: "Remove" });
		remove.setAttribute("aria-label", "Remove this base");
		setIcon(remove, "x");
		remove.addEventListener("click", () => {
			deps.settings.selectedBases = removeBaseFileFromSelected(
				deps.settings.selectedBases,
				path,
			);
			deps.save();
			deps.refreshFilterTab();
			deps.rebuild();
		});
	}
}



export interface FilterBodyDeps extends FilterTabDeps {
	syncLensCommands?: (presets: LensPreset[]) => void;
}

export function renderFilterBodyTab(host: HTMLElement, deps: FilterBodyDeps): void {
	host.empty();

	// Keep only one panel: Filter & Group
	const filterHeader = host.createDiv({ cls: "gim-panel-section" });
	filterHeader.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", borderBottom: "none" });
	
	const title = filterHeader.createEl("h4", { text: "Filter & Group", cls: "gim-panel-title" });
	title.setCssStyles({ margin: "0" });



	const filterSection = host.createDiv({ cls: "gim-panel-section" });
	renderSettingsFilterTab(filterSection, deps);
}

export interface DisplayTabDeps {
	settings: MiniSettings;
	save: () => void;
	rebuild: () => void;
	requestDraw: () => void;
	refreshSettingsTab: () => void;
	clearCardCache: () => void;
	resolveFromCluster: (groupKey: string) => NodeDisplay;
}

export function renderSettingsDisplayTab(el: HTMLElement, deps: DisplayTabDeps): void {
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
	
	if (gdToggles.length > 0 || isHeatmap) {
		const gdSection = renderToggleSection(
			el,
			{ settings: deps.settings, save: deps.save, redraw: deps.requestDraw },
			"Graph display",
			gdToggles
		);
		if (isHeatmap) renderHeatmapDisplayToggles(gdSection, deps);
	}

	// Bases edge kinds + cluster granularity. Moved here from Data > Logic so the
	// Bases logic UI stays completely separate from these display-shaping options.
	// They affect how the base projection is wired/clustered, so save + rebuild.
	renderBasesDisplaySection(el, deps);

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
			if (!Number.isNaN(v) && v >= 0 && v <= 1) {
				deps.settings.ghostEdgeMinJaccard = v;
				deps.save();
				deps.rebuild();
			} else {
				jaccardIn.value = String(deps.settings.ghostEdgeMinJaccard);
			}
		});
	}
}

// Bases display options, shown in Settings > Display. The Edge-kind checklist
// (internal links / shared tags / shared property) sits under a "Show Edges"
// heading; "Cluster by view" follows. These shape the Bases projection but are
// display concerns, kept OUT of the Data > Logic Bases UI so that the Bases logic
// surface is purely "pick .base files". Values bind to the same settings keys.
function renderBasesDisplaySection(el: HTMLElement, deps: DisplayTabDeps): void {
	const section = el.createDiv({ cls: "gim-panel-section" });
	section.createEl("h4", { text: "Show Edges" });

	const hint = section.createDiv({ text: "Which relations become edges in Bases mode." });
	hint.setCssStyles({ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" });

	const edgeKinds: Array<{ key: "basesLinkEdges" | "basesSharedTagEdges" | "basesSharedPropEdges"; label: string }> = [
		{ key: "basesLinkEdges", label: "Internal links" },
		{ key: "basesSharedTagEdges", label: "Shared tags" },
		{ key: "basesSharedPropEdges", label: "Shared property" },
	];
	for (const { key, label } of edgeKinds) {
		const row = section.createEl("label", { cls: "gim-toggle-row" });
		const cb = row.createEl("input", { type: "checkbox" });
		cb.checked = deps.settings[key];
		cb.addEventListener("change", () => {
			deps.settings[key] = cb.checked;
			deps.save();
			deps.rebuild();
		});
		row.createSpan({ text: label });
	}

	const clusterRow = section.createEl("label", { cls: "gim-toggle-row" });
	clusterRow.setCssStyles({ marginTop: "6px" });
	const clusterCb = clusterRow.createEl("input", { type: "checkbox" });
	clusterCb.checked = !!deps.settings.basesClusterByView;
	clusterCb.addEventListener("change", () => {
		deps.settings.basesClusterByView = clusterCb.checked;
		deps.save();
		deps.rebuild();
	});
	clusterRow.createSpan({ text: "Always cluster by view (even single-view bases)" });

	const prefixRow = section.createEl("label", { cls: "gim-toggle-row" });
	prefixRow.setCssStyles({ marginTop: "6px" });
	const prefixCb = prefixRow.createEl("input", { type: "checkbox" });
	prefixCb.checked = !!deps.settings.basesShowPrefix;
	prefixCb.addEventListener("change", () => {
		deps.settings.basesShowPrefix = prefixCb.checked;
		deps.save();
		deps.rebuild();
	});
	prefixRow.createSpan({ text: "Show base file name prefix in labels" });
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
	expandedLayers: Set<string>;
	toggleLayerExpanded: (key: string) => void;
}

export function renderSettingsEncodeTab(el: HTMLElement, deps: EncodeTabDeps): void {
	const section = el.createDiv({ cls: "gim-panel-section" });
	section.createEl("h4", { text: "Visual Encoding" });

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

	renderLayersSubSection(el, deps);
}

function renderLayersSubSection(el: HTMLElement, deps: EncodeTabDeps): void {
	const clusters = deps.laid.clusters;
	const nodes = deps.laid.nodes;

	// Calculate pairwise individual sets (Unions and Intersections)
	const pairInter = new Map<string, number>();
	const tagCounts = new Map<string, number>();
	const clusterLabels = new Map(clusters.map(c => [c.groupKey, c.label]));

	for (const n of nodes) {
		const tags = n.memberships || [];
		for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
		if (tags.length < 2) continue;
		const sorted = [...tags].sort();
		for (let i = 0; i < sorted.length; i++) {
			for (let j = i + 1; j < sorted.length; j++) {
				const key = `${sorted[i]}\t${sorted[j]}`;
				pairInter.set(key, (pairInter.get(key) ?? 0) + 1);
			}
		}
	}

	const individualSets: Array<{ key: string; label: string; count: number }> = [];
	for (const [key, interN] of pairInter.entries()) {
		const [t1, t2] = key.split("\t");
		const l1 = (clusterLabels.get(t1) ?? t1).replace(/^#/, "");
		const l2 = (clusterLabels.get(t2) ?? t2).replace(/^#/, "");
		const c1 = tagCounts.get(t1) ?? 0;
		const c2 = tagCounts.get(t2) ?? 0;

		individualSets.push({
			key: `__union__${t1}_${t2}`,
			label: `${l1} ∪ ${l2}`,
			count: c1 + c2 - interN
		});
		individualSets.push({
			key: `__inter__${t1}_${t2}`,
			label: `${l1} ∩ ${l2}`,
			count: interN
		});
	}
	individualSets.sort((a, b) => b.count - a.count);

	const tagToPairs = new Map<string, typeof individualSets>();
	for (const s of individualSets) {
		const [t1, t2] = s.key.split("__").pop()!.split("_");
		if (!tagToPairs.has(t1)) tagToPairs.set(t1, []);
		tagToPairs.get(t1)!.push(s);
		if (!tagToPairs.has(t2)) tagToPairs.set(t2, []);
		tagToPairs.get(t2)!.push(s);
	}

	const tabKeys = [
		...clusters.map((c) => c.groupKey),
		...SET_LAYER_KEYS,
		...individualSets.map(s => s.key)
	];
	// Keep the selected layer valid; default to the first cluster, or the first
	// set-layer when there are no real clusters.
	const validKeys = new Set(tabKeys);
	const activeExists = validKeys.has(deps.activeTab);
	if (!activeExists) {
		const fallback = clusters.length > 0 ? clusters[0].groupKey : tabKeys[0];
		deps.setActiveTab(fallback);
	}

	const tabBar = el.createDiv({ cls: "gim-panel-tabs" });
	if (clusters.length > 1 || individualSets.length > 1) {
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

	const treeEl = tabBar.createDiv({ cls: "gim-panel-tabs-tree" });
	treeEl.setCssStyles({ 
		display: "flex", 
		flexDirection: "column", 
		maxHeight: "350px", 
		overflowY: "auto", 
		gap: "1px", 
		border: "1px solid var(--background-modifier-border)", 
		borderRadius: "4px", 
		padding: "4px",
		background: "var(--background-primary)"
	});

	// 1. Broad layers
	const broadHead = treeEl.createDiv({ text: "Global", cls: "gim-panel-section-header" });
	broadHead.setCssStyles({ padding: "4px 8px", fontSize: "10px", textTransform: "uppercase", color: "var(--text-faint)", marginTop: "4px" });
	for (const sk of SET_LAYER_KEYS) {
		renderTreeTabButton(treeEl, sk, SET_LAYER_LABEL[sk], null, SET_LAYER_LABEL[sk], 0, deps);
	}

	// 2. Tag layers (Folders)
	const tagHead = treeEl.createDiv({ text: "Tags & Overlap", cls: "gim-panel-section-header" });
	tagHead.setCssStyles({ padding: "4px 8px", fontSize: "10px", textTransform: "uppercase", color: "var(--text-faint)", marginTop: "8px" });
	
	for (const c of clusters) {
		const pairs = tagToPairs.get(c.groupKey) || [];
		const isExpanded = deps.expandedLayers.has(c.groupKey);
		
		renderTreeTabButton(treeEl, c.groupKey, `${c.label} (${c.memberCount})`, clusterHue(c.groupKey), c.label, 0, deps, pairs.length > 0, isExpanded);

		if (pairs.length > 0 && isExpanded) {
			const kids = treeEl.createDiv();
			for (const s of pairs) {
				const [tk1, tk2] = s.key.split("__").pop()!.split("_");
				const h1 = clusterHue(tk1);
				const h2 = clusterHue(tk2);
				const isInter = s.key.startsWith("__inter__");
				renderTreeTabButton(kids, s.key, `${s.label} (${s.count})`, [h1, h2], s.label, 1, deps, false, false, isInter);
			}
		}
	}

	applyTabFilter(el, deps.tabFilter);

	const content = el.createDiv({ cls: "gim-panel-content" });
	const isIndividual = deps.activeTab.startsWith("__union__") || deps.activeTab.startsWith("__inter__");
	if (deps.activeTab === UNION_LAYER_KEY || deps.activeTab === INTERSECTION_LAYER_KEY || isIndividual) {
		// Pass the individual set label if it's an individual tab
		const label = isIndividual ? individualSets.find(s => s.key === deps.activeTab)?.label : undefined;
		renderSetLayerTab(content, deps.activeTab, deps, label);
	} else {
		renderLayerTab(content, deps.activeTab, deps);
	}
}

function renderTreeTabButton(
	bar: HTMLElement,
	key: string,
	label: string,
	hue: number | number[] | null,
	filterText: string | null,
	depth: number,
	deps: EncodeTabDeps,
	isFolder = false,
	isExpanded = false,
	isVerticalInter = false
): void {
	const btn = bar.createDiv({ cls: "gim-panel-tab tree-row" });
	if (deps.activeTab === key) btn.addClass("active");
	
	btn.setCssStyles({ 
		display: "flex", 
		alignItems: "center", 
		width: "100%",
		padding: "3px 6px",
		paddingLeft: `${6 + depth * 10}px`,
		cursor: "pointer",
		borderRadius: "4px",
		border: "none",
		background: "transparent",
		justifyContent: "flex-start",
		textAlign: "left",
		gap: "4px"
	});

	if (isFolder) {
		const chevron = btn.createSpan({ text: isExpanded ? "▾" : "▸", cls: "gim-tree-chevron" });
		chevron.setCssStyles({ width: "12px", flexShrink: "0", fontSize: "10px", textAlign: "center" });
		chevron.addEventListener("click", (e) => {
			e.stopPropagation();
			deps.toggleLayerExpanded(key);
			deps.refreshSettingsTab();
		});
	} else {
		// Non-folders (leaves) get a spacer to align with the labels of folders
		btn.createSpan().setCssStyles({ width: "12px", flexShrink: "0" });
	}
	
	if (hue !== null) {
		const sw = btn.createSpan({ cls: "gim-panel-tab-swatch" });
		sw.setCssStyles({ flexShrink: "0" });
		const t = theme();
		if (Array.isArray(hue)) {
			const c1 = t.swatch(hue[0], "fill");
			const c2 = t.swatch(hue[1], "fillStrong");
			const angle = isVerticalInter ? "90deg" : "0deg";
			sw.setCssStyles({ background: `linear-gradient(${angle}, ${c1} 50%, ${c2} 50%)` });
		} else {
			sw.setCssStyles({ background: t.swatch(hue, "fill") });
		}
	}
	
	const lblEl = btn.createSpan({ text: label });
	lblEl.setCssStyles({ flex: "1 1 auto", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px" });

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

// CLOSEUP set-layer (∪/∩) tab: an addressable layer with its own
// nodeDisplayOverrides, an explicit "Inherit from" select, and a full/disable
// toggle backed by `layerInheritFull`. When full inheritance is ON the layer's
// own overrides are ignored (resolve purely via inheritFrom → superset →
// global); OFF lets its own overrides apply where set.
function renderSetLayerTab(el: HTMLElement, setKey: string, deps: EncodeTabDeps, overrideLabel?: string): void {
	const head = el.createDiv({ cls: "gim-panel-section" });
	head.createEl("h4", { text: overrideLabel || SET_LAYER_LABEL[setKey] });

	let desc = "";
	if (setKey === UNION_LAYER_KEY) desc = "All notes inside any enclosure (∪). Single-tag layers are supersets, so their settings cascade here.";
	else if (setKey === INTERSECTION_LAYER_KEY) desc = "Notes shared by 2+ enclosures (∩). Single-tag layers are supersets, so their settings cascade here.";
	else if (setKey.startsWith("__union__")) desc = "Pairwise union (∪) of two tags. Single-tag layers are supersets.";
	else if (setKey.startsWith("__inter__")) desc = "Pairwise intersection (∩) of two tags. Single-tag layers are supersets.";

	head.createEl("div", {
		text: desc,
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

	// Per-layer aggregation toggle
	let aggId = setKey;
	if (setKey === UNION_LAYER_KEY) aggId = "__UNIONS__";
	else if (setKey === INTERSECTION_LAYER_KEY) aggId = "__INTERSECTIONS__";

	renderLayerToggle(
		togs,
		"aggregatedLayers",
		aggId,
		"Aggregate (Junihitoe stack)",
		() => {
			void deps.rebuild();
		},
		deps
	);

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
