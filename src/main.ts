import { Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, MiniSettings } from "./types";
import { MiniGraphView, VIEW_TYPE_MINI } from "./view";

export default class GraphIslandMiniPlugin extends Plugin {
	settings: MiniSettings = DEFAULT_SETTINGS;
	private views: MiniGraphView[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_MINI, (leaf) => {
			const v = new MiniGraphView(leaf, this.settings, () => this.saveSettings());
			this.views.push(v);
			return v;
		});

		this.addRibbonIcon("git-fork", "Tag Lens", () => this.activateView());
		this.addCommand({
			id: "open-tag-lens",
			name: "Open Tag Lens",
			callback: () => this.activateView(),
		});

		this.addSettingTab(new MiniSettingTab(this));
	}

	async onunload(): Promise<void> {
		this.views = [];
	}

	firstView(): MiniGraphView | null {
		return this.views[0] ?? null;
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_MINI)[0];
		if (existing) {
			workspace.revealLeaf(existing);
			return;
		}
		const leaf: WorkspaceLeaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_MINI, active: true });
		workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		const raw = await this.loadData();
		const merged = { ...DEFAULT_SETTINGS, ...(raw ?? {}) } as Record<string, unknown>;
		// Strip legacy / removed fields so they don't leak back into data.json.
		delete merged.collapsedGroups;
		delete merged.nodeRadius;
		delete merged.manifestPath;
		delete merged.rules;
		// Migrate groupBy: GroupBySpec object → string[] or string → string[].
		if (Array.isArray(merged.groupBy)) {
			// already in new shape
		} else if (typeof merged.groupBy === "string") {
			merged.groupBy = merged.groupBy.trim() ? [merged.groupBy.trim()] : [];
		} else {
			const gb = merged.groupBy as { kind?: string; field?: string } | undefined;
			if (gb?.kind === "tag") merged.groupBy = ["tag:*"];
			else if (gb?.kind === "frontmatter" && gb.field) merged.groupBy = [`${gb.field}:*`];
			else merged.groupBy = [];
		}
		if (Array.isArray(merged.where)) {
			// already in new shape
		} else if (typeof merged.where === "string") {
			merged.where = merged.where.trim() ? [merged.where.trim()] : [];
		} else {
			merged.where = [];
		}
		if (!Array.isArray(merged.having)) merged.having = [];
		if (!Array.isArray(merged.limit)) merged.limit = [];
		if (typeof merged.orderField !== "string" || merged.orderField === "") {
			merged.orderField = "name";
		}
		if (merged.orderDir !== "asc" && merged.orderDir !== "desc") {
			merged.orderDir = "asc";
		}
		if (typeof merged.panelVisible !== "boolean") merged.panelVisible = false;
		if (typeof merged.showBody !== "boolean") merged.showBody = true;
		// Retired pixel-sized fields (now superseded by nodeRows / nodeCols).
		delete merged.nodeWidth;
		delete merged.nodeHeight;
		if (
			typeof merged.nodeRows !== "number" ||
			!Number.isFinite(merged.nodeRows) ||
			merged.nodeRows < 1
		) {
			merged.nodeRows = 1;
		} else {
			merged.nodeRows = Math.max(1, Math.floor(merged.nodeRows));
		}
		if (
			typeof merged.nodeCols !== "number" ||
			!Number.isFinite(merged.nodeCols) ||
			merged.nodeCols < 1
		) {
			merged.nodeCols = 1;
		} else {
			merged.nodeCols = Math.max(1, Math.floor(merged.nodeCols));
		}
		if (
			merged.nodeSizeMode !== "fixed" &&
			merged.nodeSizeMode !== "indegree" &&
			merged.nodeSizeMode !== "outdegree"
		) {
			merged.nodeSizeMode = "fixed";
		}
		if (merged.matrixSort !== "original" && merged.matrixSort !== "cooccurrence")
			merged.matrixSort = "cooccurrence";
		if (typeof merged.matrixMinColumnSize !== "number")
			merged.matrixMinColumnSize = 1;
		if (typeof merged.matrixGroupBySignature !== "boolean")
			merged.matrixGroupBySignature = true;
		if (typeof merged.matrixCollapseGroups !== "boolean")
			merged.matrixCollapseGroups = false;
		if (typeof merged.matrixBlockPriority !== "boolean")
			merged.matrixBlockPriority = true;
		// Matrix order is now a standard ORDER_BY: criterion (co-occurrence /
		// block-priority ⇒ matrixBlockPriority) + direction (matrixSortDir).
		// matrixSort folds to "cooccurrence" (the brief "original" is dropped);
		// matrixSortDir defaults to "desc" so an existing block-priority view
		// keeps "biggest blocks first". Group / Collapse stay as independent
		// display toggles (any combo valid now).
		if (merged.matrixSort !== "cooccurrence") merged.matrixSort = "cooccurrence";
		if (merged.matrixSortDir !== "asc" && merged.matrixSortDir !== "desc")
			merged.matrixSortDir = "desc";
		if (
			typeof merged.heatmapMinTagSize !== "number" ||
			!Number.isFinite(merged.heatmapMinTagSize) ||
			(merged.heatmapMinTagSize as number) < 1
		) {
			merged.heatmapMinTagSize = 2;
		} else {
			merged.heatmapMinTagSize = Math.max(1, Math.floor(merged.heatmapMinTagSize as number));
		}
		if (merged.heatmapCriterion !== "co-occurrence" && merged.heatmapCriterion !== "size")
			merged.heatmapCriterion = "co-occurrence";
		if (merged.heatmapSortDir !== "asc" && merged.heatmapSortDir !== "desc")
			merged.heatmapSortDir = "desc";
		if (typeof merged.heatmapJaccard !== "boolean") merged.heatmapJaccard = true;
		if (
			typeof merged.bipartiteMaxTags !== "number" ||
			!Number.isFinite(merged.bipartiteMaxTags) ||
			merged.bipartiteMaxTags < 1
		) {
			merged.bipartiteMaxTags = 80;
		} else {
			merged.bipartiteMaxTags = Math.max(1, Math.floor(merged.bipartiteMaxTags));
		}
		if (
			merged.bipartiteLayout !== "force" &&
			merged.bipartiteLayout !== "concentric" &&
			merged.bipartiteLayout !== "clustered"
		)
			merged.bipartiteLayout = "force";
		// The region/containment views (Nested set / Containment / Euler diagram)
		// are Experimental (beta) and break on this data shape, so a beta mode
		// must never be the effective DEFAULT. The legacy default was "euler"
		// (Nested set) — fall it back to the stable matrix so old configs that
		// never picked a mode land on a working view. A user who deliberately
		// selects a beta mode from the Experimental section still keeps it.
		if (merged.viewMode === "euler") merged.viewMode = "matrix";
		if (typeof merged.showNodes !== "boolean") merged.showNodes = true;
		if (typeof merged.showEnclosures !== "boolean") merged.showEnclosures = true;
		if (typeof merged.showEdges !== "boolean") merged.showEdges = true;
		if (typeof merged.showGrid !== "boolean") merged.showGrid = true;
		if (!Array.isArray(merged.hiddenNodes)) merged.hiddenNodes = [];
		if (!Array.isArray(merged.aggregatedLayers)) merged.aggregatedLayers = [];
		delete merged.inheritedLayers; // retired
		if (
			merged.inheritFrom === null ||
			typeof merged.inheritFrom !== "object" ||
			Array.isArray(merged.inheritFrom)
		) {
			merged.inheritFrom = {};
		}
		if (
			merged.nodeDisplayOverrides === null ||
			typeof merged.nodeDisplayOverrides !== "object" ||
			Array.isArray(merged.nodeDisplayOverrides)
		) {
			merged.nodeDisplayOverrides = {};
		}
		// Strip retired LOD fields so they don't leak back into data.json.
		delete merged.lodMode;
		delete merged.lodCoreMembershipMin;
		delete merged.lodHubTopK;
		delete merged.lodAggregateBadge;
		delete merged.lodAuto;
		if (typeof merged.whereAuto !== "boolean") merged.whereAuto = true;
		if (typeof merged.groupByAuto !== "boolean") merged.groupByAuto = true;
		if (typeof merged.havingAuto !== "boolean") merged.havingAuto = true;
		if (typeof merged.limitAuto !== "boolean") merged.limitAuto = true;
		if (
			merged.anchorPlacement !== "concentric" &&
			merged.anchorPlacement !== "flow"
		) {
			merged.anchorPlacement = "concentric";
		}
		this.settings = merged as unknown as MiniSettings;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const v of this.views) v.updateSettings(this.settings);
	}
}

class MiniSettingTab extends PluginSettingTab {
	constructor(private plugin: GraphIslandMiniPlugin) {
		super(plugin.app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;

		new Setting(containerEl)
			.setName("Cluster spacing")
			.addSlider((sl) => {
				sl.setLimits(20, 200, 5).setValue(s.clusterSpacing).setDynamicTooltip();
				sl.onChange(async (v) => {
					s.clusterSpacing = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Node spacing")
			.addSlider((sl) => {
				sl.setLimits(8, 60, 1).setValue(s.nodeSpacing).setDynamicTooltip();
				sl.onChange(async (v) => {
					s.nodeSpacing = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("WHERE / GROUP_BY")
			.setDesc(
				"Filter and partition expressions are edited inside the view. " +
					"Open the Tag Lens view and click the sliders icon in its toolbar.",
			)
			.addButton((b) => {
				b.setButtonText("Open Tag Lens")
					.setCta()
					.onClick(async () => {
						await this.plugin.activateView();
					});
			});
	}
}
