import { ItemView, WorkspaceLeaf, TFile, debounce } from "obsidian";
import { buildGraph } from "./parser";
import {
	layout,
	type LaidOut,
	type PositionedNode,
	type SizedNode,
	type ClusterRect,
} from "./layout";
import type { MiniSettings, GraphNode, ViewMode } from "./types";
import {
	NONE_BUCKET,
	VIEW_MODES,
	SET_PREFIX,
	MATRIX_ORDER_CRITERIA,
	HEATMAP_ORDER_CRITERIA,
} from "./types";
import { CARD_MIN_W, CARD_MAX_W, CARD_CELL_W, CARD_CELL_H } from "./types";
import { type LimitRule, applyLimitRules } from "./limit";
import { filterMemberships, filterLabels } from "./query-filters";
import {
	parseLimitRules as parseLimitRulesFn,
	getSortKey as getSortKeyFn,
	computeDroppedClusters as computeDroppedClustersFn,
} from "./query-pipeline";
import { colLetters, clusterHue } from "./canvas-utils";
import { expandClustersByInheritance } from "./cluster-bbox";
import { runAggregateSnap } from "./aggregate-snap";
import {
	drawCardGrid as drawCardGridFn,
	drawGridHeaders as drawGridHeadersFn,
	drawClusterLabels as drawClusterLabelsFn,
	drawAggregateStack as drawAggregateStackFn,
	drawOverviewLabels as drawOverviewLabelsFn,
} from "./draw-helpers";
import {
	computeMemberSets,
	computeStrictSupersets,
} from "./cluster-relations";
import {
	resolveNodeDisplay as resolveNodeDisplayFn,
	resolveFromCluster as resolveFromClusterFn,
	visualScale,
	type NodeDisplay,
	type NodeDisplayDeps,
} from "./node-display";
import { drawEnclosures } from "./draw-enclosures";
import { drawBaseEdges, drawAccentEdges } from "./draw-edges";
import {
	drawUpsetFooter,
	upsetFooterHeight,
	LEFT_BAND_PX as UPSET_LEFT_BAND_PX,
} from "./draw-upset";
import { drawMatrix, matrixGeom, MATRIX_BADGE_W } from "./draw-matrix";
import type { MatrixLine } from "./draw-matrix";
import { drawHeatmap, heatmapGeom } from "./draw-heatmap";
import { drawDroste } from "./draw-droste";
import { drosteInverseBranch } from "./conformal";
import {
	drawLattice,
	latticeCellAt,
	latticeHeaderCheckboxHit,
	latticeNamedRowAt,
	TIER_GUTTER as LATTICE_TIER_GUTTER,
} from "./draw-lattice";
import { latticeNodeAt } from "./lattice-layout";
import { drawCard as drawCardFn } from "./draw-card";
import {
	hitTest as hitTestFn,
	screenToWorld as screenToWorldFn,
	type HoverTarget,
} from "./hit-test";
import {
	resolveEffectiveQuery,
	resolveEffectiveHaving,
	computeDegreeMaps,
	filterEdgesByAlive,
	filterLayoutData,
	buildAdjacency,
} from "./rebuild-pipeline";
import {
	type CardContent,
	computeCardSize,
	computeChannelDims,
	computeSizeScale as computeSizeScaleFn,
	measureCard as measureCardFn,
	minFontScale,
} from "./card-sizing";
import {
	renderExprSection as renderExprSectionFn,
	renderToggleSection as renderToggleSectionFn,
	renderOrderBySection as renderOrderBySectionFn,
	toggleArrayMember as toggleArrayMemberFn,
} from "./panel-sections";
import {
	HOVER_DELAY_MS,
	sameTarget,
	computeHighlight,
	positionTip as positionTipFn,
} from "./highlight";
import { MarqueeController } from "./marquee-controller";

export const VIEW_TYPE_MINI = "tag-lens-view";


// Internal cache: maps file path → pre-processed body preview (post-frontmatter,
// trimmed). Persists across rebuilds so we don't re-read 2k+ files every time
// metadataCache fires "resolved".

export class MiniGraphView extends ItemView {
	private canvas!: HTMLCanvasElement;
	private ctx!: CanvasRenderingContext2D;
	private root!: HTMLElement;
	private laid: LaidOut = {
		nodes: [],
		edges: [],
		clusters: [],
		trunks: [],
		slotW: 0,
		slotH: 0,
		channelW: 0,
		channelH: 0,
	};
	private panX = 0;
	private panY = 0;
	private zoom = 1;
	private dragging = false;
	private lastX = 0;
	private lastY = 0;
	// Pointer-down position + "moved beyond a click" flag, so a drag (pan /
	// scroll) doesn't fire a click that opens a file.
	private downX = 0;
	private downY = 0;
	private pointerMoved = false;
	private rafId = 0;
	// High-frequency vault/metadata events (metadataCache "resolved" bursts at
	// startup, plus Sync-driven create/modify/delete/rename floods) must not
	// each trigger a full rebuild() — its synchronous prefix (buildGraph scans
	// every markdown file twice, then layout()) would pile up back-to-back and
	// starve the main thread on large vaults. Coalesce a burst into ONE rebuild
	// 250 ms after the first event (resetTimer=false). Cache invalidation in the
	// handlers stays immediate; only the rebuild call is debounced.
	private scheduleRebuild = debounce(() => {
		void this.rebuild();
	}, 250, false);
	private resizeObs?: ResizeObserver;
	private hoverTimer = 0;
	private hoverTarget: HoverTarget = null;
	private tipEl: HTMLDivElement | null = null;
	private hoverGen = 0;
	// Marquee state machine lives in its own controller — the view
	// just queries it (isArmed / isActive) and pumps pointer events.
	private marquee!: MarqueeController;
	private highlightedNodes: Set<string> = new Set();
	private highlightedEdgeIdx: Set<number> = new Set();
	// Clusters to render with accent stroke on hover. Populated from the
	// hovered node's memberships PLUS every connected node's memberships,
	// so aggregate stacks for connected-but-collapsed cards light up too.
	private highlightedClusters: Set<string> = new Set();
	// The primary hovered node id (NOT the set of connected ones). Used to
	// pick outgoing vs incoming edge colours: edge.source === hoveredNodeId
	// is an OUTGOING link (out from this node), edge.target === hoveredNodeId
	// is an INCOMING backlink (into this node).
	private hoveredNodeId: string | null = null;
	private adjacency: Map<string, number[]> = new Map();
	// Drag-to-move (nodes/clusters) was removed; pan/marquee/click-to-open
	// are the only pointer interactions now.
	private bodyCache: Map<string, string> = new Map();
	private cardCache: Map<string, CardContent> = new Map();
	private rebuildGen = 0;
	private clusterLabels: Map<string, string> = new Map();
	// Shared text-width measurer for `layoutLattice` — runs in the same 2D
	// context that the renderer will eventually paint with, so the layout's
	// "longest line" sizing matches what `drawHeader` renders pixel-for-pixel.
	// Arrow form to keep `this` bound when passed through layout options.
	private measureLatticeText = (text: string, fontPx: number): number => {
		this.ctx.save();
		this.ctx.font = `600 ${fontPx}px sans-serif`;
		const w = this.ctx.measureText(text).width;
		this.ctx.restore();
		return w;
	};

	// Resolve {nodeKey → basename[]} for every currently-named lattice node,
	// driven by the LAST laid layout. The layout step needs these strings
	// to measure widths and grow each named node so labels don't truncate.
	// Vault lookup lives here (view only); the layout module stays DOM-free.
	private buildLatticeNamedLabels(): Record<string, string[]> {
		const out: Record<string, string[]> = {};
		const meta = this.laid?.lattice;
		if (!meta || this.latticeNamedKeys.size === 0) return out;
		const max = Math.max(1, this.settings.latticeNamedMax);
		for (const node of meta.nodes) {
			if (!this.latticeNamedKeys.has(node.key)) continue;
			const ids = node.nodeIds.slice(0, max);
			out[node.key] = ids.map((id) => {
				const sep = id.indexOf("\t");
				const path = sep >= 0 ? id.slice(sep + 1) : id;
				const f = this.app.vault.getAbstractFileByPath(path);
				return f instanceof TFile ? f.basename : path;
			});
		}
		return out;
	}
	private whereError = "";
	private groupByError = "";
	private havingError = "";
	private limitError = "";
	private displayMode: Map<string, "full" | "brief"> = new Map();
	private degreeMap: Map<string, number> = new Map();
	// Per-direction degree counters used by nodeSizeMode = indegree / outdegree.
	// Refreshed every rebuild from data.edges.
	private inDegreeMap: Map<string, number> = new Map();
	private outDegreeMap: Map<string, number> = new Map();
	// trulyAgg from the rebuild's aggregate processing. The draw layer reads
	// this — NOT a recomputed "every membership in aggSet" — so that a node
	// the rebuild considers "effectively aggregated" (e.g. via the parent-
	// cluster skip rule) is also the same set the draw layer hides. Without
	// this single source of truth, draw would still render a node whose
	// footprint the rebuild marked as free, and the aggregate badge would
	// happily land inside it.
	private trulyAggSet: Set<string> = new Set();
	// Cluster-relations cache populated post-layout: each cluster's member
	// id set, plus the list of clusters that are STRICT supersets of it.
	// Used by the per-cluster NODE_DISPLAY resolver to walk the fallback
	// chain (own → inheritFrom → superset → global).
	private clusterMemberSets: Map<string, Set<string>> = new Map();
	private clusterSupersets: Map<string, string[]> = new Map();
	// Per-node resolved NODE_DISPLAY snapshot. Filled once per rebuild from
	// the override chain so cardFor / drawCard don't re-walk it per call.
	private nodeDisplayCache: Map<string, NodeDisplay> = new Map();
	private panelEl: HTMLDivElement | null = null;
	// Current tab in the settings panel. "__all__" = 全体. Otherwise = a
	// cluster groupKey produced by WHERE → GROUP_BY → HAVING.
	private activeTab: string = "__all__";
	// UpSet mode: signature key (= `signature.join("|")`) of the column
	// currently selected by the user (highlighted in the matrix; drives
	// the detail panel listing in Phase C). null = nothing selected.
	private upsetSelectedSignatureKey: string | null = null;
	// Connection-matrix mode: key of the highlighted column (tag). null = none.
	private matrixSelectedCol: string | null = null;
	// Bipartite mode: id of the SET node whose neighbours are PINNED-
	// highlighted by a click (persists across hover). null = none.
	private pinnedSet: string | null = null;
	// Lattice mode: selected / hovered node key (signature key) for highlight
	// and the floating note-list overlay. Cleared when the selected key no
	// longer exists after a relayout (clearStaleSelection).
	private latticeSelectedKey: string | null = null;
	private latticeHoverKey: string | null = null;
	// Lattice: keys of nodes whose body is expanded into a list of file
	// names (header checkbox checked). Transient — relayout prunes keys
	// whose node no longer exists.
	private latticeNamedKeys: Set<string> = new Set();
	// Heatmap mode: selected cell (tag i × tag j) → detail overlay; hovered
	// row/col for the crosshair (-1 = none). detailEl = the overlay element.
	private heatmapSelected: { i: number; j: number } | null = null;
	private heatmapHoverRow = -1;
	private heatmapHoverCol = -1;
	private detailEl: HTMLElement | null = null;
	// Block indices currently EXPANDED while collapse mode is on.
	private matrixExpanded = new Set<number>();
	// Cached display lines (rows + collapsed summaries) — virtualization unit.
	private matrixLines: MatrixLine[] = [];
	// Hover crosshair: display line + column under the cursor (-1 = none).
	private matrixHoverLine = -1;
	private matrixHoverCol = -1;
	// Last view mode we framed (fitToView) for — re-fit when the mode changes.
	private lastFramedMode: ViewMode | null = null;
	// Per-cluster "truly-aggregated" member count. Populated during
	// rebuild() for clusters in aggregatedLayers — the count excludes
	// members that also belong to a non-aggregated cluster (since those
	// stay visible as individual cards). 0 / missing ⇒ no stack drawn.
	private aggregateCount: Map<string, number> = new Map();
	// Substring filter applied to the layer tabs (case-insensitive). Empty
	// string = no filter. Filtering is done via CSS display toggles so the
	// search input never loses focus.
	private tabFilter: string = "";

	constructor(
		leaf: WorkspaceLeaf,
		private settings: MiniSettings,
		private save: () => Promise<void>,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_MINI;
	}
	getDisplayText(): string {
		return "Tag Lens";
	}
	getIcon(): string {
		return "git-fork";
	}

	async onOpen(): Promise<void> {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.style.padding = "0";
		root.style.overflow = "hidden";
		root.style.position = "relative";
		this.root = root;

		this.canvas = root.createEl("canvas");
		this.canvas.style.width = "100%";
		this.canvas.style.height = "100%";
		this.canvas.style.display = "block";
		this.canvas.style.cursor = "grab";
		this.ctx = this.canvas.getContext("2d")!;

		// Marquee controller wires canvas + root + the view's coordinate /
		// fitToRect / hover-cancel callbacks so the controller has zero
		// view-state references beyond what's passed at construction.
		this.marquee = new MarqueeController({
			canvas: this.canvas,
			root: this.root,
			screenToWorld: (sx, sy) => this.screenToWorld(sx, sy),
			fitToRect: (w) => this.fitToRect(w),
			onActivate: () => this.cancelHover(),
		});

		this.addAction("square-dashed-mouse-pointer", "Marquee zoom (or Shift+drag)", () => this.marquee.arm());
		this.addAction("zoom-in", "Zoom in", () => this.zoomBy(1.4));
		this.addAction("zoom-out", "Zoom out", () => this.zoomBy(1 / 1.4));
		this.addAction("maximize", "Fit to view", () => this.fitToView());

		this.attachInputs();
		this.resizeObs = new ResizeObserver(() => this.resize());
		this.resizeObs.observe(root);

		this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRebuild()));
		this.registerEvent(
			this.app.vault.on("create", (f) => {
				if (!(f instanceof TFile)) return;
				this.scheduleRebuild();
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (f) => {
				if (!(f instanceof TFile)) return;
				this.bodyCache.delete(f.path);
				this.cardCache.delete(f.path);
				this.scheduleRebuild();
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (f, oldPath) => {
				if (!(f instanceof TFile)) return;
				this.bodyCache.delete(oldPath);
				this.cardCache.delete(oldPath);
				this.scheduleRebuild();
			}),
		);
		this.registerEvent(
			this.app.vault.on("modify", (f) => {
				if (!(f instanceof TFile)) return;
				this.bodyCache.delete(f.path);
				this.cardCache.delete(f.path);
				this.scheduleRebuild();
			}),
		);

		this.addAction("sliders-horizontal", "Toggle graph settings", () => this.togglePanel());

		void this.rebuild();
		this.resize();
		if (this.settings.panelVisible) this.renderPanel();
	}

	private togglePanel(): void {
		this.settings.panelVisible = !this.settings.panelVisible;
		void this.save();
		if (this.settings.panelVisible) this.renderPanel();
		else this.tearDownPanel();
	}

	async onClose(): Promise<void> {
		this.resizeObs?.disconnect();
		cancelAnimationFrame(this.rafId);
		this.cancelHover();
		this.tearDownPanel();
	}

	// ---- Settings panel (in-view, Obsidian-core-graph-style) ----

	private tearDownPanel(): void {
		this.panelEl?.remove();
		this.panelEl = null;
	}

	private renderPanel(): void {
		if (!this.settings.panelVisible) {
			this.tearDownPanel();
			return;
		}
		if (!this.panelEl) {
			this.panelEl = this.root.createDiv({ cls: "gim-panel" });
		}
		const el = this.panelEl;
		el.empty();

		const header = el.createDiv({ cls: "gim-panel-header" });
		header.createEl("h3", { text: "Graph settings" });
		const closeBtn = header.createEl("button", { cls: "gim-panel-close", text: "×" });
		closeBtn.setAttr("aria-label", "Close settings");
		closeBtn.addEventListener("click", () => this.togglePanel());

		// Tab bar: 全体 + one tab per cluster produced by WHERE → GROUP_BY →
		// HAVING. If the previously active tab has been filtered out (e.g.
		// the user tightened HAVING and its cluster disappeared), fall back
		// to 全体 silently.
		const validTabs = new Set<string>(["__all__"]);
		for (const c of this.laid.clusters) validTabs.add(c.groupKey);
		if (!validTabs.has(this.activeTab)) this.activeTab = "__all__";

		const tabBar = el.createDiv({ cls: "gim-panel-tabs" });

		// Search filter for layer tabs — only needed when there is at least
		// one cluster tab to filter against. The 全体 tab is always pinned
		// and never hidden by the filter.
		if (this.laid.clusters.length > 0) {
			const filterInput = tabBar.createEl("input", {
				cls: "gim-panel-tab-filter",
				type: "search",
			}) as HTMLInputElement;
			filterInput.setAttribute("placeholder", "Filter layers… (type to search)");
			filterInput.value = this.tabFilter;
			filterInput.addEventListener("input", () => {
				this.tabFilter = filterInput.value;
				this.applyTabFilter();
			});
			// Esc clears the filter without exiting the input.
			filterInput.addEventListener("keydown", (e) => {
				if (e.key === "Escape" && this.tabFilter !== "") {
					e.preventDefault();
					this.tabFilter = "";
					filterInput.value = "";
					this.applyTabFilter();
				}
			});
		}

		const chipsEl = tabBar.createDiv({ cls: "gim-panel-tabs-chips" });
		this.renderTabButton(chipsEl, "__all__", "All", null, null);
		for (const c of this.laid.clusters) {
			const labelText = `${c.label} (${c.memberCount})`;
			this.renderTabButton(chipsEl, c.groupKey, labelText, clusterHue(c.groupKey), c.label);
		}
		this.applyTabFilter();

		const content = el.createDiv({ cls: "gim-panel-content" });
		if (this.activeTab === "__all__") {
			this.renderAllTab(content);
		} else {
			this.renderLayerTab(content, this.activeTab);
		}
	}

	private renderTabButton(
		bar: HTMLElement,
		key: string,
		label: string,
		hue: number | null,
		filterText: string | null,
	): void {
		const btn = bar.createEl("button", { cls: "gim-panel-tab" });
		if (this.activeTab === key) btn.addClass("active");
		if (hue !== null) {
			const sw = btn.createSpan({ cls: "gim-panel-tab-swatch" });
			sw.style.background = `hsl(${hue}, 70%, 62%)`;
		}
		btn.createSpan({ text: label });
		// filterText = null ⇒ pinned (never filtered, e.g. the 全体 tab).
		if (filterText === null) {
			btn.dataset.alwaysVisible = "1";
		} else {
			btn.dataset.filterText = filterText.toLowerCase();
		}
		btn.addEventListener("click", () => {
			this.activeTab = key;
			this.renderPanel();
		});
	}

	// Hide / show chip buttons via CSS display so the focused filter input
	// stays focused. Substring match (case-insensitive) against the cluster
	// label. The 全体 tab carries data-always-visible=1 and is never hidden.
	// Also reveals the currently-active tab even if it doesn't match the
	// filter, so the user can always see "where they are".
	private applyTabFilter(): void {
		if (!this.panelEl) return;
		const q = this.tabFilter.trim().toLowerCase();
		const chips = this.panelEl.querySelectorAll<HTMLElement>(".gim-panel-tab");
		chips.forEach((btn) => {
			if (btn.dataset.alwaysVisible === "1" || btn.classList.contains("active")) {
				btn.style.display = "";
				return;
			}
			const text = btn.dataset.filterText ?? "";
			btn.style.display = q === "" || text.includes(q) ? "" : "none";
		});
	}

	private renderAllTab(el: HTMLElement): void {
		const isMatrix = this.settings.viewMode === "matrix";
		const isHeatmap = this.settings.viewMode === "heatmap";
		const isLattice = this.settings.viewMode === "lattice";
		const isDroste = this.settings.viewMode === "droste";
		this.renderViewModeSection(el);
		if (this.settings.viewMode === "bipartite") this.renderBipartiteSection(el);
		if (isLattice) this.renderLatticeSection(el);
		if (isDroste) this.renderDrosteSection(el);
		this.renderExprSection(el, "WHERE", this.settings.where, this.whereError, {
			autoKey: "whereAuto",
		});
		this.renderExprSection(el, "GROUP_BY", this.settings.groupBy, this.groupByError, {
			autoKey: "groupByAuto",
		});
		const havingSection = this.renderExprSection(
			el,
			"HAVING",
			this.settings.having,
			this.havingError,
			{ placeholder: "e.g. count >= 3", autoKey: "havingAuto" },
		);
		// Matrix "min column size" / heatmap "min tag size" are tag filters (not
		// orders), so they live with the other filters (inside HAVING).
		if (isMatrix) this.renderMatrixMinColumnControl(havingSection);
		if (isHeatmap) this.renderHeatmapMinTagControl(havingSection);
		// ORDER_BY owns row ordering for every mode. In matrix mode it renders
		// the matrix sort options (co-occurrence / block-priority) + group /
		// collapse toggles; otherwise the standard field/dir controls.
		this.renderOrderBySection(el);
		this.renderExprSection(el, "LIMIT", this.settings.limit, this.limitError, {
			placeholder: "limit 10 / brief 30",
			autoKey: "limitAuto",
		});
		// Matrix dots / heatmap cells / lattice nodes are drawn at sizes
		// driven by their own intrinsic metrics (presence / co-occurrence /
		// intersection-count), independent of NODE DISPLAY. Hide that section
		// so Size by / m×n can't imply they affect those views.
		if (!isMatrix && !isHeatmap && !isLattice) this.renderNodeDisplaySection(el);
		this.renderMinFontSection(el);
		const gdSection = this.renderToggleSection(el, "Graph display", [
			{ key: "showNodes", label: "Show nodes" },
			{ key: "showEnclosures", label: "Show enclosures" },
			{ key: "showEdges", label: "Show edges" },
			{ key: "showGrid", label: "Show grid" },
		]);
		// Matrix grouping / collapsing are DISPLAY operations → live with the
		// Show toggles, matrix-only.
		if (isMatrix) this.renderMatrixDisplayToggles(gdSection);
		// Heatmap colour-scale (Jaccard vs raw count) is a display operation too.
		if (isHeatmap) this.renderHeatmapDisplayToggles(gdSection);
	}

	private renderMinFontSection(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: "gim-panel-section" });
		section.createEl("h4", { text: "Min font size (px)" });
		const wrap = section.createDiv({ cls: "gim-min-font-row" });
		const input = wrap.createEl("input", {
			type: "number",
			attr: { min: "0", max: "48", step: "1" },
		}) as HTMLInputElement;
		input.value = String(this.settings.minFontPx);
		input.style.width = "60px";
		const hint = wrap.createSpan({
			cls: "gim-min-font-hint",
			text: "Floor for every label / card font",
		});
		hint.style.marginLeft = "8px";
		hint.style.color = "var(--text-muted, #7a8aa0)";
		hint.style.fontSize = "11px";
		input.addEventListener("change", () => {
			const v = Math.max(0, Math.min(48, Math.floor(Number(input.value) || 0)));
			input.value = String(v);
			if (this.settings.minFontPx === v) return;
			this.settings.minFontPx = v;
			void this.save();
			this.requestDraw();
		});
	}

	private renderLayerTab(el: HTMLElement, groupKey: string): void {
		const cluster = this.laid.clusters.find((c) => c.groupKey === groupKey);
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
		swatch.style.background = `hsl(${hue}, 70%, 62%)`;
		meta.createSpan({ text: cluster.label });
		meta.createSpan({
			cls: "gim-layer-count",
			text: `${cluster.memberCount} nodes`,
		});

		// Layer-level toggles: aggregate display + inheritance.
		const togs = el.createDiv({ cls: "gim-panel-section" });
		togs.createEl("h4", { text: "Display" });
		this.renderLayerToggle(
			togs,
			"aggregatedLayers",
			groupKey,
			"Aggregate (3-card stack)",
			() => {
				// Aggregation shrinks the cluster bbox down to the stack and
				// reroutes edges/trunks into the stack centre, so a rebuild
				// pass is needed to keep enclosures and wiring in sync.
				void this.rebuild();
			},
		);
		// Inheritance source picker — choose another cluster as the parent.
		// The child cluster's bbox will grow to engulf the parent's bbox so
		// the two visually merge into one nested region.
		const inhRow = togs.createDiv({ cls: "gim-order-row" });
		inhRow.createSpan({ text: "Inherit from", cls: "gim-order-field" });
		const inhSel = inhRow.createEl("select", { cls: "gim-order-dir" }) as HTMLSelectElement;
		const noneOpt = inhSel.createEl("option", { value: "", text: "(none)" });
		const current = this.settings.inheritFrom[groupKey] ?? "";
		if (current === "") noneOpt.selected = true;
		for (const other of this.laid.clusters) {
			if (other.groupKey === groupKey) continue;
			const opt = inhSel.createEl("option", {
				value: other.groupKey,
				text: other.label,
			});
			if (other.groupKey === current) opt.selected = true;
		}
		inhSel.addEventListener("change", () => {
			if (inhSel.value === "") {
				delete this.settings.inheritFrom[groupKey];
			} else {
				this.settings.inheritFrom[groupKey] = inhSel.value;
			}
			void this.save();
			void this.rebuild();
		});

		// Per-cluster NODE_DISPLAY override. Falls back to inheritFrom →
		// strict superset → global when fields are left empty.
		this.renderNodeDisplaySection(el, { groupKey });

		// Per-card visibility list. The user toggles each card individually;
		// bulk Show/Hide buttons at the top operate on the whole layer.
		const cardsSec = el.createDiv({ cls: "gim-panel-section" });
		cardsSec.createEl("h4", { text: "Cards" });

		const layerNodes = this.laid.nodes
			.filter((n) => n.memberships.includes(groupKey))
			.sort((a, b) => a.label.localeCompare(b.label));

		const controls = cardsSec.createDiv({ cls: "gim-layer-cards-controls" });
		const showAllBtn = controls.createEl("button", { text: "Show all" });
		showAllBtn.addEventListener("click", () => {
			for (const n of layerNodes) {
				const i = this.settings.hiddenNodes.indexOf(n.id);
				if (i >= 0) this.settings.hiddenNodes.splice(i, 1);
			}
			void this.save();
			this.renderPanel();
			this.requestDraw();
		});
		const hideAllBtn = controls.createEl("button", { text: "Hide all" });
		hideAllBtn.addEventListener("click", () => {
			for (const n of layerNodes) {
				if (!this.settings.hiddenNodes.includes(n.id)) {
					this.settings.hiddenNodes.push(n.id);
				}
			}
			void this.save();
			this.renderPanel();
			this.requestDraw();
		});

		const list = cardsSec.createDiv({ cls: "gim-layer-cards" });
		for (const n of layerNodes) {
			const row = list.createEl("label", { cls: "gim-toggle-row" });
			const cb = row.createEl("input", { type: "checkbox" }) as HTMLInputElement;
			cb.checked = !this.settings.hiddenNodes.includes(n.id);
			cb.addEventListener("change", () => {
				this.toggleArrayMember("hiddenNodes", n.id, !cb.checked);
				void this.save();
				this.requestDraw();
			});
			row.createSpan({ text: n.label });
		}
	}

	// Helper: a labelled checkbox bound to an array-typed MiniSettings field.
	private renderLayerToggle(
		parent: HTMLElement,
		field: "aggregatedLayers",
		groupKey: string,
		label: string,
		onChange: () => void,
	): void {
		const row = parent.createEl("label", { cls: "gim-toggle-row" });
		const cb = row.createEl("input", { type: "checkbox" }) as HTMLInputElement;
		cb.checked = this.settings[field].includes(groupKey);
		cb.addEventListener("change", () => {
			this.toggleArrayMember(field, groupKey, cb.checked);
			void this.save();
			onChange();
		});
		row.createSpan({ text: label });
	}

	private toggleArrayMember(
		field: "hiddenNodes" | "aggregatedLayers",
		value: string,
		present: boolean,
	): void {
		toggleArrayMemberFn(this.settings, field, value, present);
	}

	// LAYOUT section: per-cluster anchor placement strategy (concentric ring
	// around the focus cluster vs. flow direction from focus to the right).
	// "Node display" section: body preview toggle + base card size + the
	// size-by-link mode. Changing any size knob triggers a full rebuild
	// because the cell pitch is derived from the base size and the layout
	// has to redo cell snap.
	// Render NODE_DISPLAY controls. With no scope it edits the GLOBAL
	// settings (used in the 全体 tab). With `scope = { groupKey }` it edits
	// `nodeDisplayOverrides[groupKey]` instead, and unset fields fall back
	// through `inheritFrom` source → strict supersets → global, in that
	// priority order.
	private renderNodeDisplaySection(
		parent: HTMLElement,
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
			let ov = this.settings.nodeDisplayOverrides[scope.groupKey];
			if (!ov) {
				ov = {};
				this.settings.nodeDisplayOverrides[scope.groupKey] = ov;
			}
			return ov;
		};
		// In layer scope, look up resolved value (= what the renderer uses)
		// to display as placeholder so the user can see what they'll override.
		const resolvedFor = scope
			? this.resolveFromCluster(scope.groupKey)
			: {
					nodeRows: this.settings.nodeRows,
					nodeCols: this.settings.nodeCols,
					nodeSizeMode: this.settings.nodeSizeMode,
				};

		// "Size (m × n)". For layer scope, empty value means "use inherited".
		const sizeRow = section.createDiv({ cls: "gim-order-row" });
		sizeRow.createSpan({ text: "Size (m × n)", cls: "gim-order-field" });
		const mIn = sizeRow.createEl("input", { type: "number" }) as HTMLInputElement;
		const nIn = (() => {
			sizeRow.createSpan({ text: "×" });
			return sizeRow.createEl("input", { type: "number" }) as HTMLInputElement;
		})();
		mIn.min = nIn.min = "1";
		mIn.max = nIn.max = "8";
		mIn.step = nIn.step = "1";
		mIn.style.width = nIn.style.width = "50px";
		if (scope) {
			const ov = this.settings.nodeDisplayOverrides[scope.groupKey];
			mIn.value = ov?.nodeRows !== undefined ? String(ov.nodeRows) : "";
			nIn.value = ov?.nodeCols !== undefined ? String(ov.nodeCols) : "";
			mIn.placeholder = String(resolvedFor.nodeRows);
			nIn.placeholder = String(resolvedFor.nodeCols);
		} else {
			mIn.value = String(this.settings.nodeRows);
			nIn.value = String(this.settings.nodeCols);
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
					delete this.settings.nodeDisplayOverrides[scope.groupKey];
				}
			} else {
				if (Number.isFinite(m) && m >= 1 && m <= 12) this.settings.nodeRows = m;
				if (Number.isFinite(n) && n >= 1 && n <= 12) this.settings.nodeCols = n;
			}
			this.cardCache.clear();
			void this.save();
			void this.rebuild();
		};
		mIn.addEventListener("change", applySize);
		nIn.addEventListener("change", applySize);

		const modeRow = section.createDiv({ cls: "gim-order-row" });
		modeRow.createSpan({ text: "Size by", cls: "gim-order-field" });
		const sel = modeRow.createEl("select", { cls: "gim-order-dir" }) as HTMLSelectElement;
		if (scope) {
			sel.createEl("option", {
				value: "",
				text: `Inherited (${this.formatSizeMode(resolvedFor.nodeSizeMode)})`,
			});
		}
		for (const opt of [
			{ v: "fixed", t: "Fixed" },
			{ v: "indegree", t: "Incoming links" },
			{ v: "outdegree", t: "Outgoing links" },
		]) {
			sel.createEl("option", { value: opt.v, text: opt.t });
		}
		if (scope) {
			const ov = this.settings.nodeDisplayOverrides[scope.groupKey];
			sel.value = ov?.nodeSizeMode ?? "";
		} else {
			sel.value = this.settings.nodeSizeMode;
		}
		sel.addEventListener("change", () => {
			if (scope) {
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
					delete this.settings.nodeDisplayOverrides[scope.groupKey];
				}
			} else {
				this.settings.nodeSizeMode = sel.value as MiniSettings["nodeSizeMode"];
			}
			this.cardCache.clear();
			void this.save();
			void this.rebuild();
		});
	}

	private formatSizeMode(m: "fixed" | "indegree" | "outdegree"): string {
		return m === "fixed" ? "Fixed" : m === "indegree" ? "Incoming" : "Outgoing";
	}

	// Resolve a cluster's "rendered" NODE_DISPLAY (= what the inheritance
	// chain produces when this cluster has no override) so the per-layer
	// panel can show it as placeholder text and the user can tell what
	// they're overriding.
	private resolveFromCluster(groupKey: string): NodeDisplay {
		return resolveFromClusterFn(groupKey, this.nodeDisplayDeps());
	}

	private renderOrderBySection(parent: HTMLElement): void {
		// Matrix mode replaces the field/dir ORDER_BY with its seriation options
		// (co-occurrence / block-priority / original) + group / collapse toggles,
		// so all row ordering lives in this one section.
		if (this.settings.viewMode === "matrix") {
			this.renderMatrixOrderBySection(parent);
			return;
		}
		if (this.settings.viewMode === "heatmap") {
			this.renderHeatmapOrderBySection(parent);
			return;
		}
		renderOrderBySectionFn(parent, {
			settings: this.settings,
			save: () => void this.save(),
		});
	}

	// Matrix ORDER_BY: SAME structure as every other mode — a criterion select
	// + an asc/desc direction select. The criterion options are matrix-specific
	// (co-occurrence / block-priority) and map to matrixBlockPriority; the
	// direction maps to matrixSortDir. No matrix-only checkboxes live here.
	private renderMatrixOrderBySection(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: "gim-panel-section" });
		const header = section.createDiv({ cls: "gim-panel-section-header" });
		header.createEl("h4", { text: "ORDER_BY" });

		const row = section.createDiv({ cls: "gim-order-row" });
		const fieldSel = row.createEl("select", { cls: "gim-order-field" });
		const current = this.settings.matrixBlockPriority
			? "block-priority"
			: "co-occurrence";
		for (const o of MATRIX_ORDER_CRITERIA) {
			const opt = fieldSel.createEl("option", { value: o.value, text: o.text });
			if (o.value === current) opt.selected = true;
		}
		fieldSel.addEventListener("change", () => {
			this.settings.matrixSort = "cooccurrence";
			this.settings.matrixBlockPriority = fieldSel.value === "block-priority";
			void this.save();
			void this.rebuild();
		});

		const dirSel = row.createEl("select", { cls: "gim-order-dir" });
		for (const d of ["asc", "desc"] as const) {
			const opt = dirSel.createEl("option", { value: d, text: d });
			if (this.settings.matrixSortDir === d) opt.selected = true;
		}
		dirSel.addEventListener("change", () => {
			this.settings.matrixSortDir = dirSel.value as "asc" | "desc";
			void this.save();
			void this.rebuild();
		});
	}

	// Matrix "min column size" — a column (tag) filter, rendered inside the
	// HAVING filter section (no standalone Matrix section).
	private renderMatrixMinColumnControl(section: HTMLElement): void {
		const row = section.createDiv({ cls: "gim-order-row" });
		row.createSpan({ text: "Min column size", cls: "gim-order-field" });
		const inp = row.createEl("input", { type: "number" }) as HTMLInputElement;
		inp.min = "1";
		inp.style.width = "56px";
		inp.value = String(this.settings.matrixMinColumnSize);
		inp.addEventListener("change", () => {
			const v = Math.max(1, Math.floor(Number(inp.value) || 1));
			this.settings.matrixMinColumnSize = v;
			inp.value = String(v);
			void this.save();
			void this.rebuild();
		});
	}

	// Heatmap ORDER_BY: SAME criterion + asc/desc structure as other modes.
	// Criterion = co-occurrence (Jaccard seriation) / size; direction reverses
	// the tag order. No heatmap-only controls live in ORDER_BY.
	private renderHeatmapOrderBySection(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: "gim-panel-section" });
		const header = section.createDiv({ cls: "gim-panel-section-header" });
		header.createEl("h4", { text: "ORDER_BY" });
		const row = section.createDiv({ cls: "gim-order-row" });
		const fieldSel = row.createEl("select", { cls: "gim-order-field" });
		for (const o of HEATMAP_ORDER_CRITERIA) {
			const opt = fieldSel.createEl("option", { value: o.value, text: o.text });
			if (o.value === this.settings.heatmapCriterion) opt.selected = true;
		}
		fieldSel.addEventListener("change", () => {
			this.settings.heatmapCriterion = fieldSel.value as "co-occurrence" | "size";
			void this.save();
			void this.rebuild();
		});
		const dirSel = row.createEl("select", { cls: "gim-order-dir" });
		for (const d of ["asc", "desc"] as const) {
			const opt = dirSel.createEl("option", { value: d, text: d });
			if (this.settings.heatmapSortDir === d) opt.selected = true;
		}
		dirSel.addEventListener("change", () => {
			this.settings.heatmapSortDir = dirSel.value as "asc" | "desc";
			void this.save();
			void this.rebuild();
		});
	}

	// Heatmap "min tag size" — a tag (axis) filter, rendered inside HAVING.
	private renderHeatmapMinTagControl(section: HTMLElement): void {
		const row = section.createDiv({ cls: "gim-order-row" });
		row.createSpan({ text: "Min tag size", cls: "gim-order-field" });
		const inp = row.createEl("input", { type: "number" }) as HTMLInputElement;
		inp.min = "1";
		inp.style.width = "56px";
		inp.value = String(this.settings.heatmapMinTagSize);
		inp.addEventListener("change", () => {
			const v = Math.max(1, Math.floor(Number(inp.value) || 1));
			this.settings.heatmapMinTagSize = v;
			inp.value = String(v);
			void this.save();
			void this.rebuild();
		});
	}

	// Heatmap colour-scale toggle in GRAPH DISPLAY (display-only repaint).
	private renderHeatmapDisplayToggles(section: HTMLElement): void {
		const row = section.createEl("label", { cls: "gim-toggle-row" });
		const cb = row.createEl("input", { type: "checkbox" });
		cb.checked = this.settings.heatmapJaccard;
		cb.addEventListener("change", () => {
			this.settings.heatmapJaccard = cb.checked;
			void this.save();
		});
		row.createSpan({ text: "Jaccard color scale" });
	}

	// Lattice (intersection lattice) mode settings — degree-tier layout,
	// LOD, per-tier cap, and the subset-link back layer. Mirrors the
	// renderBipartiteSection shape (own panel section).
	private renderLatticeSection(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: "gim-panel-section" });
		section.createEl("h4", { text: "Lattice" });

		// LOD mode (auto / overview / density / individual).
		const lodRow = section.createDiv({ cls: "gim-row" });
		lodRow.createSpan({ text: "Node LOD" });
		const lodSel = lodRow.createEl("select") as HTMLSelectElement;
		const lodOpts: Array<[string, string]> = [
			["auto", "Auto (zoom-based)"],
			["overview", "Overview"],
			["density", "Density"],
			["individual", "Individual"],
		];
		for (const [v, label] of lodOpts) {
			const o = lodSel.createEl("option", { text: label });
			o.value = v;
			if (this.settings.latticeNodeLOD === v) o.selected = true;
		}
		lodSel.addEventListener("change", () => {
			this.settings.latticeNodeLOD = lodSel.value as MiniSettings["latticeNodeLOD"];
			void this.save();
			void this.rebuild();
		});

		// Min size cull — drop intersections below this count entirely.
		const minRow = section.createDiv({ cls: "gim-row" });
		minRow.createSpan({ text: "Min intersection size" });
		const minIn = minRow.createEl("input", {
			type: "number",
			attr: { min: "1", step: "1" },
		}) as HTMLInputElement;
		minIn.value = String(this.settings.latticeMinNodeSize);
		minIn.style.width = "60px";
		minIn.addEventListener("change", () => {
			const v = Math.max(1, Math.floor(Number(minIn.value) || 1));
			this.settings.latticeMinNodeSize = v;
			minIn.value = String(v);
			void this.save();
			void this.rebuild();
		});

		// Per-tier cap — beyond this, the rest collapse into "Other (×M)".
		const capRow = section.createDiv({ cls: "gim-row" });
		capRow.createSpan({ text: "Max nodes per tier" });
		const capIn = capRow.createEl("input", {
			type: "number",
			attr: { min: "1", step: "1" },
		}) as HTMLInputElement;
		capIn.value = String(this.settings.latticeMaxNodesPerTier);
		capIn.style.width = "60px";
		capIn.addEventListener("change", () => {
			const v = Math.max(1, Math.floor(Number(capIn.value) || 1));
			this.settings.latticeMaxNodesPerTier = v;
			capIn.value = String(v);
			void this.save();
			void this.rebuild();
		});

		// Max names per node — drives the per-node "show names" checkbox.
		// Higher = more rows visible inside each expanded card before "+N".
		const namedRow = section.createDiv({ cls: "gim-row" });
		namedRow.createSpan({ text: "Max names per node" });
		const namedIn = namedRow.createEl("input", {
			type: "number",
			attr: { min: "1", step: "1" },
		}) as HTMLInputElement;
		namedIn.value = String(this.settings.latticeNamedMax);
		namedIn.style.width = "60px";
		namedIn.addEventListener("change", () => {
			const v = Math.max(1, Math.floor(Number(namedIn.value) || 1));
			this.settings.latticeNamedMax = v;
			namedIn.value = String(v);
			void this.save();
			void this.rebuild();
		});

		// Subset links (display-only — DISPLAY_ONLY_KEYS skips relayout).
		const linkRow = section.createEl("label", { cls: "gim-toggle-row" });
		const linkCb = linkRow.createEl("input", { type: "checkbox" });
		linkCb.checked = this.settings.latticeShowSubsetLinks;
		linkCb.addEventListener("change", () => {
			this.settings.latticeShowSubsetLinks = linkCb.checked;
			void this.save();
			this.requestDraw();
		});
		linkRow.createSpan({ text: "Show subset links" });

		// Tier orientation — most specific on top vs bottom.
		const topRow = section.createEl("label", { cls: "gim-toggle-row" });
		const topCb = topRow.createEl("input", { type: "checkbox" });
		topCb.checked = this.settings.latticeSpecificTop;
		topCb.addEventListener("change", () => {
			this.settings.latticeSpecificTop = topCb.checked;
			void this.save();
			void this.rebuild();
		});
		topRow.createSpan({ text: "Most-specific tier on top" });
	}

	// Print Gallery (Escher) mode settings — the four conformal-warp draw
	// parameters. All are pure repaint params (consumed directly by
	// drawDroste), so each persists via save() and repaints via requestDraw()
	// without a relayout. drosteFocus (the spiral root) is set by clicking a
	// node in the view, not here.
	private renderDrosteSection(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: "gim-panel-section" });
		section.createEl("h4", { text: "Print Gallery" });

		// Scale per loop (k) — how much |z| grows over one 2π turn.
		const kRow = section.createDiv({ cls: "gim-row" });
		kRow.createSpan({ text: "Scale per loop (k)" });
		const kIn = kRow.createEl("input", {
			type: "range",
			attr: { min: "1.5", max: "16", step: "0.5" },
		}) as HTMLInputElement;
		kIn.value = String(this.settings.drosteZoom);
		kIn.addEventListener("input", () => {
			this.settings.drosteZoom = Number(kIn.value);
			void this.save();
			this.requestDraw();
		});

		// Recursion copies — how many back-to-front spiral repeats are drawn.
		const copiesRow = section.createDiv({ cls: "gim-row" });
		copiesRow.createSpan({ text: "Recursion copies" });
		const copiesIn = copiesRow.createEl("input", {
			type: "range",
			attr: { min: "1", max: "8", step: "1" },
		}) as HTMLInputElement;
		copiesIn.value = String(this.settings.drosteCopies);
		copiesIn.addEventListener("input", () => {
			this.settings.drosteCopies = Math.round(Number(copiesIn.value));
			void this.save();
			this.requestDraw();
		});

		// Edge subdivision — straight strip edges become smooth spiral
		// polylines; more segments = smoother curves (costlier draw).
		const subdivRow = section.createDiv({ cls: "gim-row" });
		subdivRow.createSpan({ text: "Edge subdivision" });
		const subdivIn = subdivRow.createEl("input", {
			type: "range",
			attr: { min: "4", max: "64", step: "4" },
		}) as HTMLInputElement;
		subdivIn.value = String(this.settings.drosteSubdiv);
		subdivIn.addEventListener("input", () => {
			this.settings.drosteSubdiv = Math.round(Number(subdivIn.value));
			void this.save();
			this.requestDraw();
		});

		// Twist direction — clockwise vs counter-clockwise spiral.
		const twistRow = section.createEl("label", { cls: "gim-toggle-row" });
		const twistCb = twistRow.createEl("input", { type: "checkbox" });
		twistCb.checked = this.settings.drosteTwistDir === "cw";
		twistCb.addEventListener("change", () => {
			this.settings.drosteTwistDir = twistCb.checked ? "cw" : "ccw";
			void this.save();
			this.requestDraw();
		});
		twistRow.createSpan({ text: "Clockwise twist" });
	}

	// One radio row for a view mode. Shared by the stable list and the
	// collapsible Experimental list — the only difference is a "(beta)" tag.
	private renderViewModeOption(
		container: HTMLElement,
		opt: (typeof VIEW_MODES)[number],
	): void {
		const item = container.createEl("label", { cls: "gim-viewmode-option" });
		const input = item.createEl("input", {
			type: "radio",
			attr: { name: "gim-viewmode" },
		}) as HTMLInputElement;
		input.value = opt.id;
		input.checked = this.settings.viewMode === opt.id;
		input.addEventListener("change", () => {
			if (!input.checked) return;
			const next = input.value as ViewMode;
			if (this.settings.viewMode === next) return;
			this.settings.viewMode = next;
			void this.save();
			void this.rebuild();
			this.renderPanel();
		});
		const text = item.createDiv({ cls: "gim-viewmode-text" });
		text.createEl("strong", {
			text: opt.experimental ? `${opt.label} (beta)` : opt.label,
		});
		if (opt.description) {
			text.createEl("span", { cls: "gim-viewmode-desc", text: opt.description });
		}
	}

	private renderViewModeSection(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: "gim-panel-section" });
		section.createEl("h4", { text: "View mode" });

		// Stable modes first.
		const stableGroup = section.createDiv({ cls: "gim-viewmode-options" });
		for (const opt of VIEW_MODES.filter((o) => !o.experimental)) {
			this.renderViewModeOption(stableGroup, opt);
		}

		// Experimental (beta) modes in a collapsible sub-section — these break
		// on sparse / hierarchy-less vaults, so they're segregated below the
		// stable list. Expanded by default ONLY when one is currently selected.
		const experimental = VIEW_MODES.filter((o) => o.experimental);
		if (experimental.length === 0) return;
		const expSelected = experimental.some((o) => o.id === this.settings.viewMode);

		const header = section.createDiv({ cls: "gim-viewmode-exp-header" });
		Object.assign(header.style, {
			cursor: "pointer",
			userSelect: "none",
			margin: "8px 0 4px",
			fontSize: "12px",
			color: "#9eb0c4",
		} as Partial<CSSStyleDeclaration>);
		const caret = header.createSpan({ text: expSelected ? "▾ " : "▸ " });
		header.createSpan({ text: "Experimental (beta)" });

		const expGroup = section.createDiv({ cls: "gim-viewmode-options" });
		expGroup.style.display = expSelected ? "" : "none";
		for (const opt of experimental) this.renderViewModeOption(expGroup, opt);

		header.addEventListener("click", () => {
			const open = expGroup.style.display === "none";
			expGroup.style.display = open ? "" : "none";
			caret.setText(open ? "▾ " : "▸ ");
		});
	}

	// Bipartite-only controls: max number of tag (set) nodes shown.
	private renderBipartiteSection(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: "gim-panel-section" });
		section.createEl("h4", { text: "Tag graph" });

		// Layout method (placement only; the edge set is identical either way).
		const layRow = section.createDiv({ cls: "gim-order-row" });
		layRow.createSpan({ text: "Layout", cls: "gim-order-field" });
		const laySel = layRow.createEl("select") as HTMLSelectElement;
		for (const [val, label] of [
			["force", "Force"],
			["concentric", "Concentric"],
			["clustered", "Clustered"],
		] as const) {
			const o = laySel.createEl("option", { value: val, text: label });
			if (val === this.settings.bipartiteLayout) o.selected = true;
		}
		laySel.addEventListener("change", () => {
			this.settings.bipartiteLayout = laySel.value as
				| "force"
				| "concentric"
				| "clustered";
			void this.save();
			void this.rebuild();
		});

		const row = section.createDiv({ cls: "gim-order-row" });
		row.createSpan({ text: "Max tags", cls: "gim-order-field" });
		const inp = row.createEl("input", { type: "number" }) as HTMLInputElement;
		inp.min = "1";
		inp.style.width = "56px";
		inp.value = String(this.settings.bipartiteMaxTags);
		inp.addEventListener("change", () => {
			const v = Math.max(1, Math.floor(Number(inp.value) || 1));
			this.settings.bipartiteMaxTags = v;
			inp.value = String(v);
			void this.save();
			void this.rebuild();
		});
		section.createEl("p", {
			cls: "gim-panel-hint",
			text: "Singleton + giant (>40% of notes) tags are dropped first; then the top-N by size are kept. Click a tag node to highlight its notes; click a note to open it.",
		});
	}

	private renderToggleSection(
		parent: HTMLElement,
		heading: string,
		toggles: {
			key: "showNodes" | "showBody" | "showEnclosures" | "showEdges" | "showGrid";
			label: string;
		}[],
	): HTMLElement {
		return renderToggleSectionFn(
			parent,
			{ settings: this.settings, save: () => void this.save() },
			heading,
			toggles,
		);
	}

	// Append the matrix-only display toggles (Group identical rows / Collapse
	// groups) into the GRAPH DISPLAY section, alongside the Show toggles. They
	// are display operations (no relayout): the projection rebuilds on the
	// display-only repaint path. Collapse depends on Group.
	private renderMatrixDisplayToggles(section: HTMLElement): void {
		const add = (
			label: string,
			get: () => boolean,
			set: (v: boolean) => void,
			enabled: boolean,
		): void => {
			const row = section.createEl("label", { cls: "gim-toggle-row" });
			if (!enabled) row.style.opacity = "0.45";
			const cb = row.createEl("input", { type: "checkbox" });
			cb.checked = get();
			cb.disabled = !enabled;
			cb.addEventListener("change", () => {
				set(cb.checked);
				void this.save();
				this.renderPanel(); // refresh Collapse enabled state
			});
			row.createSpan({ text: label });
		};
		add(
			"Group identical rows",
			() => this.settings.matrixGroupBySignature,
			(v) => (this.settings.matrixGroupBySignature = v),
			true,
		);
		add(
			"Collapse groups",
			() => this.settings.matrixCollapseGroups,
			(v) => (this.settings.matrixCollapseGroups = v),
			this.settings.matrixGroupBySignature,
		);
	}

	private renderExprSection(
		parent: HTMLElement,
		label: string,
		rows: string[],
		error: string,
		opts: {
			placeholder?: string;
			autoKey?: "whereAuto" | "groupByAuto" | "havingAuto" | "limitAuto";
		} = {},
	): HTMLElement {
		return renderExprSectionFn(
			parent,
			label,
			rows,
			error,
			{
				settings: this.settings,
				save: () => void this.save(),
				rerender: () => this.renderPanel(),
			},
			opts,
		);
	}

	// Settings that only affect WHAT is painted, not the placement. Toggling
	// these must NOT relayout — the positions stay identical to the all-on
	// layout; we just repaint.
	private static readonly DISPLAY_ONLY_KEYS = new Set([
		"showNodes",
		"showEnclosures",
		"showEdges",
		"showGrid",
		"showBody",
		// Matrix grouping / collapsing only reshape the row-line PROJECTION
		// (rebuildMatrixDisplay) + draw flags — the seriation / blocks are
		// already computed, so these repaint without a relayout.
		"matrixGroupBySignature",
		"matrixCollapseGroups",
		// Heatmap colour scale (Jaccard vs raw) only changes cell shading.
		"heatmapJaccard",
		// Lattice subset links only affect the back-layer of drawLattice —
		// toggling repaints without re-bucketing intersections.
		"latticeShowSubsetLinks",
		// Droste warp params are consumed directly by drawDroste — changing
		// them repaints the spiral without re-running layoutDroste. (drosteFocus
		// is intentionally NOT here: re-rooting the spiral IS a relayout.)
		"drosteZoom",
		"drosteTwistDir",
		"drosteCopies",
		"drosteSubdiv",
	]);

	private layoutSignature(s: MiniSettings): string {
		const out: Record<string, unknown> = {};
		const rec = s as unknown as Record<string, unknown>;
		for (const k of Object.keys(rec).sort()) {
			if (MiniGraphView.DISPLAY_ONLY_KEYS.has(k)) continue;
			out[k] = rec[k];
		}
		return JSON.stringify(out);
	}

	updateSettings(s: MiniSettings): void {
		this.settings = s;
		const sig = this.layoutSignature(s);
		if (sig !== this.lastLayoutSig) {
			// A layout-affecting setting changed → recompute placement.
			this.lastLayoutSig = sig;
			this.cardCache.clear();
			void this.rebuild();
		} else {
			// Display-only toggle → keep the existing layout. Matrix group /
			// collapse reshape the row-line projection, so refresh it before
			// repainting (no-op when there's no matrix).
			this.rebuildMatrixDisplay();
			this.requestDraw();
		}
	}

	private lastLayoutSig = "";

	private async rebuild(): Promise<void> {
		const gen = ++this.rebuildGen;

		// Stage 1: AUTO-augment GROUP_BY / WHERE, then run the vault → graph
		// builder. Errors from the query parsers are surfaced into panel
		// state so the user sees them inline.
		const { effGroupBy, effWhere } = resolveEffectiveQuery(this.settings);
		const { result, errors } = buildGraph(this.app, effWhere, effGroupBy);
		this.whereError = errors.where ?? "";
		this.groupByError = errors.groupBy ?? "";
		let { data, clusterLabels } = result;

		// Stage 1b: HAVING runs AFTER buildGraph so auto thresholds can scale
		// with the produced node count, then drops the resulting clusters
		// from each node's memberships + the cluster-label map.
		// Lattice mode is the ONE view whose value comes from DEEP intersections
		// (3-way, 4-way, …). Auto-HAVING's TOP_K=20 long-tail drop strips
		// rare tags from every note's memberships, so any 3rd+ tag on a note
		// vanishes upstream of layoutLattice and the lattice can only ever
		// show degree ≤ 2. Skip AUTO entirely for lattice — manual HAVING
		// expressions still run, and the lattice's own `Min intersection
		// size` / `Max nodes per tier` controls handle clutter. Other modes
		// keep AUTO unchanged.
		const effHavingAuto =
			this.settings.viewMode === "lattice" ? false : this.settings.havingAuto;
		const effHaving = resolveEffectiveHaving(
			this.settings.having,
			effHavingAuto,
			data.nodes.length,
		);
		const dropped = this.computeDroppedClusters(
			data.nodes,
			effHaving,
			effHavingAuto,
		);
		if (dropped.size > 0) {
			data = filterMemberships(data, dropped);
			clusterLabels = filterLabels(clusterLabels, dropped);
		}
		this.clusterLabels = clusterLabels;

		// Stage 2: degree maps (total / in / out). Used by ORDER_BY + size-
		// mode resolvers. Cleared in place so view-state references stay
		// valid for callers holding the same Map instance.
		const degrees = computeDegreeMaps(data.edges);
		this.degreeMap = degrees.degreeMap;
		this.inDegreeMap = degrees.inDegreeMap;
		this.outDegreeMap = degrees.outDegreeMap;

		// Stage 3: LIMIT. Per-tier visible-node selection + display-mode
		// assignment. Edges are re-filtered against the surviving id set.
		const limitTiers = this.parseLimitRules();
		const { visibleNodes, modes } = applyLimitRules(
			data.nodes,
			limitTiers,
			this.settings.orderField,
			this.settings.orderDir,
			(id, field) => this.getSortKey(id, field),
		);
		this.displayMode = modes;
		data = {
			nodes: visibleNodes,
			edges: filterEdgesByAlive(data.edges, (id) => modes.has(id)),
		};

		await this.ensureBodies(data.nodes);
		if (gen !== this.rebuildGen) return;

		// Recompute the cluster member sets + strict supersets against the
		// CURRENT (post-LIMIT) graph so the NODE_DISPLAY override chain
		// (own cluster → inheritFrom → strict superset → global) reflects
		// what's actually on screen.
		this.recomputeClusterRelations(data.nodes);
		this.recomputeNodeDisplayCache(data.nodes);

		// Stage 4: drop aggregated + hidden cards from the layout input.
		// They are folded back in by aggregate-snap BELOW; here we just
		// ensure they don't reserve grid cells the visible cards could
		// otherwise occupy.
		const { layoutData, preTrulyAgg } = filterLayoutData(data, this.settings);

		// Card sizes derive from the user-configured row × column span
		// times the canonical CARD_CELL_W × CARD_CELL_H lattice step, with
		// an optional degree-driven scale that preserves the m : n aspect.
		const sized = layoutData.nodes.map((n) => this.cardFor(n));
		const wasEmpty = this.laid.clusters.length === 0;
		// Seed the bipartite force layout from the previous frame's positions
		// (only when the outgoing layout WAS bipartite) so a tag-count change
		// nudges nodes instead of teleporting them.
		const bipartitePrev = this.laid.setNodeIds
			? new Map(this.laid.nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
			: undefined;
		this.laid = layout(layoutData, sized, {
			clusterSpacing: this.settings.clusterSpacing,
			nodeSpacing: this.settings.nodeSpacing,
			// Cell pitch scales up when the user-imposed font floor
			// exceeds the native title font, so cards (sized by
			// `cardFor` with the same scale) fit cleanly into one
			// slot regardless of the floor.
			cellW: CARD_CELL_W * minFontScale(this.settings.minFontPx),
			cellH: CARD_CELL_H * minFontScale(this.settings.minFontPx),
			// Forwarded so the layout scales the 隘路 (channels) by the
			// same font factor as the cells — keeps the whole grid
			// proportional to Min font size in both Euler and UpSet.
			minFontPx: this.settings.minFontPx,
			clusterLabels,
			anchorPlacement: this.settings.anchorPlacement,
			viewMode: this.settings.viewMode,
			upsetColumnSort: this.settings.upsetColumnSort,
			upsetMinColumnSize: this.settings.upsetMinColumnSize,
			matrixSort: this.settings.matrixSort,
			matrixMinColumnSize: this.settings.matrixMinColumnSize,
			matrixBlockPriority: this.settings.matrixBlockPriority,
			matrixSortDir: this.settings.matrixSortDir,
			bipartiteMaxTags: this.settings.bipartiteMaxTags,
			bipartiteLayout: this.settings.bipartiteLayout,
			latticeNodeLOD: this.settings.latticeNodeLOD,
			latticeIndividualMax: this.settings.latticeIndividualMax,
			latticeDensityMax: this.settings.latticeDensityMax,
			latticeDensityCells: this.settings.latticeDensityCells,
			latticeMinNodeSize: this.settings.latticeMinNodeSize,
			latticeMaxNodesPerTier: this.settings.latticeMaxNodesPerTier,
			latticeShowSubsetLinks: this.settings.latticeShowSubsetLinks,
			latticeSpecificTop: this.settings.latticeSpecificTop,
			drosteFocus: this.settings.drosteFocus,
			// Per-node "show names" checkbox state — layout uses it to expand
			// each checked node so its name rows fit. Spread to a plain array
			// so the LayoutOptions payload stays JSON-safe. The labels map
			// carries the actual basenames so the layout can MEASURE them
			// (no DOM access inside the layout module).
			latticeNamedKeys: [...this.latticeNamedKeys],
			latticeNamedMax: this.settings.latticeNamedMax,
			latticeNamedLabels: this.buildLatticeNamedLabels(),
			// Real ctx.measureText for the lattice's per-node header sizing.
			// Without this the layout falls back to a CJK-aware character-
			// width estimate, which is fine but less tight; the bundled hidden
			// canvas's 2D context gives pixel-accurate widths in the same
			// font family the renderer will eventually use.
			latticeMeasureText: this.measureLatticeText,
			bipartitePrev,
		});
		// Stage 5: id → incident-edge-index adjacency for hover lookups.
		this.adjacency = buildAdjacency(this.laid.edges);
		// Aggregate-snap + inheritance operate on the Euler cluster/edge model
		// (note→note vault links, per-cluster aggregation). Bipartite has its
		// own node/edge model (note↔tag) and no enclosures, so running them
		// would stitch foreign note→note edges and stray clusters into the
		// graph. Skip the whole pipeline there.
		if (this.laid.setNodeIds) {
			this.trulyAggSet = new Set();
			this.aggregateCount = new Map();
		} else {
			// Aggregate-snap: badge cell selection + edge stitching back into
			// the aggregate stack. trulyAgg + hidden were already excluded
			// from the layout pass, so the layout above ran on visible nodes
			// only and the surrounding cards have already taken their space.
			// Here we just drop the badges in free cells and add the
			// previously-omitted edges back as routes through the badges.
			const aggResult = runAggregateSnap(this.laid, {
				aggregatedLayers: this.settings.aggregatedLayers,
				hiddenNodes: this.settings.hiddenNodes,
				inheritFrom: this.settings.inheritFrom ?? {},
				trulyAgg: preTrulyAgg,
				allNodes: data.nodes,
				allEdges: data.edges,
				clusterLabels: this.clusterLabels,
			});
			this.trulyAggSet = aggResult.trulyAgg;
			this.aggregateCount = aggResult.aggregateCount;

			expandClustersByInheritance(
				this.laid.clusters,
				this.settings.inheritFrom ?? {},
			);
		}
		this.highlightedNodes.clear();
		this.highlightedEdgeIdx.clear();
		// Drop a selected column if the relayout removed it (matrix + UpSet).
		this.clearStaleSelection();
		// Rebuild the matrix display projection (blocks re-collapse on relayout).
		this.matrixExpanded.clear();
		this.matrixHoverLine = -1;
		this.matrixHoverCol = -1;
		// Drop a pinned set selection whose node may no longer exist (bipartite).
		this.pinnedSet = null;
		this.rebuildMatrixDisplay();
		// Baseline the layout signature so subsequent display-only toggles
		// (which leave this unchanged) repaint without relaying out.
		this.lastLayoutSig = this.layoutSignature(this.settings);
		const modeChanged = this.lastFramedMode !== this.settings.viewMode;
		this.lastFramedMode = this.settings.viewMode;
		if (wasEmpty || modeChanged) this.fitToView();
		this.requestDraw();
		if (this.settings.panelVisible) this.renderPanel();
	}

	// Build the effective LIMIT rule list by parsing manual rows + filling in
	// missing slots with auto defaults when `limitAuto` is on. Manual rows are
	// always respected; auto only adds rules of kinds the user didn't specify.
	private parseLimitRules(): LimitRule[] {
		const { tiers, errors } = parseLimitRulesFn(this.settings);
		this.limitError = errors.length > 0 ? errors.join("; ") : "";
		return tiers;
	}

	private getSortKey(id: string, field: string): string | number {
		return getSortKeyFn(id, field, {
			app: this.app,
			degreeMap: this.degreeMap,
			membershipsOf: (id) =>
				this.laid.nodes.find((n) => n.id === id)?.memberships,
		});
	}

	private computeDroppedClusters(
		nodes: GraphNode[],
		rawRows: string[],
		// Optional override so the rebuild() pipeline can SUPPRESS auto-drop
		// for lattice mode (where TOP_K=20 long-tail dropping cuts off any
		// 3rd+ tag on a note and collapses the intersection lattice to
		// degree ≤ 2). Falls back to settings.havingAuto for every other
		// mode, preserving prior behaviour.
		havingAutoOverride?: boolean,
	): Set<string> {
		const { dropped, errors } = computeDroppedClustersFn(
			nodes,
			rawRows,
			havingAutoOverride ?? this.settings.havingAuto,
		);
		this.havingError = errors.length > 0 ? errors.join("; ") : "";
		return dropped;
	}

	// Body preview was retired (both Euler + UpSet): cards and the hover tip
	// show title only, so no file contents are loaded.
	private async ensureBodies(_nodes: GraphNode[]): Promise<void> {
		/* no-op — body preview feature removed */
	}

	// Shared visual scale factor. ALL per-card metrics — pixel size,
	// font size, padding, stroke, text wrap width, body line count —
	// derive from this single value so cluster overrides change them
	// together instead of size scaling while font stays at 12 px.
	private getCardScale(nodeId: string): number {
		const display = this.getNodeDisplay(nodeId);
		const scaleFactor = this.computeSizeScale(nodeId, display.nodeSizeMode);
		return visualScale(display, scaleFactor, {
			nodeRows: this.settings.nodeRows,
			nodeCols: this.settings.nodeCols,
			nodeSizeMode: this.settings.nodeSizeMode,
		});
	}

	private cardFor(n: GraphNode): SizedNode {
		const display = this.getNodeDisplay(n.id);
		// 隘路 scales with the font floor too, so a multi-cell card's
		// internal channel matches the layout's slot channel and the
		// card fills its cell span exactly at every Min font size.
		const { channelW, channelH } = computeChannelDims(
			this.settings.nodeSpacing,
			minFontScale(this.settings.minFontPx),
		);
		const { width, height } = computeCardSize({
			rows: Math.max(1, display.nodeRows),
			cols: Math.max(1, display.nodeCols),
			channelW,
			channelH,
			scaleFactor: this.computeSizeScale(n.id, display.nodeSizeMode),
			minFontPx: this.settings.minFontPx,
		});
		const scale = this.getCardScale(n.id);
		const mode = this.displayMode.get(n.id) ?? "full";
		const cacheKey = `${n.id}:${mode}:${scale.toFixed(4)}`;
		const cached = this.cardCache.get(cacheKey);
		if (!cached || cached.title !== n.label) {
			// Body preview removed — cards are title-only.
			this.cardCache.set(
				cacheKey,
				this.measureCard(n.label, "", mode, width, height, scale),
			);
		}
		return { ...n, width, height };
	}

	private computeSizeScale(
		nodeId: string,
		mode?: "fixed" | "indegree" | "outdegree",
	): number {
		const m = mode ?? this.settings.nodeSizeMode;
		// Pick the directional degree map matching the chosen size mode.
		// "fixed" ignores the degree entirely (computeSizeScaleFn returns 1).
		const map = m === "indegree" ? this.inDegreeMap : this.outDegreeMap;
		const deg = map.get(nodeId) ?? 0;
		return computeSizeScaleFn(m, deg);
	}

	// Build cluster_key → member_id_set and cluster_key → strict_superset
	// keys. Called once per rebuild so the override resolver can walk the
	// "own → inheritFrom → superset → global" chain in O(1) lookups.
	private recomputeClusterRelations(nodes: GraphNode[]): void {
		this.clusterMemberSets = computeMemberSets(nodes);
		this.clusterSupersets = computeStrictSupersets(this.clusterMemberSets);
	}

	private nodeDisplayDeps(): NodeDisplayDeps {
		return {
			overrides: this.settings.nodeDisplayOverrides,
			inheritFrom: this.settings.inheritFrom,
			supersetsOf: this.clusterSupersets,
			defaults: {
				nodeRows: this.settings.nodeRows,
				nodeCols: this.settings.nodeCols,
				nodeSizeMode: this.settings.nodeSizeMode,
			},
		};
	}

	private resolveNodeDisplay(n: GraphNode): NodeDisplay {
		return resolveNodeDisplayFn(n, this.nodeDisplayDeps());
	}

	private recomputeNodeDisplayCache(nodes: GraphNode[]): void {
		this.nodeDisplayCache.clear();
		const deps = this.nodeDisplayDeps();
		for (const n of nodes) {
			this.nodeDisplayCache.set(n.id, resolveNodeDisplayFn(n, deps));
		}
	}

	private getNodeDisplay(nodeId: string): NodeDisplay {
		return (
			this.nodeDisplayCache.get(nodeId) ?? {
				nodeRows: this.settings.nodeRows,
				nodeCols: this.settings.nodeCols,
				nodeSizeMode: this.settings.nodeSizeMode,
			}
		);
	}

	private measureCard(
		title: string,
		body: string,
		mode: "full" | "brief" = "full",
		cardW: number = CARD_CELL_W,
		cardH: number = CARD_CELL_H,
		scale: number = 1,
	): CardContent {
		return measureCardFn(this.ctx, {
			title,
			body,
			mode,
			cardW,
			cardH,
			scale,
			showBody: false, // body preview removed
		});
	}

	private resize(): void {
		const dpr = window.devicePixelRatio || 1;
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		this.canvas.width = Math.max(1, Math.floor(w * dpr));
		this.canvas.height = Math.max(1, Math.floor(h * dpr));
		this.requestDraw();
	}

	private zoomBy(factor: number): void {
		const rect = this.canvas.getBoundingClientRect();
		const sx = rect.width / 2;
		const sy = rect.height / 2;
		const next = Math.max(0.005, Math.min(8, this.zoom * factor));
		const wx = (sx - this.panX) / this.zoom;
		const wy = (sy - this.panY) / this.zoom;
		this.zoom = next;
		this.panX = sx - wx * next;
		this.panY = sy - wy * next;
		this.cancelHover();
		this.requestDraw();
	}

	private fitToRect(world: { minX: number; minY: number; maxX: number; maxY: number }): void {
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		const pad = 24;
		const dw = Math.max(1, world.maxX - world.minX);
		const dh = Math.max(1, world.maxY - world.minY);
		const z = Math.min((w - 2 * pad) / dw, (h - 2 * pad) / dh);
		this.zoom = Math.min(8, Math.max(0.005, z));
		this.panX = w / 2 - ((world.minX + world.maxX) / 2) * this.zoom;
		this.panY = h / 2 - ((world.minY + world.maxY) / 2) * this.zoom;
		this.cancelHover();
		this.requestDraw();
	}

	// True when the whole diagram is on screen (zoomed out to roughly fit).
	// Recomputed each draw; gates the big centre auxiliary labels.
	private overviewActive = false;

	private isOverview(): boolean {
		// Bipartite has no enclosures (its set nodes ARE the labels), so the
		// big centred auxiliary labels don't apply — same exclusion as UpSet.
		if (
			this.laid.upset ||
			this.laid.matrix ||
			this.laid.heatmap ||
			this.laid.lattice ||
			this.laid.setNodeIds
		)
			return false;
		if (this.laid.clusters.length === 0 && this.laid.nodes.length === 0)
			return false;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const c of this.laid.clusters) {
			minX = Math.min(minX, c.x);
			minY = Math.min(minY, c.y);
			maxX = Math.max(maxX, c.x + c.width);
			maxY = Math.max(maxY, c.y + c.height);
		}
		for (const n of this.laid.nodes) {
			minX = Math.min(minX, n.x - n.width / 2);
			minY = Math.min(minY, n.y - n.height / 2);
			maxX = Math.max(maxX, n.x + n.width / 2);
			maxY = Math.max(maxY, n.y + n.height / 2);
		}
		const w = maxX - minX;
		const h = maxY - minY;
		if (!isFinite(w) || w <= 0 || h <= 0) return false;
		const panelW =
			this.settings.panelVisible && this.panelEl ? this.panelEl.offsetWidth : 0;
		const visW = Math.max(1, this.canvas.clientWidth - panelW);
		const visH = Math.max(1, this.canvas.clientHeight);
		const fitZoom = Math.min(visW / w, visH / h);
		// Show the overview labels while at (or near) the whole-diagram zoom.
		return this.zoom <= fitZoom * 1.8;
	}

	private fitToView(): void {
		// UpSet: cards sit in the MAIN area above the screen-space
		// footer. Fit them into (canvas.height - footerH) so the cards
		// and the matrix never overlap, full canvas width horizontally.
		if (this.laid.upset) {
			const u = this.laid.upset;
			// UpSet fit: cards occupy the canvas ABOVE the footer
			// (full canvas width). Footer is screen-fixed at bottom.
			// Zoom to show ~15 card rows vertically; horizontal zoom
			// fits all columns into the canvas width.
			const slotH = u.cardSlotH;
			const footerH = upsetFooterHeight(
				this.canvas.clientHeight,
				u.sets.length,
			);
			const cardsBandH = this.canvas.clientHeight - footerH;
			const targetVisibleRows = Math.max(
				8,
				Math.min(20, u.cardsWorldHeight / slotH),
			);
			const zoomFromRows = cardsBandH / (targetVisibleRows * slotH);
			// Cards START at the right edge of the row-label band, so
			// the horizontal fit area excludes that band.
			const padX = 8;
			const visW = Math.max(
				1,
				this.canvas.clientWidth - UPSET_LEFT_BAND_PX - padX,
			);
			const zoomFromW = visW / Math.max(1, u.cardsWorldWidth);
			this.zoom = Math.max(
				0.05,
				Math.min(2, Math.min(zoomFromRows, zoomFromW)),
			);
			// Cards bottom (= world y = cardsWorldHeight) anchored at
			// the top of the footer; tall stacks extend above the
			// canvas and are reachable by panning.
			this.panY = cardsBandH - u.cardsWorldHeight * this.zoom;
			// panX is set by clampPan() (called inside requestDraw).
			// Provide an initial value of 0; clamp will center or pin
			// as appropriate.
			this.panX = 0;
			this.requestDraw();
			return;
		}
		if (this.laid.matrix) {
			// Fit ALL columns across the data-area width; rows scroll
			// vertically. Pin the grid origin just past the frozen bands.
			const m = this.laid.matrix;
			const g = matrixGeom(m, 1, this.canvas.clientWidth);
			const colsW = m.cols.length * m.colW;
			const avail = Math.max(1, this.canvas.clientWidth - g.labelBand);
			this.zoom = Math.min(1.2, Math.max(0.2, avail / Math.max(1, colsW)));
			this.panX = g.labelBand;
			this.panY = matrixGeom(m, this.zoom, this.canvas.clientWidth).headerH;
			this.requestDraw();
			return;
		}
		if (this.laid.lattice) {
			// World-space tiered grid with a SCREEN-FIXED tier-label gutter on
			// the left. Strategy: fit vertically so every tier is visible (the
			// lattice's value is the tier comparison) AND take the horizontal
			// fit only when it doesn't push nodes below a readable size. The
			// initial panX anchors the leftmost node just past the gutter so
			// the gutter never overlaps any node at default zoom.
			const L = this.laid.lattice;
			const panelW =
				this.settings.panelVisible && this.panelEl ? this.panelEl.offsetWidth : 0;
			const visW = Math.max(1, this.canvas.clientWidth - panelW);
			const visH = Math.max(1, this.canvas.clientHeight);
			const pad = 8;
			const usableW = Math.max(1, visW - LATTICE_TIER_GUTTER - pad);
			const zoomY = (visH - pad * 2) / Math.max(1, L.worldHeight);
			const zoomX = usableW / Math.max(1, L.worldWidth);
			// Floor below which header text would shrink below ~10 screen px
			// (HEADER_H = 22 world × 0.45 ≈ 10 px).
			const MIN_READABLE = 0.45;
			const zoom = Math.min(2, Math.max(MIN_READABLE, Math.min(zoomY, zoomX)));
			this.zoom = zoom;
			// PinPin the leftmost node just past the gutter. Centre on the
			// gutter-right side when the whole lattice fits horizontally.
			const worldShownW = L.worldWidth * zoom;
			this.panX = worldShownW <= usableW
				? LATTICE_TIER_GUTTER + (usableW - worldShownW) / 2
				: LATTICE_TIER_GUTTER;
			const worldShownH = L.worldHeight * zoom;
			this.panY = worldShownH <= visH - pad * 2
				? pad + (visH - pad * 2 - worldShownH) / 2
				: pad;
			this.requestDraw();
			return;
		}
		if (this.laid.heatmap) {
			// Square n×n grid: fit all cells into the smaller of the two data-area
			// dimensions; pin the origin just past the frozen label bands.
			const h = this.laid.heatmap;
			const g = heatmapGeom(h, 1, this.canvas.clientWidth);
			const availW = Math.max(1, this.canvas.clientWidth - g.labelBand);
			const availH = Math.max(1, this.canvas.clientHeight - g.headerH);
			const fit = Math.min(availW, availH) / Math.max(1, h.n * h.cell);
			this.zoom = Math.min(2, Math.max(0.05, fit));
			this.panX = heatmapGeom(h, this.zoom, this.canvas.clientWidth).labelBand;
			this.panY = heatmapGeom(h, this.zoom, this.canvas.clientWidth).headerH;
			this.requestDraw();
			return;
		}
		if (this.laid.droste) {
			// Frame ~N turns of the spiral. The renderer centres z at the canvas
			// middle with R0 = min(w,h)/(4·dpr); turn m's outer radius ≈
			// R0·exp(uBase)·k^m. Solving |z|_outer·zoom ≤ 0.45·min(w,h) (device px)
			// gives zoom = 1.8 / (exp(uBase)·k^N). N = min(copies, 3) keeps the
			// inner turns legible while letting outer turns spill (Droste is
			// infinite anyway). pan = 0 (z already centred).
			const dd = this.laid.droste;
			if (dd.slices.length === 0) {
				this.zoom = 1;
			} else {
				const N = Math.min(this.settings.drosteCopies, 3);
				const k = this.settings.drosteZoom;
				this.zoom = 1.8 / (Math.exp(dd.uBase) * Math.pow(k, N));
			}
			this.panX = 0;
			this.panY = 0;
			this.requestDraw();
			return;
		}
		const hasContent =
			this.laid.clusters.length > 0 || this.laid.nodes.length > 0;
		if (!hasContent) return;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const c of this.laid.clusters) {
			minX = Math.min(minX, c.x);
			minY = Math.min(minY, c.y);
			maxX = Math.max(maxX, c.x + c.width);
			maxY = Math.max(maxY, c.y + c.height);
		}
		// Cards stay visible even when no enclosure surrounds them (e.g. files
		// that landed in NONE_BUCKET after HAVING dropped their only cluster).
		for (const n of this.laid.nodes) {
			minX = Math.min(minX, n.x - n.width / 2);
			minY = Math.min(minY, n.y - n.height / 2);
			maxX = Math.max(maxX, n.x + n.width / 2);
			maxY = Math.max(maxY, n.y + n.height / 2);
		}
		if (!isFinite(minX)) return;
		// The settings panel overlays the right side of the canvas without
		// pushing it, so subtract its width from the effective fit area and
		// centre against the visible half.
		const panelW = this.settings.panelVisible && this.panelEl ? this.panelEl.offsetWidth : 0;
		const visW = Math.max(1, this.canvas.clientWidth - panelW);
		const visH = this.canvas.clientHeight;
		// Reserve canvas-pixel padding (zoom-independent). Top gets extra room
		// for cluster labels which sit ~20 canvas px above each enclosure.
		const padX = 20;
		const padTop = 36;
		const padBottom = 20;
		const fitW = Math.max(1, visW - 2 * padX);
		const fitH = Math.max(1, visH - padTop - padBottom);
		const zx = fitW / Math.max(1, maxX - minX);
		const zy = fitH / Math.max(1, maxY - minY);
		// Min floor is intentionally very low so huge vaults still fit on
		// screen; the user can zoom in interactively as needed.
		this.zoom = Math.min(2, Math.max(0.005, Math.min(zx, zy)));
		const worldCenterX = (minX + maxX) / 2;
		const worldCenterY = (minY + maxY) / 2;
		this.panX = padX + fitW / 2 - worldCenterX * this.zoom;
		this.panY = padTop + fitH / 2 - worldCenterY * this.zoom;
		this.requestDraw();
	}

	// Clamp panX/panY so the area to the LEFT of column A or ABOVE row 1 can
	// never be revealed. The header band occupies the first headerW × headerH
	// screen pixels; the body must start at exactly worldX = minCol*W (the
	// left edge of column A) at screen x = headerW. That gives the upper-
	// bound constraint panX ≤ headerW − minCol*W*zoom. Same logic for Y.
	private clampPan(): void {
		// Connection matrix: spreadsheet scroll — never reveal empty space
		// before row/col 0 or past the last row/col.
		if (this.laid.matrix) {
			const m = this.laid.matrix;
			const g = matrixGeom(m, this.zoom, this.canvas.clientWidth);
			const colsW = m.cols.length * g.colScreenW;
			const rowsH = this.matrixLines.length * g.rowScreenH; // floored pitch
			const minPanX = Math.min(g.labelBand, this.canvas.clientWidth - colsW);
			this.panX = Math.min(g.labelBand, Math.max(minPanX, this.panX));
			const minPanY = Math.min(g.headerH, this.canvas.clientHeight - rowsH);
			this.panY = Math.min(g.headerH, Math.max(minPanY, this.panY));
			return;
		}
		if (this.laid.heatmap) {
			// Spreadsheet scroll over the square grid.
			const h = this.laid.heatmap;
			const g = heatmapGeom(h, this.zoom, this.canvas.clientWidth);
			const grid = h.n * g.cellPx;
			const minPanX = Math.min(g.labelBand, this.canvas.clientWidth - grid);
			this.panX = Math.min(g.labelBand, Math.max(minPanX, this.panX));
			const minPanY = Math.min(g.headerH, this.canvas.clientHeight - grid);
			this.panY = Math.min(g.headerH, Math.max(minPanY, this.panY));
			return;
		}
		// Euler mode: free pan in all directions (world-map tiling
		// keeps content under the cursor regardless of position).
		// UpSet mode: per user spec (2026-05-26), restrict horizontal
		// pan so the graph's left / right edges never reveal empty
		// canvas beyond them.
		if (!this.laid.upset) return;
		const u = this.laid.upset;
		const contentW = u.cardsWorldWidth * this.zoom;
		const canvasW = this.canvas.clientWidth;
		// Cards (= the "Pareto-shaped" card-stack columns) and their
		// matching matrix dots must start at the RIGHT edge of the
		// footer's row-label band (`UPSET_LEFT_BAND_PX`), never to
		// the left of it — per user spec (2026-05-26).
		const availableW = canvasW - UPSET_LEFT_BAND_PX;
		// maxPanX = panX that places cards' world-x=0 at screen-x=LEFT_BAND_PX.
		const maxPanX = UPSET_LEFT_BAND_PX;
		// minPanX = panX that places cards' right edge at canvas right.
		const minPanX = canvasW - contentW;
		if (contentW <= availableW) {
			// Cards fit in the area RIGHT of the label band — pin to
			// the left of that area (no panning needed).
			this.panX = maxPanX;
		} else {
			this.panX = Math.max(minPanX, Math.min(maxPanX, this.panX));
		}
	}

	private requestDraw(): void {
		this.clampPan();
		cancelAnimationFrame(this.rafId);
		this.rafId = requestAnimationFrame(() => this.draw());
	}

	private draw(): void {
		const ctx = this.ctx;
		const dpr = window.devicePixelRatio || 1;
		const cw = this.canvas.width;
		const ch = this.canvas.height;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = "#0f1116";
		ctx.fillRect(0, 0, cw, ch);
		// If the filter pipeline (WHERE / HAVING / LIMIT) eliminated every
		// node, draw a hint instead of an empty canvas. This makes the cause
		// of the blank view discoverable instead of mysterious.
		// UpSet mode intentionally leaves `laid.nodes` empty (the plot
		// lives in screen space, not as world-positioned cards), so the
		// hint should only fire when there's truly nothing to show —
		// here: no UpSet columns either.
		// Connection matrix: screen-space frozen-pane grid; no world cards.
		if (this.laid.matrix && this.laid.matrix.rows.length > 0) {
			drawMatrix(ctx, this.laid.matrix, {
				zoom: this.zoom,
				panX: this.panX,
				panY: this.panY,
				canvas: this.canvas,
				selectedCol: this.matrixSelectedCol,
				minFontPx: this.settings.minFontPx,
				lines: this.matrixLines,
				group: this.settings.matrixGroupBySignature,
				hoverLine: this.matrixHoverLine,
				hoverCol: this.matrixHoverCol,
			});
			return;
		}
		// Intersection lattice: world-space tier grid + subset links. drawLattice
		// applies its own dpr/zoom/pan transform; we draw and return.
		if (this.laid.lattice && this.laid.lattice.nodes.length > 0) {
			drawLattice(ctx, this.laid.lattice, {
				zoom: this.zoom,
				panX: this.panX,
				panY: this.panY,
				canvas: this.canvas,
				dpr,
				minFontPx: this.settings.minFontPx,
				settings: {
					latticeNodeLOD: this.settings.latticeNodeLOD,
					latticeIndividualMax: this.settings.latticeIndividualMax,
					latticeDensityMax: this.settings.latticeDensityMax,
					latticeDensityCells: this.settings.latticeDensityCells,
					latticeShowSubsetLinks: this.settings.latticeShowSubsetLinks,
				},
				selectedKey: this.latticeSelectedKey,
				hoverKey: this.latticeHoverKey,
				namedKeys: this.latticeNamedKeys,
				namedMax: this.settings.latticeNamedMax,
				// Closure: id → file basename via the live vault. Falls back
				// to a path-tail strip inside draw-lattice when omitted, so
				// unit tests / probes still work without a vault.
				nameOf: (id: string) => {
					const sep = id.indexOf("\t");
					const path = sep >= 0 ? id.slice(sep + 1) : id;
					const f = this.app.vault.getAbstractFileByPath(path);
					return f instanceof TFile ? f.basename : path;
				},
			});
			return;
		}
		// Print Gallery (Escher): conformal Droste warp of the strip layout.
		if (this.laid.droste && this.laid.droste.slices.length > 0) {
			drawDroste(ctx, this.laid.droste, {
				zoom: this.zoom,
				panX: this.panX,
				panY: this.panY,
				canvas: this.canvas,
				dpr,
				k: this.settings.drosteZoom,
				twistDir: this.settings.drosteTwistDir,
				copies: this.settings.drosteCopies,
				subdiv: this.settings.drosteSubdiv,
				minFontPx: this.settings.minFontPx,
				hoverId: this.hoveredNodeId,
			});
			return;
		}
		// Tag co-occurrence heatmap: screen-space frozen-pane cell grid.
		if (this.laid.heatmap && this.laid.heatmap.n > 0) {
			drawHeatmap(ctx, this.laid.heatmap, {
				zoom: this.zoom,
				panX: this.panX,
				panY: this.panY,
				canvas: this.canvas,
				minFontPx: this.settings.minFontPx,
				jaccard: this.settings.heatmapJaccard,
				selected: this.heatmapSelected,
				hoverRow: this.heatmapHoverRow,
				hoverCol: this.heatmapHoverCol,
			});
			return;
		}
		const upsetHasColumns = (this.laid.upset?.columns.length ?? 0) > 0;
		const matrixHasRows = (this.laid.matrix?.rows.length ?? 0) > 0;
		const heatmapHasCells = (this.laid.heatmap?.n ?? 0) > 0;
		const latticeHasNodes = (this.laid.lattice?.nodes.length ?? 0) > 0;
		if (
			this.laid.nodes.length === 0 &&
			!upsetHasColumns &&
			!matrixHasRows &&
			!heatmapHasCells &&
			!latticeHasNodes
		) {
			ctx.fillStyle = "#7a8aa0";
			ctx.font = `${14 * dpr}px sans-serif`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(
				"No nodes match current filters — relax WHERE / HAVING / LIMIT or check the GROUP_BY expression.",
				cw / 2,
				ch / 2,
			);
			return;
		}
		this.overviewActive = this.isOverview();
		ctx.setTransform(dpr * this.zoom, 0, 0, dpr * this.zoom, dpr * this.panX, dpr * this.panY);

		// Excel-style row/column underlay. Drawn first so enclosures, edges,
		// trunks, and cards all sit on top. Cells follow card geometry and
		// ignore the cluster bounding boxes by design. Bipartite is a free-form
		// force graph (no lattice), so the grid/graticule is meaningless there.
		if (this.settings.showGrid && !this.laid.setNodeIds) {
			this.drawCardGrid(ctx);
		}

		// World-map tiling. The body content (enclosures, edges, cards,
		// stacks, labels) repeats every (360 cols × 180 rows) — same
		// period as the lat/lon labels. So when the user pans past
		// "180°E" they see the SAME content again from "180°W" onward,
		// like a digital world map.
		const W = this.laid.slotW;
		const H = this.laid.slotH;
		const periodX = 360 * W;
		const periodY = 180 * H;
		const visW = cw / dpr;
		const visH = ch / dpr;
		// Viewport in world coords.
		const leftWorld = -this.panX / this.zoom;
		const rightWorld = (visW - this.panX) / this.zoom;
		const topWorld = -this.panY / this.zoom;
		const bottomWorld = (visH - this.panY) / this.zoom;
		// Content bbox (= union of card footprints + cluster rects).
		// Falls back to a tiny window when there are no nodes.
		let contentMinX = Infinity,
			contentMaxX = -Infinity,
			contentMinY = Infinity,
			contentMaxY = -Infinity;
		for (const n of this.laid.nodes) {
			contentMinX = Math.min(contentMinX, n.x - n.width / 2);
			contentMaxX = Math.max(contentMaxX, n.x + n.width / 2);
			contentMinY = Math.min(contentMinY, n.y - n.height / 2);
			contentMaxY = Math.max(contentMaxY, n.y + n.height / 2);
		}
		for (const c of this.laid.clusters) {
			contentMinX = Math.min(contentMinX, c.x);
			contentMaxX = Math.max(contentMaxX, c.x + c.width);
			contentMinY = Math.min(contentMinY, c.y);
			contentMaxY = Math.max(contentMaxY, c.y + c.height);
		}
		if (!isFinite(contentMinX)) {
			contentMinX = 0;
			contentMaxX = W;
			contentMinY = 0;
			contentMaxY = H;
		}
		// Visible range is locked to a single period — the user explicitly
		// requested "ちょうど一周分" (exactly one revolution) in both lat
		// and lon. So we draw only the base tile (i=0, j=0); panning past
		// the content boundary now reveals empty world, not a repeat.
		// `periodX` / `periodY` / `leftWorld` / `rightWorld` /
		// `topWorld` / `bottomWorld` / `contentMin*` / `contentMax*` are
		// kept above for the axis-label and grid code that still needs
		// them.
		void leftWorld;
		void rightWorld;
		void topWorld;
		void bottomWorld;
		void periodX;
		void periodY;
		const iLo = 0;
		const iHi = 0;
		const jLo = 0;
		const jHi = 0;

		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		const hasHighlight = this.highlightedEdgeIdx.size > 0;
		const hiddenSet = new Set(this.settings.hiddenNodes);
		const skipNode = (id: string): boolean =>
			hiddenSet.has(id) || this.trulyAggSet.has(id);

		for (let ti = iLo; ti <= iHi; ti++) {
			for (let tj = jLo; tj <= jHi; tj++) {
				const offX = ti * periodX;
				const offY = tj * periodY;
				ctx.setTransform(
					dpr * this.zoom,
					0,
					0,
					dpr * this.zoom,
					dpr * (this.panX + this.zoom * offX),
					dpr * (this.panY + this.zoom * offY),
				);
				this.drawBodyTile(ctx, hasHighlight, skipNode);
			}
		}

		// Restore the world transform so the cluster labels (above) and
		// header (below) draw in the canonical (0,0)-tile.
		ctx.setTransform(
			dpr * this.zoom,
			0,
			0,
			dpr * this.zoom,
			dpr * this.panX,
			dpr * this.panY,
		);
		if (this.settings.showEnclosures) {
			this.drawClusterLabels(ctx);
		}

		if (this.settings.showGrid && !this.laid.setNodeIds) {
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			this.drawGridHeaders(ctx);
		}

		// UpSet footer (matrix + row labels) — screen-fixed at the
		// bottom of the canvas. Cards above keep the full canvas
		// width.
		if (this.laid.upset) {
			drawUpsetFooter(
				ctx,
				this.laid,
				this.canvas.clientWidth,
				this.canvas.clientHeight,
				dpr,
				this.zoom,
				this.panX,
				this.panY,
				this.upsetSelectedSignatureKey,
				this.settings.minFontPx,
			);
		}
	}

	// Single-tile body renderer — called once per (i, j) tile in the
	// world-map tiling loop. Assumes the context transform is already
	// set for the appropriate tile offset.
	private drawBodyTile(
		ctx: CanvasRenderingContext2D,
		hasHighlight: boolean,
		skipNode: (id: string) => boolean,
	): void {
		// UpSet mode: matrix + labels live in the bottom footer
		// (screen space), so the body-tile loop has nothing to do
		// for it here. The footer itself is drawn after this loop at
		// the end of draw().
		if (this.settings.showEnclosures && !this.laid.upset) {
			const hn = this.hoveredNodeId
				? this.laid.nodes.find((n) => n.id === this.hoveredNodeId)
				: null;
			drawEnclosures(
				ctx,
				this.laid.clusters,
				this.highlightedClusters,
				this.zoom,
				hn ? { x: hn.x, y: hn.y } : null,
				this.settings.viewMode === "bubblesets",
			);
		}

		if (this.settings.showEdges) {
			drawBaseEdges(
				ctx,
				this.laid,
				this.zoom,
				this.highlightedEdgeIdx,
				skipNode,
			);
		}

		if (this.settings.showNodes) {
			for (const n of this.laid.nodes) {
				if (this.highlightedNodes.has(n.id)) continue;
				if (skipNode(n.id)) continue;
				this.drawCard(ctx, n, false);
			}
		}

		if (
			this.settings.showNodes &&
			this.aggregateCount.size > 0 &&
			this.laid.nodes.length > 0
		) {
			const cardW = this.laid.nodes[0].width;
			const cardH = this.laid.nodes[0].height;
			for (const cluster of this.laid.clusters) {
				const count = this.aggregateCount.get(cluster.groupKey);
				if (!count) continue;
				const isHigh = this.highlightedClusters.has(cluster.groupKey);
				this.drawAggregateStack(ctx, cluster, cardW, cardH, count, isHigh);
			}
		}

		if (hasHighlight && this.settings.showEdges) {
			drawAccentEdges(
				ctx,
				this.laid,
				this.zoom,
				this.highlightedEdgeIdx,
				this.hoveredNodeId,
				skipNode,
			);
		}

		if (this.settings.showNodes) {
			for (const n of this.laid.nodes) {
				if (!this.highlightedNodes.has(n.id)) continue;
				if (skipNode(n.id)) continue;
				this.drawCard(ctx, n, true);
			}
		}

		// Overview auxiliary labels: a big centred name per enclosure, shown
		// whenever the whole diagram is in view — independent of the Graph-
		// display toggles, and separate from the on-grid title bars. Not in
		// UpSet mode.
		if (this.overviewActive && !this.laid.upset) {
			drawOverviewLabelsFn(ctx, this.laid, this.zoom);
		}
	}

	// Slot lattice with VISIBLE channels (= the user's 隘路). Each card cell
	// is bordered by 4 line segments hugging the card area itself; between
	// neighbouring cells the lines break, leaving channelW × channelH wide
	// strips of blank space. Cluster enclosures, trunks and single wires
	// all route through those visible channels.
	private drawCardGrid(ctx: CanvasRenderingContext2D): void {
		drawCardGridFn(ctx, this.laid, this.canvas, this.zoom, this.panX, this.panY);
		void this.settings.minFontPx; // grid lines have no text — floor unused here
	}

	// Frozen-pane row/column headers. Drawn in SCREEN space (identity
	// transform with DPR applied) so they stay glued to the canvas edges
	// regardless of pan/zoom — like Excel's frozen header rows/columns.
	// Cells inside each band still align horizontally / vertically with the
	// world-space body cells via worldX * zoom + panX.
	private drawGridHeaders(ctx: CanvasRenderingContext2D): void {
		drawGridHeadersFn(
			ctx,
			this.laid,
			this.canvas,
			this.zoom,
			this.panX,
			this.panY,
			this.settings.minFontPx,
		);
	}

	private drawClusterLabels(ctx: CanvasRenderingContext2D): void {
		// Stash the placed label boxes so overlap can be inspected (debug)
		// via the view instance — no behavioural effect.
		this._labelBoxes = drawClusterLabelsFn(
			ctx,
			this.laid,
			this.zoom,
			this.settings.minFontPx,
		);
	}

	// Debug: last-drawn cluster label boxes (world space).
	_labelBoxes: import("./draw-helpers").PlacedLabelBox[] = [];

	private drawAggregateStack(
		ctx: CanvasRenderingContext2D,
		cluster: ClusterRect,
		cardW: number,
		cardH: number,
		count: number,
		highlighted = false,
	): void {
		drawAggregateStackFn(
			ctx,
			cluster,
			cardW,
			cardH,
			count,
			this.zoom,
			highlighted,
			this.settings.minFontPx,
		);
	}

	private drawCard(
		ctx: CanvasRenderingContext2D,
		n: PositionedNode,
		highlighted: boolean,
	): void {
		// Pre-resolve everything that's view-state-dependent so the
		// renderer in draw-card.ts can stay pure: cache lookup via the
		// `${id}:${mode}:${scale.toFixed(4)}` composite key (= same key
		// `cardFor()` writes with).
		// Euler-nested copies carry a `${tag}\t${origId}` id; resolve scale,
		// display-mode and the body-line cache against the ORIGINAL id so the
		// font scales with the node's (degree-driven) size and the cached body
		// is found. Non-duplicated ids contain no tab → used as-is.
		const sepIdx = n.id.indexOf("\t");
		const baseId = sepIdx >= 0 ? n.id.slice(sepIdx + 1) : n.id;
		const scale = this.getCardScale(baseId);
		const mode = this.displayMode.get(baseId) ?? "full";
		const card = this.cardCache.get(`${baseId}:${mode}:${scale.toFixed(4)}`);
		// Bipartite SET (tag) nodes render coloured by their tag hue so they
		// read as set cores; NOTE nodes use the default dark card.
		const isSet = this.laid.setNodeIds?.has(n.id) ?? false;
		// Clustered bipartite: nodes are markers until zoomed in enough to read
		// the title (≥ 46 screen px wide); below that, no title / no "…".
		const clustered =
			this.settings.viewMode === "bipartite" &&
			this.settings.bipartiteLayout === "clustered";
		drawCardFn(ctx, n, {
			scale,
			bodyLines: [],
			showBody: false, // body preview removed
			highlighted,
			zoom: this.zoom,
			minFontPx: this.settings.minFontPx,
			fillHue: isSet ? clusterHue(n.memberships[0] ?? n.id) : undefined,
			// Clustered notes carry their island's main-tag in hueKey → muted tint.
			tintHue: !isSet && n.hueKey ? clusterHue(n.hueKey) : undefined,
			// Clustered LOD: the tag-centre label has a LOWER threshold than note
			// titles, so when zooming out the note names drop to markers first and
			// the island's tag label is the last to disappear.
			titleLodPx: clustered ? (isSet ? 26 : 48) : undefined,
		});
	}

	private screenToWorld(sx: number, sy: number): { x: number; y: number } {
		return screenToWorldFn(sx, sy, this.panX, this.panY, this.zoom);
	}

	private hitTest(wx: number, wy: number): HoverTarget {
		return hitTestFn(wx, wy, this.laid.nodes, this.laid.clusters, this.zoom);
	}

	private openFile(id: string): void {
		// Euler-nested copies use a `${tag}\t${origPath}` id — open the
		// ORIGINAL file path, not the prefixed copy id.
		const sepIdx = id.indexOf("\t");
		const path = sepIdx >= 0 ? id.slice(sepIdx + 1) : id;
		this.app.workspace.openLinkText(path, "", false);
	}

	// Inverse-map a pointer position (CSS px, as every other hit path here
	// receives — see screenToWorld / onPointerMove which pass e.clientX-rect.left)
	// back to a strip-space (u, v) and resolve the band element under it. This
	// inverts draw-droste's project(): forward does
	//   x_dev = cx + (z.re·zoom + panX)·dpr,   cx = canvas.width/2 (device px)
	// so for a CSS-pixel sx the device X is sx·dpr and
	//   z.re = ((sx·dpr − cx)/dpr − panX)/zoom.
	// Keeping sx in CSS px makes panX/zoom match the same units screenToWorld
	// uses (it does NOT multiply by dpr), so hover/click land correctly.
	private drosteHitTest(sx: number, sy: number): string | null {
		const d = this.laid.droste;
		if (!d) return null;
		const dpr = window.devicePixelRatio || 1;
		const R0 = Math.min(this.canvas.width, this.canvas.height) / (4 * dpr);
		const p = {
			k: this.settings.drosteZoom,
			twistDir: (this.settings.drosteTwistDir === "ccw" ? 1 : -1) as 1 | -1,
			R0,
		};
		// device pixel → world complex z (inverse of draw-droste project()).
		const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
		const z = {
			re: ((sx * dpr - cx) / dpr - this.panX) / this.zoom,
			im: ((sy * dpr - cy) / dpr - this.panY) / this.zoom,
		};
		// Front-most first (largest m = innermost/finest). Restrict to drawn copies.
		// Turn m drew hierarchy slice (m mod L), so hit-test the SAME slice.
		const L = d.slices.length;
		if (L === 0) return null;
		for (let m = this.settings.drosteCopies - 1; m >= 0; m--) {
			const { u, vRaw } = drosteInverseBranch(z, p, m);
			const v = ((vRaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
			for (const e of d.slices[m % L]) {
				if (u >= e.u0 && u <= e.u1 && v >= e.v0 && v < e.v1) return e.id;
			}
		}
		return null;
	}

	// Heatmap cell click → a floating overlay listing the notes shared by the
	// tag pair (or, on the diagonal, all notes of the tag). Each row opens the
	// file. Reuses openFile; styled inline so it works without extra CSS.
	private openHeatmapDetail(i: number, j: number, sx: number, sy: number): void {
		const h = this.laid.heatmap;
		if (!h) return;
		const a = h.nodeIds[i] ?? [];
		let ids: string[];
		if (i === j) {
			ids = a.slice();
		} else {
			const setB = new Set(h.nodeIds[j] ?? []);
			ids = a.filter((id) => setB.has(id));
		}
		ids = [...new Set(ids)];
		const ti = h.tags[i].label;
		const tj = h.tags[j].label;
		const title = i === j ? `${ti} (${ids.length})` : `${ti} × ${tj} (${ids.length})`;
		this.showNodeListOverlay(title, ids, sx, sy, () => {
			this.heatmapSelected = null;
		});
	}

	// Lattice node click (header / overview / density / Other) → same overlay
	// as heatmap: a floating list of every note in that exact intersection.
	// `node.nodeIds` is the precomputed sorted list (see lattice-layout step
	// 4 for Other bundles), so we just pass through to the generic overlay.
	private openLatticeDetail(
		node: import("./layout").LatticeNodeMeta,
		sx: number,
		sy: number,
	): void {
		const sigTitle = node.isOther
			? `Other (×${node.signature.length || node.count})`
			: node.displayTags.length
				? node.displayTags.map((s) => `#${s}`).join(" ∩ ")
				: "(no tags)";
		const title = `${sigTitle} (${node.nodeIds.length})`;
		this.showNodeListOverlay(title, node.nodeIds, sx, sy, () => {
			this.latticeSelectedKey = null;
		});
	}

	// Generic floating note-list overlay. Used by both heatmap (tag×tag) and
	// lattice (intersection signature) clicks: title is caller-formatted, ids
	// are the file-path tokens to list, (sx, sy) is the click point used by
	// positionDetail, and onCloseSelection clears the caller's selection
	// state when the panel's × is pressed.
	private showNodeListOverlay(
		title: string,
		ids: string[],
		sx: number,
		sy: number,
		onCloseSelection?: () => void,
	): void {
		this.closeDetail();
		const panel = this.root.createDiv({ cls: "gim-detail-panel" });
		Object.assign(panel.style, {
			position: "absolute",
			width: "248px",
			maxHeight: "320px",
			display: "flex",
			flexDirection: "column",
			background: "rgba(20, 24, 33, 0.98)",
			border: "1px solid #3a4760",
			borderRadius: "6px",
			boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
			zIndex: "50",
			font: "13px sans-serif",
			color: "#e6edf3",
		} as Partial<CSSStyleDeclaration>);

		const head = panel.createDiv({ cls: "gim-detail-head" });
		Object.assign(head.style, {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			padding: "6px 8px",
			borderBottom: "1px solid #2a3447",
			fontWeight: "700",
		} as Partial<CSSStyleDeclaration>);
		head.createSpan({ text: title });
		const close = head.createEl("button", { text: "×" });
		Object.assign(close.style, {
			background: "transparent",
			border: "none",
			color: "#9eb0c4",
			cursor: "pointer",
			fontSize: "16px",
		} as Partial<CSSStyleDeclaration>);
		close.addEventListener("click", () => {
			if (onCloseSelection) onCloseSelection();
			this.closeDetail();
			this.requestDraw();
		});

		const list = panel.createDiv({ cls: "gim-detail-list" });
		Object.assign(list.style, { overflowY: "auto", padding: "4px 0" } as Partial<CSSStyleDeclaration>);
		if (ids.length === 0) {
			const empty = list.createDiv({ text: "(no shared notes)" });
			Object.assign(empty.style, { padding: "6px 10px", color: "#7a8aa0" } as Partial<CSSStyleDeclaration>);
		}
		for (const id of ids) {
			const sep = id.indexOf("\t");
			const path = sep >= 0 ? id.slice(sep + 1) : id;
			const f = this.app.vault.getAbstractFileByPath(path);
			const name = f instanceof TFile ? f.basename : path;
			const row = list.createDiv({ cls: "gim-detail-row", text: name });
			Object.assign(row.style, {
				padding: "4px 10px",
				cursor: "pointer",
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis",
			} as Partial<CSSStyleDeclaration>);
			row.addEventListener("mouseenter", () => (row.style.background = "rgba(160,190,230,0.14)"));
			row.addEventListener("mouseleave", () => (row.style.background = "transparent"));
			row.addEventListener("click", () => {
				this.openFile(id);
			});
		}
		this.detailEl = panel;
		this.positionDetail(sx, sy, panel);
	}

	private closeDetail(): void {
		if (this.detailEl) {
			this.detailEl.remove();
			this.detailEl = null;
		}
	}

	private positionDetail(sx: number, sy: number, el: HTMLElement): void {
		const rect = this.canvas.getBoundingClientRect();
		const w = 248;
		const h = Math.min(320, el.offsetHeight || 320);
		let x = Math.min(sx + 14, rect.width - w - 8);
		x = Math.max(8, x);
		let y = Math.min(sy + 8, rect.height - h - 8);
		y = Math.max(8, y);
		el.style.left = `${x}px`;
		el.style.top = `${y}px`;
	}

	// Build the visible display lines: rows bundled into signature blocks, and
	// (in collapse mode) collapsed blocks shown as one "×N" summary line.
	private rebuildMatrixDisplay(): void {
		const m = this.laid.matrix;
		if (!m) {
			this.matrixLines = [];
			return;
		}
		const group = this.settings.matrixGroupBySignature;
		const collapse = group && this.settings.matrixCollapseGroups;
		const lines: MatrixLine[] = [];
		if (!group) {
			for (let r = 0; r < m.rows.length; r++)
				lines.push({ kind: "row", rowIdx: r, blockIdx: 0, head: false });
			this.matrixLines = lines;
			return;
		}
		for (let bi = 0; bi < m.blocks.length; bi++) {
			const b = m.blocks[bi];
			if (collapse && !this.matrixExpanded.has(bi)) {
				lines.push({ kind: "summary", blockIdx: bi });
			} else {
				for (let k = 0; k < b.count; k++)
					lines.push({ kind: "row", rowIdx: b.start + k, blockIdx: bi, head: k === 0 });
			}
		}
		this.matrixLines = lines;
	}

	// Display-line index under the cursor (-1 = header / out of range).
	private matrixLineAt(sy: number): number {
		const m = this.laid.matrix;
		if (!m) return -1;
		const g = matrixGeom(m, this.zoom, this.canvas.clientWidth);
		if (sy < g.headerH) return -1;
		const li = Math.floor((sy - this.panY) / g.rowScreenH);
		return li >= 0 && li < this.matrixLines.length ? li : -1;
	}

	// Column index under the cursor (-1 = label band / out of range).
	private matrixColAt(sx: number): number {
		const m = this.laid.matrix;
		if (!m) return -1;
		const g = matrixGeom(m, this.zoom, this.canvas.clientWidth);
		if (sx < g.labelBand) return -1;
		const c = Math.floor((sx - this.panX) / g.colScreenW);
		return c >= 0 && c < m.cols.length ? c : -1;
	}

	// Heatmap cell (row i, col j) under the cursor, or null if over a frozen
	// band / out of range.
	private heatmapCellAt(sx: number, sy: number): { i: number; j: number } | null {
		const h = this.laid.heatmap;
		if (!h) return null;
		const g = heatmapGeom(h, this.zoom, this.canvas.clientWidth);
		if (sx < g.labelBand || sy < g.headerH) return null;
		const j = Math.floor((sx - this.panX) / g.cellPx);
		const i = Math.floor((sy - this.panY) / g.cellPx);
		if (i < 0 || i >= h.n || j < 0 || j >= h.n) return null;
		return { i, j };
	}

	// Shared guard: drop a selected column whose set no longer contains it
	// after a relayout (used for both the matrix and the UpSet selection).
	private clearStaleSelection(): void {
		if (
			this.matrixSelectedCol != null &&
			!this.laid.matrix?.cols.some((c) => c.key === this.matrixSelectedCol)
		)
			this.matrixSelectedCol = null;
		if (
			this.upsetSelectedSignatureKey != null &&
			!this.laid.upset?.columns.some(
				(c) => c.signature.join("|") === this.upsetSelectedSignatureKey,
			)
		)
			this.upsetSelectedSignatureKey = null;
		// Heatmap: a relayout (min-tag-size / query change) re-seriates tags, so
		// the stored cell indices no longer map to the same tag pair. Clear the
		// selection and close its (now-stale) detail overlay — same intent as the
		// matrix/UpSet stale-clear above.
		this.heatmapHoverRow = -1;
		this.heatmapHoverCol = -1;
		if (this.heatmapSelected) {
			this.heatmapSelected = null;
			this.closeDetail();
		}
		// Lattice: a relayout re-buckets intersections; selected key may no
		// longer exist. Clear and close any open list overlay tied to it.
		const latticeKeys = new Set(this.laid.lattice?.nodes.map((n) => n.key) ?? []);
		this.latticeHoverKey = null;
		// Prune named-checkbox keys for nodes that no longer exist after the
		// relayout (e.g. a tier was culled by Min intersection size, or the
		// signature was top-N collapsed into an "Other" bundle whose key
		// differs). Keeps `latticeNamedKeys` from growing unboundedly.
		for (const k of [...this.latticeNamedKeys]) {
			if (!latticeKeys.has(k)) this.latticeNamedKeys.delete(k);
		}
		if (this.latticeSelectedKey && !latticeKeys.has(this.latticeSelectedKey)) {
			this.latticeSelectedKey = null;
			this.closeDetail();
		}
	}

	private onPointerMove(e: MouseEvent): void {
		if (this.dragging) {
			this.cancelHover();
			return;
		}
		const rect = this.canvas.getBoundingClientRect();
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;
		if (this.laid.matrix) {
			// Crosshair: highlight the hovered line + column.
			const li = this.matrixLineAt(sy);
			const col = this.matrixColAt(sx);
			if (li !== this.matrixHoverLine || col !== this.matrixHoverCol) {
				this.matrixHoverLine = li;
				this.matrixHoverCol = col;
				this.requestDraw();
			}
			// Column header hover → tag name + count tooltip (same lifecycle as
			// the row tip). Row hover → full file-name tooltip.
			const g = matrixGeom(this.laid.matrix, this.zoom, this.canvas.clientWidth);
			const line = li >= 0 ? this.matrixLines[li] : null;
			let target: HoverTarget = null;
			if (sy < g.headerH && col >= 0) {
				target = { kind: "matrixCol", col };
			} else if (line && line.kind === "row") {
				target = { kind: "node", nodeId: this.laid.matrix.rows[line.rowIdx].id };
			}
			if (!sameTarget(this.hoverTarget, target)) {
				this.cancelHover();
				this.hoverTarget = target;
				if (target) this.scheduleHover(target, sx, sy);
			} else if (this.tipEl) {
				this.positionTip(sx, sy, this.tipEl);
			}
			return;
		}
		if (this.laid.lattice) {
			// World-space hit-test (lattice has its own per-cell hit test
			// when zoomed into individual LOD; otherwise the whole node box).
			// The screen-fixed tier-label gutter covers x ∈ [0, TIER_GUTTER),
			// so pointer activity inside the gutter must never resolve to a
			// node behind it.
			const w = this.screenToWorld(sx, sy);
			const meta = this.laid.lattice;
			const hitNode = sx < LATTICE_TIER_GUTTER
				? null
				: latticeNodeAt(meta, w.x, w.y);
			const key = hitNode?.key ?? null;
			if (key !== this.latticeHoverKey) {
				this.latticeHoverKey = key;
				this.requestDraw();
			}
			// Tooltip: per-node summary (signature × N). Reuse the generic
			// hover-target dispatch — a future "latticeNode" target could
			// add a richer tip; for now we just clear/skip to keep this
			// non-blocking.
			if (this.hoverTarget) {
				this.cancelHover();
				this.hoverTarget = null;
			}
			return;
		}
		if (this.laid.heatmap) {
			// Crosshair on the hovered cell's row + column; tooltip = (i × j = N).
			const cell = this.heatmapCellAt(sx, sy);
			const hr = cell ? cell.i : -1;
			const hc = cell ? cell.j : -1;
			if (hr !== this.heatmapHoverRow || hc !== this.heatmapHoverCol) {
				this.heatmapHoverRow = hr;
				this.heatmapHoverCol = hc;
				this.requestDraw();
			}
			const target: HoverTarget = cell ? { kind: "heatmapCell", i: cell.i, j: cell.j } : null;
			if (!sameTarget(this.hoverTarget, target)) {
				this.cancelHover();
				this.hoverTarget = target;
				if (target) this.scheduleHover(target, sx, sy);
			} else if (this.tipEl) {
				this.positionTip(sx, sy, this.tipEl);
			}
			return;
		}
		if (this.laid.droste) {
			// Conformal inverse-map: hover-highlight the band under the cursor.
			const id = this.drosteHitTest(sx, sy);
			if (id !== this.hoveredNodeId) {
				this.hoveredNodeId = id;
				this.requestDraw();
			}
			if (this.hoverTarget) {
				this.cancelHover();
				this.hoverTarget = null;
			}
			return;
		}
		const w = this.screenToWorld(sx, sy);
		const hit = this.hitTest(w.x, w.y);
		if (!sameTarget(this.hoverTarget, hit)) {
			// While a set selection is pinned (bipartite), keep its highlight —
			// only update the tooltip target, don't recompute hover highlight.
			if (this.pinnedSet) {
				if (this.tipEl) {
					this.tipEl.remove();
					this.tipEl = null;
				}
				this.hoverGen++;
				this.hoverTarget = hit;
				if (hit) this.scheduleHover(hit, sx, sy);
				return;
			}
			this.cancelHover();
			this.hoverTarget = hit;
			this.applyHighlight(hit);
			if (hit) this.scheduleHover(hit, e.clientX - rect.left, e.clientY - rect.top);
		} else if (this.tipEl) {
			this.positionTip(e.clientX - rect.left, e.clientY - rect.top, this.tipEl);
		}
	}

	private applyHighlight(target: HoverTarget): void {
		// The pure computeHighlight() returns 4 fresh sets; assign them
		// wholesale to the view fields so the renderer sees a consistent
		// snapshot. Renderer reads these sets directly (no .clear() races).
		const next = computeHighlight(
			target,
			this.laid.nodes,
			this.laid.edges,
			this.adjacency,
		);
		this.highlightedNodes = next.highlightedNodes;
		this.highlightedClusters = next.highlightedClusters;
		this.highlightedEdgeIdx = next.highlightedEdgeIdx;
		this.hoveredNodeId = next.hoveredNodeId;
		this.requestDraw();
	}

	private scheduleHover(target: NonNullable<HoverTarget>, sx: number, sy: number): void {
		const gen = ++this.hoverGen;
		this.hoverTimer = window.setTimeout(() => {
			if (gen !== this.hoverGen) return;
			void this.showHover(target, sx, sy);
		}, HOVER_DELAY_MS);
	}

	private cancelHover(): void {
		this.hoverGen++;
		if (this.hoverTimer) {
			window.clearTimeout(this.hoverTimer);
			this.hoverTimer = 0;
		}
		if (this.tipEl) {
			this.tipEl.remove();
			this.tipEl = null;
		}
		this.hoverTarget = null;
		// A pinned set selection (bipartite) keeps its highlight through hover
		// cancellation (mouseleave / wheel / drag); only an explicit click clears it.
		if (this.pinnedSet) return;
		if (
			this.highlightedEdgeIdx.size > 0 ||
			this.highlightedNodes.size > 0 ||
			this.highlightedClusters.size > 0 ||
			this.hoveredNodeId !== null
		) {
			this.highlightedEdgeIdx.clear();
			this.highlightedNodes.clear();
			this.highlightedClusters.clear();
			this.hoveredNodeId = null;
			this.requestDraw();
		}
	}

	private async showHover(target: NonNullable<HoverTarget>, sx: number, sy: number): Promise<void> {
		const gen = this.hoverGen;
		const tip = document.createElement("div");
		tip.className = "gim-hover-tip gim-tip-" + target.kind;
		tip.setAttr("data-kind", target.kind);

		if (target.kind === "matrixCol") {
			// Connection-matrix column header: tag name + member-note count.
			const c = this.laid.matrix?.cols[target.col];
			if (!c) return;
			tip.createSpan({ cls: "gim-tip-title", text: c.label });
			tip.createSpan({ cls: "gim-tip-sub", text: `${c.size} notes` });
			this.root.appendChild(tip);
			this.tipEl = tip;
			this.positionTip(sx, sy, tip);
			return;
		}
		if (target.kind === "heatmapCell") {
			// Heatmap cell: "(tag i × tag j = N shared)" — or tag size on diagonal.
			const h = this.laid.heatmap;
			if (!h || target.i >= h.n || target.j >= h.n) return;
			const ti = h.tags[target.i];
			const tj = h.tags[target.j];
			const cnt = h.counts[target.i * h.n + target.j];
			if (target.i === target.j) {
				tip.createSpan({ cls: "gim-tip-title", text: ti.label });
				tip.createSpan({ cls: "gim-tip-sub", text: `${ti.size} notes` });
			} else {
				// Raw intersection count + the Jaccard ratio so both the absolute
				// and the normalised strength are readable, independent of the
				// cell's colour scale.
				const uni = ti.size + tj.size - cnt;
				const jac = uni > 0 ? (cnt / uni).toFixed(2) : "0.00";
				tip.createSpan({ cls: "gim-tip-title", text: `${ti.label} ∩ ${tj.label}` });
				tip.createSpan({ cls: "gim-tip-sub", text: `${cnt} notes (Jaccard ${jac})` });
			}
			this.root.appendChild(tip);
			this.tipEl = tip;
			this.positionTip(sx, sy, tip);
			return;
		}
		if (target.kind === "node") {
			// Bipartite SET node: no backing file — show the tag label + size.
			if (this.laid.setNodeIds?.has(target.nodeId)) {
				const sn = this.laid.nodes.find((n) => n.id === target.nodeId);
				if (!sn) return;
				tip.createSpan({ cls: "gim-tip-title", text: sn.label });
				tip.createSpan({ cls: "gim-tip-sub", text: "tag" });
				this.root.appendChild(tip);
				this.tipEl = tip;
				this.positionTip(sx, sy, tip);
				return;
			}
			// Euler-nested copies carry a `${tag}\t${origPath}` id — resolve the
			// ORIGINAL path for the file lookup + body cache.
			const sepIdx = target.nodeId.indexOf("\t");
			const baseId =
				sepIdx >= 0 ? target.nodeId.slice(sepIdx + 1) : target.nodeId;
			const file = this.app.vault.getAbstractFileByPath(baseId);
			if (!(file instanceof TFile)) return;
			tip.createSpan({ cls: "gim-tip-title", text: file.basename });
			tip.createSpan({ cls: "gim-tip-sub", text: file.parent?.path ?? "" });
			// Body preview removed — the tip shows the file name + folder only.
			if (gen !== this.hoverGen) return;
		} else {
			const cl = this.laid.clusters.find((c) => c.groupKey === target.group);
			if (!cl) return;
			tip.createSpan({ cls: "gim-tip-title", text: cl.label });
			tip.createSpan({ cls: "gim-tip-sub", text: cl.memberCount + " items" });
		}

		this.root.appendChild(tip);
		this.tipEl = tip;
		this.positionTip(sx, sy, tip);
	}

	private positionTip(sx: number, sy: number, tip: HTMLElement): void {
		const rect = this.canvas.getBoundingClientRect();
		const { x, y } = positionTipFn(
			sx,
			sy,
			tip.offsetWidth || 240,
			tip.offsetHeight || 60,
			rect.width,
			rect.height,
		);
		tip.style.left = x + "px";
		tip.style.top = y + "px";
	}

	private attachInputs(): void {
		const c = this.canvas;
		c.addEventListener("mousedown", (e) => {
			if (e.button !== 0) return;
			const rect = c.getBoundingClientRect();
			const sx = e.clientX - rect.left;
			const sy = e.clientY - rect.top;
			// Footer drag/scroll handlers retired — UpSet matrix is now
			// integrated with the cards in world space, so the normal
			// pan handler below moves both together.
			if (e.shiftKey || this.marquee.isArmed()) {
				this.marquee.begin(sx, sy);
				e.preventDefault();
				return;
			}
			// Empty drag = pan. Nodes/clusters can no longer be dragged.
			this.dragging = true;
			this.lastX = e.clientX;
			this.lastY = e.clientY;
			this.downX = e.clientX;
			this.downY = e.clientY;
			this.pointerMoved = false;
			c.style.cursor = "grabbing";
			this.cancelHover();
		});
		window.addEventListener("mousemove", (e) => {
			if (this.marquee.isActive()) {
				this.marquee.update(e.clientX, e.clientY);
				return;
			}
			if (!this.dragging) return;
			if (
				Math.abs(e.clientX - this.downX) + Math.abs(e.clientY - this.downY) > 4
			)
				this.pointerMoved = true;
			this.panX += e.clientX - this.lastX;
			this.panY += e.clientY - this.lastY;
			this.lastX = e.clientX;
			this.lastY = e.clientY;
			this.requestDraw();
		});
		window.addEventListener("mouseup", (e) => {
			if (this.marquee.isActive()) {
				this.marquee.finish(e.clientX, e.clientY);
				return;
			}
			this.dragging = false;
			c.style.cursor = "grab";
		});
		window.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && this.marquee.isActive()) this.marquee.cancel();
		});
		c.addEventListener("contextmenu", (e) => {
			if (this.marquee.isActive()) {
				e.preventDefault();
				this.marquee.cancel();
			}
		});
		c.addEventListener("click", (e) => {
			if (e.shiftKey || this.marquee.isActive()) return;
			// A drag (pan / scroll) ended here — don't treat it as a click,
			// so scrolling the matrix never jumps to a file.
			if (this.pointerMoved) return;
			const rect = c.getBoundingClientRect();
			const sx = e.clientX - rect.left;
			const sy = e.clientY - rect.top;
			if (this.laid.matrix) {
				const m = this.laid.matrix;
				const g = matrixGeom(m, this.zoom, this.canvas.clientWidth);
				if (sy < g.headerH) {
					// Column header → toggle highlight.
					const col = this.matrixColAt(sx);
					if (col >= 0) {
						this.matrixSelectedCol =
							this.matrixSelectedCol === m.cols[col].key
								? null
								: m.cols[col].key;
						this.requestDraw();
					}
					return;
				}
				const li = this.matrixLineAt(sy);
				if (li < 0) return;
				const line = this.matrixLines[li];
				if (line.kind === "summary") {
					this.matrixExpanded.add(line.blockIdx); // expand
					this.rebuildMatrixDisplay();
					this.requestDraw();
					return;
				}
				const collapseMode =
					this.settings.matrixGroupBySignature &&
					this.settings.matrixCollapseGroups;
				if (
					collapseMode &&
					line.head &&
					m.blocks[line.blockIdx].count > 1 &&
					sx < 8 + MATRIX_BADGE_W
				) {
					this.matrixExpanded.delete(line.blockIdx); // re-collapse
					this.rebuildMatrixDisplay();
					this.requestDraw();
					return;
				}
				this.openFile(m.rows[line.rowIdx].id);
				return;
			}
			if (this.laid.heatmap) {
				// Cell → select + open the detail overlay listing the tag pair's
				// intersection notes (or all notes of the tag on the diagonal).
				const cell = this.heatmapCellAt(sx, sy);
				if (cell) {
					this.heatmapSelected = cell;
					this.requestDraw();
					this.openHeatmapDetail(cell.i, cell.j, sx, sy);
				} else {
					this.heatmapSelected = null;
					this.closeDetail();
					this.requestDraw();
				}
				return;
			}
			if (this.laid.lattice) {
				// World-space click. Order of resolution:
				//   1. Header checkbox (sits ON the card, regardless of pan)
				//      — toggles `latticeNamedKeys` + re-layouts so the body
				//      switches to / from the name list.
				//   2. Tier gutter early-return (opaque sticky-left band).
				//   3. Named row click → open that note directly.
				//   4. Per-individual-cell click → open that note.
				//   5. Anywhere else on the node → list-overlay.
				const wpt = this.screenToWorld(sx, sy);
				const meta = this.laid.lattice;
				const cbHit = latticeNodeAt(meta, wpt.x, wpt.y);
				if (cbHit && latticeHeaderCheckboxHit(cbHit, wpt.x, wpt.y)) {
					if (this.latticeNamedKeys.has(cbHit.key))
						this.latticeNamedKeys.delete(cbHit.key);
					else this.latticeNamedKeys.add(cbHit.key);
					void this.rebuild(); // re-layout: enlarge / shrink this node
					return;
				}
				// Clicks inside the screen-fixed tier-label gutter are ignored
				// (the gutter is opaque; any node "behind" it is not user-
				// reachable from there — pan first to bring it into the open
				// area). Checked AFTER the checkbox so a card whose left edge
				// pokes past the gutter still has a clickable box on screen.
				if (sx < LATTICE_TIER_GUTTER) {
					this.latticeSelectedKey = null;
					this.closeDetail();
					this.requestDraw();
					return;
				}
				const hitNode = cbHit;
				if (!hitNode) {
					this.latticeSelectedKey = null;
					this.closeDetail();
					this.requestDraw();
					return;
				}
				// Named row click → open that note directly. Only applies when
				// the node's body is in name-list mode.
				if (hitNode.named) {
					const rowIdx = latticeNamedRowAt(
						hitNode,
						wpt.x,
						wpt.y,
						this.settings.latticeNamedMax,
					);
					if (rowIdx >= 0) {
						const id = hitNode.nodeIds[rowIdx];
						if (id) {
							this.openFile(id);
							return;
						}
					}
					// Fall through to the list-overlay below for clicks on the
					// header area / "+N" residual row of a named node.
				}
				// Try a per-cell hit first (only meaningful in individual LOD).
				const cellIdx = latticeCellAt(
					hitNode,
					wpt.x,
					wpt.y,
					this.settings.minFontPx,
					this.zoom,
					{
						latticeNodeLOD: this.settings.latticeNodeLOD,
						latticeIndividualMax: this.settings.latticeIndividualMax,
						latticeDensityMax: this.settings.latticeDensityMax,
						latticeDensityCells: this.settings.latticeDensityCells,
					},
				);
				if (cellIdx >= 0) {
					const cellId = hitNode.nodeIds[cellIdx];
					if (cellId) {
						this.openFile(cellId);
						return;
					}
				}
				// Header / aggregate click → list overlay. Use the node label
				// as title; "Other (×M)" buckets fall back to the literal label
				// since their nodeIds are already a flat union.
				this.latticeSelectedKey = hitNode.key;
				this.requestDraw();
				// "Other (×M)" bundle nodes have no concrete signature — the
				// signature array is empty by construction in lattice-layout.
				// Render their title as "その他 (×M)" with the count; concrete
				// intersections show the DISPLAY tag list joined by " ∩ " (same
				// resolution the header uses).
				this.openLatticeDetail(hitNode, sx, sy);
				return;
			}
			if (this.laid.droste) {
				// Conformal inverse-map click. A NODE band → open the file AND
				// re-root the spiral on it (drosteFocus drives layoutDroste, so
				// this is a relayout). Cluster bands have no file to open and
				// re-rooting is node-only, so they're ignored.
				const id = this.drosteHitTest(sx, sy);
				// Synthetic cells (↻ bridge "__loop_*", "+N" overflow "__more_*")
				// have no backing file — ignore them for open / re-root.
				if (id && !id.startsWith("__")) {
					const el = this.laid.droste.slices.flat().find((e) => e.id === id);
					if (el && el.kind === "node") {
						this.openFile(id);
						this.settings.drosteFocus = id;
						void this.save();
						void this.rebuild();
					}
				}
				return;
			}
			const w = this.screenToWorld(sx, sy);
			const hit = this.hitTest(w.x, w.y);
			if (hit?.kind === "node") {
				// Bipartite: SET node → toggle a pinned highlight of its
				// neighbour notes; NOTE node → open the file.
				if (this.laid.setNodeIds?.has(hit.nodeId)) {
					this.pinnedSet = this.pinnedSet === hit.nodeId ? null : hit.nodeId;
					this.applyHighlight(
						this.pinnedSet ? { kind: "node", nodeId: this.pinnedSet } : null,
					);
				} else {
					this.openFile(hit.nodeId);
				}
			} else if (this.pinnedSet) {
				// Click on empty space clears the pinned set selection.
				this.pinnedSet = null;
				this.applyHighlight(null);
			}
		});
		c.addEventListener("mousemove", (e) => this.onPointerMove(e));
		c.addEventListener("mouseleave", () => {
			this.cancelHover();
			// Droste mode tracks hover via hoveredNodeId (no matrix/lattice
			// crosshair state) — clear it so no band stays lit after exit.
			const drosteHovered = this.laid.droste != null && this.hoveredNodeId !== null;
			if (drosteHovered) this.hoveredNodeId = null;
			if (
				drosteHovered ||
				this.matrixHoverLine !== -1 ||
				this.matrixHoverCol !== -1 ||
				this.heatmapHoverRow !== -1 ||
				this.heatmapHoverCol !== -1 ||
				this.latticeHoverKey !== null
			) {
				this.matrixHoverLine = -1;
				this.matrixHoverCol = -1;
				this.heatmapHoverRow = -1;
				this.heatmapHoverCol = -1;
				this.latticeHoverKey = null;
				this.requestDraw();
			}
		});
		c.addEventListener("wheel", (e) => {
			e.preventDefault();
			this.cancelHover();
			// Connection matrix: wheel scrolls the rows vertically (fixed row
			// height); the existing drag-pan also scrolls. No zoom here.
			if (this.laid.matrix) {
				this.panY -= e.deltaY;
				this.requestDraw();
				return;
			}
			const rect = c.getBoundingClientRect();
			const sx = e.clientX - rect.left;
			const sy = e.clientY - rect.top;
			// UpSet footer scroll path retired — the matrix is in world
			// space now, so the normal zoom-on-wheel below applies.
			const factor = Math.exp(-e.deltaY * 0.0015);
			const next = Math.max(0.005, Math.min(8, this.zoom * factor));
			const wx = (sx - this.panX) / this.zoom;
			const wy = (sy - this.panY) / this.zoom;
			this.zoom = next;
			this.panX = sx - wx * next;
			this.panY = sy - wy * next;
			this.requestDraw();
		}, { passive: false });
		c.addEventListener("dblclick", () => this.fitToView());
	}
}

