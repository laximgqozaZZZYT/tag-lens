import type { MiniSettings } from "../types";
import { VIEW_MODES, isCloseup } from "../types";
import type { NodeDisplay } from "../visual/node-display";
import { clampMinFont, minFontInput } from "./min-font-input";
import { partitionViewModePicker } from "./view-mode-picker";

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
		attr: minFontInput().attr,
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
		const v = clampMinFont(input.value);
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

function renderViewModeOption(
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

	const { closeup, panoramaStable, experimental, expSelected } =
		partitionViewModePicker(VIEW_MODES, deps.settings.viewMode);

	// Close-up: per-node detail views (currently Icon Gallery only).
	if (closeup.length > 0) {
		const closeupHeader = section.createDiv({ cls: "gim-viewmode-perspective-header" });
		closeupHeader.setCssStyles({ margin: "4px 0 2px", fontSize: "11px", color: "var(--text-muted)", fontWeight: "600" });
		closeupHeader.createSpan({ text: "Close-up" });
		const closeupGroup = section.createDiv({ cls: "gim-viewmode-options" });
		for (const opt of closeup) renderViewModeOption(closeupGroup, opt, deps, "closeup");
	}

	// Panorama: vault-wide structural overview modes (non-experimental).
	if (panoramaStable.length > 0) {
		const panoramaHeader = section.createDiv({ cls: "gim-viewmode-perspective-header" });
		panoramaHeader.setCssStyles({ margin: "8px 0 2px", fontSize: "11px", color: "var(--text-muted)", fontWeight: "600" });
		panoramaHeader.createSpan({ text: "Panorama" });
		const panoramaGroup = section.createDiv({ cls: "gim-viewmode-options" });
		for (const opt of panoramaStable) renderViewModeOption(panoramaGroup, opt, deps, "panorama");
	}

	// Experimental (beta): collapsible, regardless of perspective.
	if (experimental.length === 0) return;

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

export interface GenericSectionDeps {
	settings: MiniSettings;
	save: () => void;
	rebuild: () => void;
	requestDraw?: () => void;
	refreshSettingsTab?: () => void;
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
