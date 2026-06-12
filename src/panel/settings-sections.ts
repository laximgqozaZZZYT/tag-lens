import type { MiniSettings } from "../types";
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
