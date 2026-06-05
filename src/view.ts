import { ItemView, WorkspaceLeaf, TFile, debounce, setIcon, Notice } from "obsidian";
import { buildGraph } from "./parser";
import {
	layout,
	type LaidOut,
	type PositionedNode,
	type SizedNode,
	type ClusterRect,
} from "./layout";
import type { MiniSettings, GraphNode, GraphData, ViewMode } from "./types";
import {
	VIEW_MODES,
	MATRIX_ORDER_CRITERIA,
	HEATMAP_ORDER_CRITERIA,
} from "./types";
import { CARD_CELL_W, CARD_CELL_H } from "./types";
import { type LimitRule, applyLimitRules } from "./limit";
import { filterMemberships, filterLabels } from "./query-filters";
import {
	parseLimitRules as parseLimitRulesFn,
	getSortKey as getSortKeyFn,
	computeDroppedClusters as computeDroppedClustersFn,
} from "./query-pipeline";
import { clusterHue } from "./canvas-utils";
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
import { menuNoteList, menuClickAction, clampRect, noteMenuHeight, buildFolderTree, buildTagTree, advancedSearch, suggestQuery, currentToken, stripTabPrefix, nodeIsHidden, hideKey, collectDescendantNoteKeys, collectDescendantLeaves, folderCheckState, buildFolderPathKey, navigatorNodeSource, type MenuRect, type NoteRef, type TreeNode, type TreeLeaf, type Suggestion } from "./note-menu";

export const VIEW_TYPE_MINI = "tag-lens-view";


// Internal cache: maps file path → pre-processed body preview (post-frontmatter,
// trimmed). Persists across rebuilds so we don't re-read 2k+ files every time
// metadataCache fires "resolved".

// Containment-lens gallery: world px per icon cell (square). Pan/zoom navigates.
const DROSTE_CELL = 240;

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
	// Clickable card rects (device px) recorded by the grid-mode Droste renderer,
	// so grid-mode hit-testing reuses the drawn geometry instead of re-deriving it.
	private drosteHit: { id: string; x0: number; y0: number; x1: number; y1: number }[] = [];
	// Containment lens: the full pre-LIMIT graph, so the lens + focus picker cover the
	// whole vault (not just the LIMIT-trimmed subset).
	private drosteData: GraphData | null = null;
	// Always-on mode-agnostic note navigator (folder tree + search). Built once
	// per rebuild and shown in EVERY view mode. `noteMenu` is the DOM panel,
	// `noteMenuRedraw` re-renders its rows (to refresh the highlighted row).
	private noteMenu: HTMLElement | null = null;
	private noteMenuRedraw: (() => void) | null = null;
	// Mouse-dragged position + size of the note navigator. The menu is recreated
	// fresh on every rebuild (removeNoteMenu → ensureNoteMenu), so the current
	// rect is stashed here and REAPPLIED in ensureNoteMenu() to survive rebuilds.
	// null ⇒ not yet placed → use the default geometry (and seed from settings).
	private noteMenuRect: MenuRect | null = null;
	// Minimized state of the note navigator (header double-click toggles it).
	// Survives REBUILDS via this field and RELOADS via the optional
	// settings.noteMenuMinimized. Seeded from settings on first construction so
	// a reloaded vault re-applies the persisted minimized state. When minimized
	// the search box + tree body are hidden and the panel collapses to header
	// height; `noteMenuRestoreHeight` remembers the body height to restore to.
	private noteMenuMinimized = false;
	// The panel height (px) to restore to when un-minimizing. Captured at the
	// moment of minimizing so a double-click round-trips back to the prior size.
	private noteMenuRestoreHeight: number | null = null;
	// Universal note list for the navigator, captured during rebuild() right
	// after the post-LIMIT `data` is computed. Used as the fallback note source
	// for aggregate modes (heatmap/matrix/lattice/upset) where `laid.nodes` is
	// empty. {id (file path), label (basename)}.
	private menuNotes: {
		id: string;
		label: string;
		memberships: string[];
		path: string;
		tags: string[];
		frontmatter: Record<string, string[]>;
	}[] = [];
	// Navigator tree grouping: "folder" (by note path, default) or "tag" (by the
	// note's GROUP_BY membership keys). Survives REBUILDS via this field and
	// RELOADS via the optional settings.noteMenuGroupBy. A small radio group in
	// the menu header switches it; changing it re-renders the tree.
	private noteMenuGroupBy: "folder" | "tag" = "folder";
	// The last search query the user typed in the note navigator's search box.
	// Saved in removeNoteMenu() and restored in ensureNoteMenu() so a rebuild
	// triggered mid-typing (e.g. by a vault file change) doesn't blank the box.
	private noteMenuSearchQuery = "";
	// Set of folder/group path keys that the user has EXPANDED in the tree.
	// Captured in removeNoteMenu() (by reading live DOM data-path attributes)
	// and reapplied in ensureNoteMenu() after the tree is built, so expanded
	// folders survive every menu rebuild (including the one triggered by a
	// checkbox toggle). Keys are the stable path strings used as Map keys in
	// the tree (folder names joined by "/", e.g. "Area", "Area/Sub").
	// NOTE: each folder's children are built LAZILY on first expand. The
	// restore pass calls the same synthetic open/close logic that a real
	// click would to ensure lazy children are built before marking open.
	private noteMenuExpandedPaths: Set<string> = new Set();
	// The scroll offset of the tree body element at the time of the last
	// removeNoteMenu() call. Restored after rebuilding the tree in
	// ensureNoteMenu() so the viewport stays put after a checkbox toggle.
	private noteMenuScrollTop = 0;
	// If the note navigator throws while building (e.g. a mobile-webview API
	// quirk), we capture the error here so the FIGURE still renders (the menu is
	// non-essential) and a small banner surfaces the cause on-canvas. Logged once.
	private noteMenuError: string | null = null;
	private noteMenuErrorLogged = false;
	// Which top-level tab the unified menu shows: the note navigator ("notes") or
	// the graph settings ("settings"). In-memory only — opening via the toolbar
	// gear always resets to "notes"; a manual switch survives graph rebuilds.
	private activeMenuTab: "notes" | "settings" | "insight" = "notes";
	// Sensitivity coefficient K for the Insight tab's cognitive-load thresholds
	// (1.0–5.0). In-memory; survives rebuilds, adjustable via the tab's slider.
	private clInsightK = 2.0;
	// Only show the global Notice once per Obsidian session to prevent spam.
	private hasShownCognitiveAlert = false;
	// The live container the settings tab renders into (replaces the old docking
	// panel's `panelEl` as the host that `applyTabFilter`/`renderTabButton` query).
	private settingsHostEl: HTMLElement | null = null;
	// The last note "located" on canvas via the navigator (non-droste modes),
	// used to highlight its row in the menu.
	private locatedNoteId: string | null = null;
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
	// The selected LAYER (cluster groupKey) in the Settings → Layers sub-tab.
	// Repurposed from the old "__all__"/groupKey chip selector; "__all__" now
	// just means "no specific layer yet" and is replaced by the first cluster.
	private activeTab: string = "__all__";
	// Which Settings sub-tab is shown: View / Filter / Sort / Display / Layers.
	// In-memory, preserved across graph rebuilds. Default View.
	private settingsSubTab: "view" | "filter" | "sort" | "display" | "layers" = "view";
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
		// Seed the minimized state from the persisted (optional) setting so a
		// reloaded vault re-applies it. Absent ⇒ restored (false).
		this.noteMenuMinimized = settings.noteMenuMinimized === true;
		// Seed the tree grouping from the persisted (optional) setting. Absent or
		// any non-"tag" value ⇒ default "folder".
		this.noteMenuGroupBy = settings.noteMenuGroupBy === "tag" ? "tag" : "folder";
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
		root.setCssStyles({ padding: "0" });
		root.setCssStyles({ overflow: "hidden" });
		root.setCssStyles({ position: "relative" });
		this.root = root;

		this.canvas = root.createEl("canvas");
		this.canvas.setCssStyles({ width: "100%" });
		this.canvas.setCssStyles({ height: "100%" });
		this.canvas.setCssStyles({ display: "block" });
		this.canvas.setCssStyles({ cursor: "grab" });
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

		// The toolbar gear now opens/closes the UNIFIED menu (note navigator +
		// graph settings as tabs). Graph settings is the "Settings" tab inside it.
		this.addAction("sliders-horizontal", "Toggle Tag Lens menu", () => this.toggleNoteMenu());

		void this.rebuild();
		this.resize();
	}

	// Open/close the unified menu. Opening always lands on the Notes tab; the
	// menu itself is (re)built by ensureNoteMenu() on the next draw pass.
	private toggleNoteMenu(): void {
		this.settings.noteMenuVisible = !this.settings.noteMenuVisible;
		void this.save();
		if (this.settings.noteMenuVisible) {
			this.activeMenuTab = "notes";
			this.requestDraw();
		} else {
			this.removeNoteMenu();
		}
	}

	// Toggle pin-to-right (dock) ⇄ floating. Rebuild the menu so its geometry +
	// drag/resize wiring switch, and requestDraw so the canvas re-reserves width.
	private togglePin(): void {
		this.settings.noteMenuPinned = !this.settings.noteMenuPinned;
		void this.save();
		this.removeNoteMenu();
		this.requestDraw();
	}

	// Canvas width reserved on the right for the docked (pinned) menu — 0 when
	// floating or hidden, so the floating menu just overlays. Clamped to the
	// container so a huge persisted width can't hide the whole figure.
	private pinnedMenuWidth(): number {
		if (!this.settings.noteMenuPinned || !this.settings.noteMenuVisible) return 0;
		const cw = this.canvas.clientWidth || this.root.clientWidth || 0;
		if (cw <= 0) return 0;
		const w = this.settings.noteMenuPinnedWidth ?? 320;
		return Math.min(Math.max(180, w), Math.max(180, Math.floor(cw * 0.8)));
	}

	async onClose(): Promise<void> {
		this.resizeObs?.disconnect();
		cancelAnimationFrame(this.rafId);
		this.cancelHover();
		this.removeNoteMenu();
	}

	// Render the graph-settings UI (layer chips + the active layer/all content)
	// into `host`. This is the body of the unified menu's "Settings" tab — it
	// reuses every existing render*Section helper unchanged; only the host moved
	// from the old right-docking `.gim-panel` to the menu. `host` is recorded so
	// `applyTabFilter`/`renderTabButton` can query the live chips.
	private renderSettingsBody(host: HTMLElement): void {
		this.settingsHostEl = host;
		host.empty();

		// Sub-tab bar: View / Filter / Sort / Display / Layers. Underline style,
		// matching the top-level Notes/Settings tabs but more compact.
		const subBar = host.createDiv();
		subBar.setCssStyles({ display: "flex", flexWrap: "wrap", gap: "1px", marginBottom: "6px", borderBottom: "1px solid #2a3447" });
		const content = host.createDiv({ cls: "gim-panel-content" });
		type SubKey = "view" | "filter" | "sort" | "display" | "layers";
		const SUBS: { key: SubKey; label: string }[] = [
			{ key: "view", label: "View" },
			{ key: "filter", label: "Filter" },
			{ key: "sort", label: "Sort" },
			{ key: "display", label: "Display" },
			{ key: "layers", label: "Layers" },
		];
		const subBtns = new Map<string, HTMLElement>();
		const styleSubs = (): void => {
			for (const { key } of SUBS) {
				const b = subBtns.get(key);
				if (!b) continue;
				const on = this.settingsSubTab === key;
				b.setCssStyles({
					background: "transparent", border: "none",
					borderBottom: on ? "2px solid #2d6cdf" : "2px solid transparent",
					borderRadius: "0", padding: "4px 8px", marginBottom: "-1px",
					color: on ? "#e6edf3" : "#9db4d6", fontWeight: on ? "600" : "400",
					cursor: "pointer", fontSize: "10.5px", lineHeight: "1.3",
				});
			}
		};
		const renderSub = (): void => {
			content.empty();
			switch (this.settingsSubTab) {
				case "view": this.renderSettingsView(content); break;
				case "filter": this.renderSettingsFilter(content); break;
				case "sort": this.renderSettingsSort(content); break;
				case "display": this.renderSettingsDisplay(content); break;
				case "layers": this.renderSettingsLayers(content); break;
			}
		};
		for (const { key, label } of SUBS) {
			const b = subBar.createEl("button", { text: label });
			subBtns.set(key, b);
			b.addEventListener("click", () => { this.settingsSubTab = key; styleSubs(); renderSub(); });
			b.addEventListener("mouseenter", () => { if (this.settingsSubTab !== key) { b.setCssStyles({ color: "#cdd9ec" }); b.setCssStyles({ borderBottomColor: "#3a4760" }); } });
			b.addEventListener("mouseleave", () => styleSubs());
		}
		styleSubs();
		renderSub();
	}

	// ── Settings sub-tabs (split out of the old single renderAllTab scroll) ──────
	private renderSettingsView(el: HTMLElement): void {
		this.renderViewModeSection(el);
		if (this.settings.viewMode === "bipartite") this.renderBipartiteSection(el);
		if (this.settings.viewMode === "lattice") this.renderLatticeSection(el);
	}

	private renderSettingsFilter(el: HTMLElement): void {
		const isMatrix = this.settings.viewMode === "matrix";
		const isHeatmap = this.settings.viewMode === "heatmap";
		this.renderExprSection(el, "WHERE", this.settings.where, this.whereError, { autoKey: "whereAuto" });
		this.renderExprSection(el, "GROUP_BY", this.settings.groupBy, this.groupByError, { autoKey: "groupByAuto" });
		const havingSection = this.renderExprSection(el, "HAVING", this.settings.having, this.havingError, {
			placeholder: "e.g. count >= 3", autoKey: "havingAuto",
		});
		// Matrix "min column size" / heatmap "min tag size" are tag filters.
		if (isMatrix) this.renderMatrixMinColumnControl(havingSection);
		if (isHeatmap) this.renderHeatmapMinTagControl(havingSection);
	}

	private renderSettingsSort(el: HTMLElement): void {
		this.renderOrderBySection(el);
		this.renderExprSection(el, "LIMIT", this.settings.limit, this.limitError, {
			placeholder: "limit 10 / brief 30", autoKey: "limitAuto",
		});
	}

	private renderSettingsDisplay(el: HTMLElement): void {
		const isMatrix = this.settings.viewMode === "matrix";
		const isHeatmap = this.settings.viewMode === "heatmap";
		const isLattice = this.settings.viewMode === "lattice";
		// Matrix dots / heatmap cells / lattice nodes size by intrinsic metrics,
		// so NODE DISPLAY (size by / m×n) is hidden for those modes.
		if (!isMatrix && !isHeatmap && !isLattice) this.renderNodeDisplaySection(el);
		this.renderMinFontSection(el);
		const gdSection = this.renderToggleSection(el, "Graph display", [
			{ key: "showNodes", label: "Show nodes" },
			{ key: "showEnclosures", label: "Show enclosures" },
			{ key: "showEdges", label: "Show edges" },
			{ key: "showGrid", label: "Show grid" },
		]);
		if (isMatrix) this.renderMatrixDisplayToggles(gdSection);
		if (isHeatmap) this.renderHeatmapDisplayToggles(gdSection);
	}

	// Layers sub-tab: a cluster picker (chips) + the selected cluster's
	// per-layer settings (aggregate / inherit / node-display override).
	private renderSettingsLayers(el: HTMLElement): void {
		const clusters = this.laid.clusters;
		if (clusters.length === 0) {
			const hint = el.createDiv({ cls: "gim-panel-hint" });
			hint.setText("No layers in the current graph (set GROUP_BY to create clusters).");
			return;
		}
		// Keep the selected layer valid; default to the first cluster.
		const validKeys = new Set(clusters.map((c) => c.groupKey));
		if (!validKeys.has(this.activeTab)) this.activeTab = clusters[0].groupKey;

		const tabBar = el.createDiv({ cls: "gim-panel-tabs" });
		if (clusters.length > 1) {
			const filterInput = tabBar.createEl("input", { cls: "gim-panel-tab-filter", type: "search" });
			filterInput.setAttribute("placeholder", "Filter layers… (type to search)");
			filterInput.value = this.tabFilter;
			filterInput.addEventListener("input", () => { this.tabFilter = filterInput.value; this.applyTabFilter(); });
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
		for (const c of clusters) {
			this.renderTabButton(chipsEl, c.groupKey, `${c.label} (${c.memberCount})`, clusterHue(c.groupKey), c.label);
		}
		this.applyTabFilter();

		const content = el.createDiv({ cls: "gim-panel-content" });
		this.renderLayerTab(content, this.activeTab);
	}

	// Re-render the settings tab in place after a settings change. No-op unless
	// the unified menu is open AND currently showing the Settings tab (so a
	// change made elsewhere doesn't force a tab switch). Replaces the old
	// `renderPanel()` self-refresh of the docking panel.
	private refreshSettingsTab(): void {
		if (this.noteMenu && this.activeMenuTab === "settings" && this.settingsHostEl) {
			this.renderSettingsBody(this.settingsHostEl);
		}
	}

	// ── Insight tab: cognitive-load model over the REAL vault ────────────────────
	// Each of 5 condition TYPES adds 20 points (max 100) when ANY entity in the
	// vault meets its threshold (formulas + alert text per spec; K scales them).
	// `coOccurringTags` (the spec's per-note tag variance) is mapped to the vault's
	// DISTINCT tag count. Offenders are listed so the alert is actionable.
	private computeCognitiveLoad(k: number): {
		score: number;
		globalStats: { totalNotes: number; totalFolders: number; totalLinks: number; distinctTags: number };
		triggered: { id: string; label: string; severity: "CRITICAL" | "WARNING"; summary: string; detail: string; advice: string; offenders: string[] }[];
	} {
		const files = this.app.vault.getMarkdownFiles();
		const totalNotes = files.length;
		// Folders that directly contain ≥1 markdown file → file count per folder.
		const folderCounts = new Map<string, number>();
		for (const f of files) {
			const dir = f.parent ? f.parent.path : "/";
			folderCounts.set(dir, (folderCounts.get(dir) ?? 0) + 1);
		}
		const totalFolders = Math.max(1, folderCounts.size);
		// Links: resolvedLinks = { src: { tgt: count } }. Total + per-note in/out.
		const resolved = this.app.metadataCache.resolvedLinks;
		let totalLinks = 0;
		const outCount = new Map<string, number>();
		const inCount = new Map<string, number>();
		for (const src of Object.keys(resolved)) {
			const targets = resolved[src];
			let o = 0;
			for (const tgt of Object.keys(targets)) {
				const c = targets[tgt];
				totalLinks += c;
				o += c;
				inCount.set(tgt, (inCount.get(tgt) ?? 0) + c);
			}
			outCount.set(src, o);
		}
		// Tags per note + per-tag note counts + distinct tags.
		const stripHash = (t: string): string => (t.startsWith("#") ? t.slice(1) : t);
		const tagNoteCount = new Map<string, number>();
		const noteTagCount = new Map<string, number>();
		for (const f of files) {
			const cache = this.app.metadataCache.getFileCache(f);
			const tags = new Set<string>();
			if (cache?.tags) for (const t of cache.tags) tags.add(stripHash(t.tag));
			const fmTags = (cache?.frontmatter as Record<string, unknown> | undefined)?.tags;
			if (Array.isArray(fmTags)) for (const t of fmTags) tags.add(stripHash(String(t)));
			else if (typeof fmTags === "string") tags.add(stripHash(fmTags));
			noteTagCount.set(f.path, tags.size);
			for (const t of tags) tagNoteCount.set(t, (tagNoteCount.get(t) ?? 0) + 1);
		}
		const distinctTags = Math.max(1, tagNoteCount.size);

		const triggered: { id: string; label: string; severity: "CRITICAL" | "WARNING"; summary: string; detail: string; advice: string; offenders: string[] }[] = [];
		if (totalNotes === 0) return { score: 0, globalStats: { totalNotes, totalFolders, totalLinks, distinctTags }, triggered };
		const linkDensity = totalLinks / totalNotes;
		const basename = (p: string): string => { const s = p.split("/").pop() ?? p; return s.endsWith(".md") ? s.slice(0, -3) : s; };
		const topN = <T>(arr: T[], score: (x: T) => number, label: (x: T) => string): string[] => {
			return [...arr].sort((a, b) => score(b) - score(a)).map(label);
		};

		// [Architectural Imbalance] folder files > (notes/folders)*K
		{
			const thr = (totalNotes / totalFolders) * k;
			const hits = [...folderCounts.entries()].filter(([, c]) => c > thr);
			if (hits.length > 0) triggered.push({
				id: "architecturalImbalance", label: "Architectural Imbalance", severity: "CRITICAL",
				summary: "Overcrowded folder",
				detail: "This folder holds a disproportionate number of files compared to the vault average.",
				advice: "Refactor by creating logical sub-folders.",
				offenders: topN(hits, ([, c]) => c, ([p, c]) => `${p === "/" ? "(root)" : p} (${c} files)`),
			});
		}
		// [Contextual Ambiguity] notes per tag > (notes/10)*K
		{
			const thr = (totalNotes / 10) * k;
			const hits = [...tagNoteCount.entries()].filter(([, c]) => c > thr);
			if (hits.length > 0) triggered.push({
				id: "contextualAmbiguity", label: "Contextual Ambiguity", severity: "WARNING",
				summary: "Tag is too broad",
				detail: "This tag is applied to an excessive percentage of your total notes (Tag Abstractness).",
				advice: "Delete the tag or split it into more specific sub-tags.",
				offenders: topN(hits, ([, c]) => c, ([t, c]) => `#${t} (${c} notes)`),
			});
		}
		// [Network Hub] link/backlink > (links/notes)*K^2
		{
			const thr = linkDensity * Math.pow(k, 2);
			const hits = files
				.map((f) => ({ f, lc: (outCount.get(f.path) ?? 0) + (inCount.get(f.path) ?? 0) }))
				.filter((x) => x.lc > thr);
			if (hits.length > 0) triggered.push({
				id: "networkHub", label: "Network Hub", severity: "CRITICAL",
				summary: "Excessive links",
				detail: "The link density of this note vastly exceeds the vault average.",
				advice: "Isolate this hub note or visualize it using a subset graph.",
				offenders: topN(hits, (x) => x.lc, (x) => `${basename(x.f.path)} (${x.lc} links)`),
			});
		}
		// [Monolith Note] size > 15*K AND link/backlink < (links/notes)/K
		{
			const hits = files
				.map((f) => ({ f, kb: f.stat.size / 1024, lc: (outCount.get(f.path) ?? 0) + (inCount.get(f.path) ?? 0) }))
				.filter((x) => x.kb > 15 * k && x.lc < linkDensity / k);
			if (hits.length > 0) triggered.push({
				id: "monolithNote", label: "Monolith Note", severity: "WARNING",
				summary: "Monolithic note",
				detail: "This note is a monolith. It has a large file size but very few links.",
				advice: "Break down the content into smaller, linked atomic notes.",
				offenders: topN(hits, (x) => x.kb, (x) => `${basename(x.f.path)} (${Math.round(x.kb)} KB, ${x.lc} links)`),
			});
		}
		// [Interface Bloat] tags in note > (distinctTags / K)
		{
			const thr = distinctTags / k;
			const hits = files
				.map((f) => ({ f, tc: noteTagCount.get(f.path) ?? 0 }))
				.filter((x) => x.tc > thr);
			if (hits.length > 0) triggered.push({
				id: "interfaceBloat", label: "Interface Bloat", severity: "WARNING",
				summary: "Too many tags",
				detail: "Note contains excessive tags relative to co-occurring tag variance.",
				advice: "Group related tags or use a hierarchical structure.",
				offenders: topN(hits, (x) => x.tc, (x) => `${basename(x.f.path)} (${x.tc} tags)`),
			});
		}

		return { score: Math.min(100, triggered.length * 20), globalStats: { totalNotes, totalFolders, totalLinks, distinctTags }, triggered };
	}

	// Render the Insight tab: score gauge + K slider + active alerts (live, from
	// the real vault). No history — recomputed every render, so it always reflects
	// the current vault + K.
	private renderInsightBody(host: HTMLElement): void {
		host.empty();
		const k = this.clInsightK;
		let computed: ReturnType<MiniGraphView["computeCognitiveLoad"]>;
		try {
			computed = this.computeCognitiveLoad(k);
		} catch (e) {
			host.createDiv({ text: `Could not compute cognitive load: ${e instanceof Error ? e.message : String(e)}` })
				.setAttr("style", "font-size:11px;color:#f87171;padding:8px");
			return;
		}
		const { score, globalStats, triggered } = computed;
		const band = score < 40 ? { c: "#34d399", b: "#10b981", t: "Low" }
			: score < 80 ? { c: "#fbbf24", b: "#f59e0b", t: "Moderate" }
				: { c: "#f87171", b: "#ef4444", t: "High / Critical" };

		// ── Score gauge ──
		const gauge = host.createDiv();
		gauge.setCssStyles({ border: "1px solid #3a4760", borderRadius: "8px", background: "#161c2a", padding: "10px", marginBottom: "8px" });
		const gTop = gauge.createDiv();
		gTop.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "6px" });
		const gLeft = gTop.createDiv();
		gLeft.createDiv({ text: "Total Cognitive Load Score" }).setAttr("style", "font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#7e8aa0");
		const sc = gLeft.createDiv({ text: `${score} ` });
		sc.setCssStyles({ fontSize: "22px", fontWeight: "700", color: band.c });
		sc.createSpan({ text: "/ 100" }).setAttr("style", "font-size:11px;font-weight:400;color:#5b6678");
		gTop.createDiv({ text: band.t }).setAttr("style", `font-size:12px;font-weight:600;color:${band.c}`);
		const track = gauge.createDiv();
		track.setCssStyles({ height: "8px", width: "100%", borderRadius: "999px", background: "#2a3447", overflow: "hidden" });
		const fill = track.createDiv();
		fill.setCssStyles({ height: "100%", width: `${score}%`, background: band.b, borderRadius: "999px", transition: "width .15s" });
		gauge.createDiv({ text: `Vault: ${globalStats.totalNotes} notes · ${globalStats.totalFolders} folders · ${globalStats.totalLinks} links · ${globalStats.distinctTags} tags` })
			.setAttr("style", "font-size:9px;color:#5b6678;margin-top:6px;font-family:monospace");

		// ── K sensitivity slider + refresh ──
		const ctrl = host.createDiv();
		ctrl.setCssStyles({ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", fontSize: "11px", color: "#9db4d6" });
		ctrl.createSpan({ text: "Sensitivity (K)" });
		const kIn = ctrl.createEl("input", { attr: { type: "range", min: "1", max: "5", step: "0.1", value: String(k) } });
		kIn.setCssStyles({ flex: "1 1 auto", accentColor: "#2d6cdf", cursor: "pointer" });
		const kVal = ctrl.createSpan({ text: k.toFixed(1) });
		kVal.setCssStyles({ fontFamily: "monospace", color: "#7fb4ff", width: "26px", textAlign: "right" });
		// Update K + label live while dragging (cheap), but only RE-SCAN the vault
		// on release (`change`) so a large vault doesn't recompute per pixel.
		kIn.addEventListener("input", () => { this.clInsightK = Number(kIn.value); kVal.setText(this.clInsightK.toFixed(1)); });
		kIn.addEventListener("change", () => this.renderInsightBody(host));
		const refresh = ctrl.createEl("button", { text: "Refresh" });
		refresh.setCssStyles({ fontSize: "10px", padding: "2px 8px", background: "#1a2236", border: "1px solid #3a4760", borderRadius: "4px", color: "#9db4d6", cursor: "pointer" });
		refresh.addEventListener("click", () => this.renderInsightBody(host));

		// ── Alerts (active only) ──
		if (triggered.length === 0) {
			const ok = host.createDiv();
			ok.setCssStyles({ display: "flex", gap: "8px", alignItems: "flex-start", border: "1px solid #1f6b4f", background: "rgba(16,185,129,0.12)", borderRadius: "6px", padding: "10px" });
			ok.createSpan().setAttr("style", "width:10px;height:10px;border-radius:2px;background:#34d399;flex:0 0 auto;margin-top:2px;display:inline-block");
			ok.createSpan({ text: "[OK] System status: Normal. Cognitive load is optimal." }).setAttr("style", "font-size:12px;line-height:1.5;color:#a7f3d0");
			return;
		}

		interface AlertItem { label: string; severity: "CRITICAL" | "WARNING"; summary: string; detail: string; advice: string; offender: string; }
		const allCards: AlertItem[] = [];
		for (const cond of triggered) {
			for (const o of cond.offenders) {
				allCards.push({ label: cond.label, severity: cond.severity, summary: cond.summary, detail: cond.detail, advice: cond.advice, offender: o });
			}
		}

		const listContainer = host.createDiv();
		const BATCH_SIZE = 20;
		let loadedCount = 0;

		const renderBatch = () => {
			const batch = allCards.slice(loadedCount, loadedCount + BATCH_SIZE);
			for (const item of batch) {
				const critical = item.severity === "CRITICAL";
				const card = listContainer.createDiv();
				card.setCssStyles({
					display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "8px", borderRadius: "6px", padding: "10px",
					border: `1px solid ${critical ? "#7f2a2a" : "#7a5a1f"}`, background: critical ? "rgba(239,68,68,0.10)" : "rgba(245,158,11,0.10)",
				});
				card.createSpan().setAttr("style", `width:10px;height:10px;border-radius:2px;flex:0 0 auto;margin-top:3px;display:inline-block;background:${critical ? "#ef4444" : "#fbbf24"}`);
				const body = card.createDiv();
				body.setCssStyles({ flex: "1 1 auto" });

				const titleRow = body.createDiv();
				titleRow.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" });
				titleRow.createDiv({ text: item.label }).setAttr("style", `font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${critical ? "#fca5a5" : "#fcd34d"}`);
				const btnGroup = titleRow.createDiv();
				btnGroup.setCssStyles({ display: "flex", gap: "8px", alignItems: "center" });

				const dismissBtn = btnGroup.createEl("button", { cls: "clickable-icon", title: "Dismiss" });
				setIcon(dismissBtn, "x");
				dismissBtn.setCssStyles({ background: "none", border: "none", padding: "0", cursor: "pointer", color: critical ? "#fca5a5" : "#fcd34d", display: "flex", alignItems: "center" });

				dismissBtn.addEventListener("click", () => {
					card.remove();
				});

				const summaryDiv = body.createDiv({ text: item.summary });
				summaryDiv.setCssStyles({ 
					fontSize: "12px", 
					lineHeight: "1.5", 
					color: critical ? "#fecaca" : "#fde68a",
					cursor: "pointer",
					textDecoration: "underline dashed",
					textUnderlineOffset: "2px"
				});
				
				const offenderDiv = body.createDiv({ text: `• Target: ${item.offender}` });
				offenderDiv.setCssStyles({ marginTop: "5px", fontSize: "10px", color: "#9db4d6", fontFamily: "monospace", lineHeight: "1.5" });

				const detailsDiv = body.createDiv();
				detailsDiv.setCssStyles({ display: "none", marginTop: "8px", padding: "6px", background: "rgba(0,0,0,0.15)", borderRadius: "4px" });
				
				const detailText = detailsDiv.createDiv({ text: item.detail });
				detailText.setCssStyles({ fontSize: "11px", color: critical ? "#fca5a5" : "#fcd34d", marginBottom: "4px" });
				
				const adviceText = detailsDiv.createDiv();
				adviceText.setCssStyles({ fontSize: "11px", color: critical ? "#fca5a5" : "#fcd34d" });
				adviceText.createSpan({ text: "Recommendation: " }).setAttr("style", "font-weight:bold");
				adviceText.createSpan({ text: item.advice });

				summaryDiv.addEventListener("click", () => {
					detailsDiv.setCssStyles({ display: detailsDiv.style.display === "none" ? "block" : "none" });
				});
			}
			loadedCount += batch.length;
			if (loadedCount >= allCards.length && sentinel) {
				sentinel.setCssStyles({ display: "none" });
			}
		};

		const sentinel = host.createDiv();
		sentinel.setCssStyles({ height: "20px", width: "100%" });

		const observer = new IntersectionObserver((entries) => {
			if (entries[0].isIntersecting && loadedCount < allCards.length) {
				renderBatch();
			}
		}, { root: host, rootMargin: "100px" });
		observer.observe(sentinel);

		// Initial render
		renderBatch();
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
			sw.setCssStyles({ background: `hsl(${hue}, 70%, 62%)` });
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
			this.refreshSettingsTab();
		});
	}

	// Hide / show chip buttons via CSS display so the focused filter input
	// stays focused. Substring match (case-insensitive) against the cluster
	// label. The 全体 tab carries data-always-visible=1 and is never hidden.
	// Also reveals the currently-active tab even if it doesn't match the
	// filter, so the user can always see "where they are".
	private applyTabFilter(): void {
		if (!this.settingsHostEl) return;
		const q = this.tabFilter.trim().toLowerCase();
		const chips = this.settingsHostEl.querySelectorAll<HTMLElement>(".gim-panel-tab");
		chips.forEach((btn) => {
			if (btn.dataset.alwaysVisible === "1" || btn.classList.contains("active")) {
				btn.setCssStyles({ display: "" });
				return;
			}
			const text = btn.dataset.filterText ?? "";
			btn.setCssStyles({ display: q === "" || text.includes(q) ? "" : "none" });
		});
	}

	private renderMinFontSection(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: "gim-panel-section" });
		section.createEl("h4", { text: "Min font size (px)" });
		const wrap = section.createDiv({ cls: "gim-min-font-row" });
		const input = wrap.createEl("input", {
			type: "number",
			attr: { min: "0", max: "48", step: "1" },
		});
		input.value = String(this.settings.minFontPx);
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
		swatch.setCssStyles({ background: `hsl(${hue}, 70%, 62%)` });
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
		const inhSel = inhRow.createEl("select", { cls: "gim-order-dir" });
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
			this.refreshSettingsTab();
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
			this.refreshSettingsTab();
			this.requestDraw();
		});

		const list = cardsSec.createDiv({ cls: "gim-layer-cards" });
		for (const n of layerNodes) {
			const row = list.createEl("label", { cls: "gim-toggle-row" });
			const cb = row.createEl("input", { type: "checkbox" });
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
		const cb = row.createEl("input", { type: "checkbox" });
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
		const sel = modeRow.createEl("select", { cls: "gim-order-dir" });
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
		const inp = row.createEl("input", { type: "number" });
		inp.min = "1";
		inp.setCssStyles({ width: "56px" });
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
		const inp = row.createEl("input", { type: "number" });
		inp.min = "1";
		inp.setCssStyles({ width: "56px" });
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
		});
		minIn.value = String(this.settings.latticeMinNodeSize);
		minIn.setCssStyles({ width: "60px" });
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
		});
		capIn.value = String(this.settings.latticeMaxNodesPerTier);
		capIn.setCssStyles({ width: "60px" });
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
		});
		namedIn.value = String(this.settings.latticeNamedMax);
		namedIn.setCssStyles({ width: "60px" });
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
		});
		input.value = opt.id;
		input.checked = this.settings.viewMode === opt.id;
		input.addEventListener("change", () => {
			if (!input.checked) return;
			const next = input.value as ViewMode;
			if (this.settings.viewMode === next) return;
			this.settings.viewMode = next;
			void this.save();
			void this.rebuild();
			this.refreshSettingsTab();
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

		// (The note-navigator show/hide control was removed: the toolbar gear and
		// the menu's × button now open/close the unified menu directly.)

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
		header.setCssStyles({
			cursor: "pointer",
			userSelect: "none",
			margin: "8px 0 4px",
			fontSize: "12px",
			color: "#9eb0c4",
		});
		const caret = header.createSpan({ text: expSelected ? "▾ " : "▸ " });
		header.createSpan({ text: "Experimental (beta)" });

		const expGroup = section.createDiv({ cls: "gim-viewmode-options" });
		expGroup.setCssStyles({ display: expSelected ? "" : "none" });
		for (const opt of experimental) this.renderViewModeOption(expGroup, opt);

		header.addEventListener("click", () => {
			const open = expGroup.style.display === "none";
			expGroup.setCssStyles({ display: open ? "" : "none" });
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
		const laySel = layRow.createEl("select");
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
		const inp = row.createEl("input", { type: "number" });
		inp.min = "1";
		inp.setCssStyles({ width: "56px" });
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
			if (!enabled) row.setCssStyles({ opacity: "0.45" });
			const cb = row.createEl("input", { type: "checkbox" });
			cb.checked = get();
			cb.disabled = !enabled;
			cb.addEventListener("change", () => {
				set(cb.checked);
				void this.save();
				this.refreshSettingsTab(); // refresh Collapse enabled state
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
				rerender: () => this.refreshSettingsTab(),
				// WHERE / GROUP_BY / HAVING / LIMIT are pipeline settings — any
				// expression change must trigger a full rebuild so the graph,
				// note menu, and mode-specific layout all reflect the new query.
				rebuild: () => void this.rebuild(),
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
	// Signature of the last completed rebuild's INPUTS (graph topology +
	// cluster labels + view-affecting settings). Lets rebuild() skip the
	// expensive relayout/redraw when nothing relevant changed — e.g. editing a
	// note's body text that touches no tags/memberships. "" = no build yet.
	private lastRebuildSig = "";

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

		// ── Early-out: skip the (expensive) relayout/redraw/menu-rebuild when the
		// graph INPUTS are byte-for-byte identical to the last build. buildGraph
		// (cheap, reads metadata) still ran, but its result is unchanged — typical
		// for editing a note's BODY that touches no tags/memberships. Settings
		// changes are caught via layoutSignature; create/delete/rename and real
		// tag edits change the graph signature and fall through to a full rebuild.
		// (The navigator's frontmatter SEARCH metadata can lag a frontmatter-only
		// edit until the next graph-affecting change — acceptable for the win.)
		const rebuildSig = JSON.stringify({
			n: result.data.nodes.map((n) => [n.id, n.label, n.memberships ?? []]),
			e: result.data.edges.map((e) => [e.source, e.target]),
			c: [...clusterLabels.entries()],
			s: this.layoutSignature(this.settings),
		});
		if (rebuildSig === this.lastRebuildSig) return;
		this.lastRebuildSig = rebuildSig;

		// Alert the user globally (once per session) if the cognitive load is critical.
		if (!this.hasShownCognitiveAlert) {
			try {
				const cl = this.computeCognitiveLoad(this.clInsightK);
				if (cl.score >= 80) { // High / Critical
					new Notice("⚠️ Cognitive Load is CRITICAL. Please check the Insight tab in Tag Lens for advice.", 8000);
					this.hasShownCognitiveAlert = true;
				}
			} catch {
				// Ignore metric errors so the rebuild doesn't fail
			}
		}

		// Pristine post-buildGraph graph (post WHERE/GROUP_BY, pre any HAVING/LIMIT
		// mutation). The navigator's mode-invariant (non-droste) note set is derived
		// from THIS via menuLimitedNodes() below, so switching between non-droste
		// modes never changes the menu. `data` itself is mutated by the mode-specific
		// HAVING/LIMIT stages, so we snapshot before that happens.
		const menuSourceData = result.data;

		// Stage 1b: HAVING runs AFTER buildGraph so auto thresholds can scale
		// with the produced node count, then drops the resulting clusters
		// from each node's memberships + the cluster-label map.
		// Lattice AND Containment-lens (droste) both derive their value from each
		// note's FULL multi-tag membership: the lattice from DEEP intersections
		// (3-way, 4-way, …), and the lens from T (= N's tag intersection), its
		// exact-T peers (②) and its proper-subset groups (④). Auto-HAVING's
		// TOP_K=20 long-tail drop strips rare tags from every note's memberships,
		// collapsing a {act,drama,character} note to its dominant {character} —
		// which flattens both views (T becomes a single tag, ④ subsets vanish).
		// Skip AUTO for both; manual HAVING expressions still run. Other modes
		// keep AUTO unchanged.
		const effHavingAuto =
			this.settings.viewMode === "lattice" ||
			this.settings.viewMode === "droste"
				? false
				: this.settings.havingAuto;
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

		// Containment lens operates vault-wide: snapshot the post-HAVING graph BEFORE the
		// LIMIT stage trims it, so the icon gallery covers all notes, not the limited set.
		// Hiding is NOT applied here: the gallery always bakes the full pre-LIMIT note set
		// and drawDroste skips hidden cells at draw time (its hiddenSet is the single source
		// of truth for hiding). This lets Select all / Deselect all and per-note toggles
		// show/hide tiles instantly via requestDraw, with no rebuild required.
		const drosteFullData =
			this.settings.viewMode === "droste"
				? { nodes: data.nodes.slice(), edges: data.edges.slice() }
				: undefined;
		this.drosteData = drosteFullData ?? null;
		// Rebuild the always-on note navigator fresh (node set may have changed);
		// ensureNoteMenu re-creates it on the next draw in EVERY mode. The located-
		// note highlight is per-graph, so clear it on every rebuild.
		this.removeNoteMenu();
		this.locatedNoteId = null;

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

		// Note list for the note navigator. Every on-canvas node MUST get a
		// checkbox, else "Deselect all" can't hide it. `navigatorNodeSource` picks
		// the right universe per mode:
		//   • non-droste — the mode-invariant LIMIT-trimmed set (menuLimitedNodes),
		//     built from the pristine post-buildGraph graph with the user's REAL
		//     havingAuto, so the menu (note list, Folder/Tag tree, search) is
		//     IDENTICAL across all those modes regardless of their on-canvas state.
		//   • droste (Icon Gallery) — the FULL pre-LIMIT snapshot the gallery bakes
		//     (`drosteFullData`); the gallery draws one tile PER NODE, so the
		//     navigator must list that same full set or LIMIT-dropped tiles would
		//     have no checkbox and could never be hidden.
		const menuNodeSource = navigatorNodeSource({
			isDroste: this.settings.viewMode === "droste",
			galleryNodes: drosteFullData?.nodes ?? [],
			limitedNodes: this.menuLimitedNodes(menuSourceData),
		});
		this.menuNotes = this.projectMenuNotes(menuNodeSource);

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
			drosteAllData: drosteFullData,
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
		const isDroste = this.settings.viewMode === "droste";
		if (modeChanged || (wasEmpty && !isDroste)) this.fitToView();
		this.requestDraw();
		this.refreshSettingsTab();
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
		const dpr = activeWindow.devicePixelRatio || 1;
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
		const panelW = this.pinnedMenuWidth();
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
			const panelW = this.pinnedMenuWidth();
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
		if (this.laid.drosteGallery) {
			// Icon Gallery: centre on the focus node's cell at a readable zoom.
			this.centerDrosteOn(this.settings.drosteFocus || this.laid.drosteGallery.cells[0]?.id || "");
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
		const panelW = this.pinnedMenuWidth();
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
		const panelW = this.pinnedMenuWidth();
		const visW = Math.max(1, this.canvas.clientWidth - panelW);

		// Connection matrix: spreadsheet scroll — never reveal empty space
		// before row/col 0 or past the last row/col.
		if (this.laid.matrix) {
			const m = this.laid.matrix;
			const g = matrixGeom(m, this.zoom, visW);
			const colsW = m.cols.length * g.colScreenW;
			const rowsH = this.matrixLines.length * g.rowScreenH; // floored pitch
			const minPanX = Math.min(g.labelBand, visW - colsW);
			this.panX = Math.min(g.labelBand, Math.max(minPanX, this.panX));
			const minPanY = Math.min(g.headerH, this.canvas.clientHeight - rowsH);
			this.panY = Math.min(g.headerH, Math.max(minPanY, this.panY));
			return;
		}
		if (this.laid.heatmap) {
			// Spreadsheet scroll over the square grid.
			const h = this.laid.heatmap;
			const g = heatmapGeom(h, this.zoom, visW);
			const grid = h.n * g.cellPx;
			const minPanX = Math.min(g.labelBand, visW - grid);
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
		this.rafId = window.requestAnimationFrame(() => this.draw());
	}

	private draw(): void {
		const ctx = this.ctx;
		const dpr = activeWindow.devicePixelRatio || 1;
		const cw = this.canvas.width;
		const ch = this.canvas.height;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = "#0f1116";
		ctx.fillRect(0, 0, cw, ch);
		// Mode-agnostic note navigator (folder tree + search). Built once per
		// rebuild; shown in EVERY view mode. It self-suppresses when there are
		// zero notes. Sits top-left, the same slot as the old Icon Gallery menu.
		// ISOLATED: the navigator must NEVER prevent the figure from drawing — a
		// throw here (seen on mobile) used to abort the whole draw, leaving the
		// canvas blank. Catch it, keep drawing, and surface the cause in a banner.
		this.noteMenuError = null;
		try {
			this.ensureNoteMenu();
		} catch (e) {
			this.noteMenuError = e instanceof Error ? `${e.message}` : String(e);
			if (!this.noteMenuErrorLogged) {
				console.error("[tag-lens] note navigator failed to render (figure still drawn):", e);
				this.noteMenuErrorLogged = true;
			}
			// A half-built panel would overlay the canvas — remove it so the figure is clean.
			try { this.removeNoteMenu(); } catch { /* ignore */ }
		}
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
		// Containment lens = Icon Gallery: every node's icon diagram, tiled, pan/zoomed.
		if (this.laid.drosteGallery && this.laid.drosteGallery.cells.length > 0) {
			drawDroste(ctx, {
				canvas: this.canvas,
				dpr,
				gallery: this.laid.drosteGallery,
				cellSize: DROSTE_CELL,
				zoom: this.zoom,
				panX: this.panX,
				panY: this.panY,
				hoverId: this.hoveredNodeId,
				focusId: this.settings.drosteFocus,
				hitRegions: (this.drosteHit = []),
				// Pass the live hidden set so the draw path skips unchecked cells
				// immediately on requestDraw() — no rebuild required (matches
				// the skipNode path used by all other view modes).
				hiddenSet: new Set(this.settings.hiddenNodes),
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
			nodeIsHidden(id, hiddenSet) || this.trulyAggSet.has(id);

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

		// Non-fatal navigator error → small screen-space banner so the cause is
		// visible on mobile (where the console isn't reachable). The figure above
		// is already drawn; this just annotates it.
		if (this.noteMenuError) {
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			const msg = `⚠ Note menu disabled: ${this.noteMenuError}`;
			ctx.font = "12px sans-serif";
			ctx.textBaseline = "top";
			ctx.textAlign = "left";
			const padX = 8, padY = 5, cw = this.canvas.clientWidth || 0;
			const text = msg.length > 140 ? `${msg.slice(0, 139)}…` : msg;
			const tw = Math.min(ctx.measureText(text).width, Math.max(0, cw - 16));
			ctx.fillStyle = "rgba(120,30,30,0.92)";
			ctx.fillRect(8, 8, tw + padX * 2, 22);
			ctx.fillStyle = "#ffd7d7";
			ctx.fillText(text, 8 + padX, 8 + padY, Math.max(0, cw - 24));
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
		void this.app.workspace.openLinkText(path, "", false);
	}

	// Centre the gallery viewport on node `id`'s cell at a readable zoom.
	private centerDrosteOn(id: string): void {
		const g = this.laid.drosteGallery;
		if (!g) return;
		const cell = g.cells.find((c) => c.id === id) ?? g.cells[0];
		if (!cell) return;
		const cw = this.canvas.clientWidth || 1, ch = this.canvas.clientHeight || 1;
		this.zoom = Math.max(0.05, Math.min(3, (Math.min(cw, ch) * 0.55) / DROSTE_CELL));
		const wx = (cell.col + 0.5) * DROSTE_CELL, wy = (cell.row + 0.5) * DROSTE_CELL;
		this.panX = cw / 2 - wx * this.zoom;
		this.panY = ch / 2 - wy * this.zoom;
		this.requestDraw();
	}

	// Focus node `id`: highlight it and (optionally) centre its icon.
	// center=true  → menu selection path: recalculate pan/zoom and move the
	//                viewport to the selected cell (existing behaviour).
	// center=false → canvas click path: keep current pan/zoom unchanged;
	//                only update the focus highlight and repaint.
	private setDrosteFocus(id: string, center = true): void {
		this.settings.drosteFocus = id;
		void this.save();
		if (center) {
			this.centerDrosteOn(id); // centerDrosteOn calls requestDraw internally
		} else {
			this.requestDraw();
		}
		this.noteMenuRedraw?.();
	}

	private removeNoteMenu(): void {
		// Snapshot the current search query, expanded folder paths, and scroll
		// position before tearing down the DOM so ensureNoteMenu() can restore
		// them — a rebuild mid-typing or mid-browsing must not reset the menu UI.
		if (this.noteMenu) {
			const searchEl = this.noteMenu.querySelector<HTMLInputElement>("input[type=text]");
			if (searchEl) this.noteMenuSearchQuery = searchEl.value;
			// Collect all folder rows whose children are currently OPEN. Each
			// folder row has a data-menupath attribute set at build time (see
			// ensureNoteMenu) and is open when its sibling kids-div is visible.
			const newExpanded = new Set<string>();
			const folderRows = this.noteMenu.querySelectorAll<HTMLElement>("[data-menupath]");
			folderRows.forEach((row) => {
				// The kids div is the next sibling of the folder row.
				const kids = row.nextElementSibling as HTMLElement | null;
				if (kids && kids.style.display !== "none") {
					const path = row.dataset.menupath;
					if (path !== undefined) newExpanded.add(path);
				}
			});
			this.noteMenuExpandedPaths = newExpanded;
			// Capture the scroll position of the body (overflow:auto div).
			const bodyEl = this.noteMenu.querySelector<HTMLElement>(".gim-notemenu-body");
			if (bodyEl) this.noteMenuScrollTop = bodyEl.scrollTop;
		}
		this.noteMenu?.remove();
		this.noteMenu = null;
		this.noteMenuRedraw = null;
	}

	// The note list the navigator should show. `menuNoteList` ignores `this.laid`
	// for the displayed set and always returns `this.menuNotes` (chosen per mode
	// by navigatorNodeSource in rebuild: the mode-invariant trimmed set, or the
	// full gallery snapshot in droste). `this.laid` is passed only for signature
	// stability with `menuClickAction` (click ROUTING stays mode-appropriate).
	private currentMenuNotes(): NoteRef[] {
		return menuNoteList(this.laid, this.menuNotes);
	}

	// Build the navigator's universal note set MODE-INDEPENDENTLY.
	//
	// Source = the pristine post-buildGraph graph (post WHERE/GROUP_BY, pre any
	// HAVING/LIMIT). We then re-run the HAVING and LIMIT stages here using the
	// user's REAL `havingAuto` (never the lattice/droste auto-HAVING exemption
	// applied to the on-canvas `data`). Because no view mode is special-cased,
	// the resulting note SET, order, and memberships depend ONLY on the vault +
	// the WHERE/GROUP_BY/HAVING/LIMIT settings — so the menu's note list, Folder
	// tree, Tag tree, and search are IDENTICAL across every view mode.
	//
	// (Manual/explicit HAVING and WHERE/LIMIT still apply — those are intended
	// filters shared by all modes; only the mode-dependent auto-HAVING exemption
	// is removed from the menu.)
	// The mode-invariant LIMIT-trimmed node set for the navigator: applies the
	// user's REAL HAVING + LIMIT (stages 1–2) so the same vault + settings yield
	// an identical list in every NON-droste mode. Returns the surviving GraphNodes
	// (un-projected) so the caller can pick this OR the full droste snapshot via
	// `navigatorNodeSource` before the single projection pass.
	private menuLimitedNodes(source: GraphData): GraphNode[] {
		// 1. HAVING — using the user's real havingAuto (mode-independent).
		let graph: GraphData = { nodes: source.nodes.slice(), edges: source.edges.slice() };
		const eff = resolveEffectiveHaving(
			this.settings.having,
			this.settings.havingAuto,
			graph.nodes.length,
		);
		const { dropped } = computeDroppedClustersFn(
			graph.nodes,
			eff,
			this.settings.havingAuto,
		);
		if (dropped.size > 0) graph = filterMemberships(graph, dropped);

		// 2. LIMIT — same rules as the canvas, ranked by a SELF-CONTAINED degree
		//    map (from this graph's own edges) + this graph's memberships, so the
		//    selection never depends on the mode-specific on-canvas state.
		const degreeMap = computeDegreeMaps(graph.edges).degreeMap;
		const membById = new Map(graph.nodes.map((n) => [n.id, n.memberships]));
		const tiers = this.parseLimitRules();
		const { visibleNodes } = applyLimitRules(
			graph.nodes,
			tiers,
			this.settings.orderField,
			this.settings.orderDir,
			(id, field) =>
				getSortKeyFn(id, field, {
					app: this.app,
					degreeMap,
					membershipsOf: (nid) => membById.get(nid),
				}),
		);
		return visibleNodes;
	}

	// Project navigator GraphNodes to NoteRefs, backfilling search metadata
	// (tags/frontmatter) from Obsidian's metadataCache.
	private projectMenuNotes(nodes: GraphNode[]): {
		id: string;
		label: string;
		memberships: string[];
		path: string;
		tags: string[];
		frontmatter: Record<string, string[]>;
	}[] {
		return nodes.map((n) => {
			const memberships = n.memberships ?? [];
			const path = stripTabPrefix(n.id);
			const { tags, frontmatter } = this.noteSearchMeta(path, memberships);
			return { id: n.id, label: n.label, memberships, path, tags, frontmatter };
		});
	}

	// Collect a note's searchable tags + frontmatter from Obsidian's
	// metadataCache for the advanced navigator search. Robust to a missing
	// file/cache (returns empty tags + frontmatter). The ONLY place Obsidian
	// metadata is read for the navigator — note-menu.ts stays pure/DOM-less.
	//   • tags        — combined from (a) the note's GROUP_BY `memberships`
	//                   (decoded; only the tag-derived ones), (b) frontmatter
	//                   `tags`, and (c) inline cache.tags. Leading '#' stripped,
	//                   hierarchy ("a/b") kept, deduped.
	//   • frontmatter — every frontmatter key (except the internal `position`)
	//                   flattened to an array of string values: scalars →
	//                   [String(v)], arrays → mapped to String.
	private noteSearchMeta(
		path: string,
		memberships: string[],
	): { tags: string[]; frontmatter: Record<string, string[]> } {
		const tagSet = new Set<string>();
		const stripHash = (t: string): string => (t.startsWith("#") ? t.slice(1) : t);
		// (a) memberships → decode "key=value" group keys; keep the value as a tag.
		for (const m of memberships) {
			if (m.length === 0) continue;
			// Group keys look like "tag=value" / "key=value" (value URI-encoded) or a
			// bare bucket name ("all", "(none)"). Take the value half if a '=' is present.
			const eq = m.indexOf("=");
			let raw = eq >= 0 ? m.slice(eq + 1) : m;
			try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
			raw = stripHash(raw);
			if (raw.length > 0) tagSet.add(raw);
		}
		const frontmatter: Record<string, string[]> = {};
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			const cache = this.app.metadataCache.getFileCache(file);
			// (b) frontmatter `tags` + (c) inline cache.tags.
			if (cache?.tags) for (const t of cache.tags) tagSet.add(stripHash(t.tag));
			const fm = cache?.frontmatter as Record<string, unknown> | undefined;
			const fmTags = fm?.tags;
			if (Array.isArray(fmTags)) for (const t of fmTags) tagSet.add(stripHash(String(t)));
			else if (typeof fmTags === "string") tagSet.add(stripHash(fmTags));
			// Flatten every frontmatter key (skip the internal `position` key).
			if (fm) {
				for (const key of Object.keys(fm)) {
					if (key === "position") continue;
					const v = fm[key];
					if (v === null || v === undefined) { frontmatter[key] = []; continue; }
					frontmatter[key] = Array.isArray(v) ? v.map((x) => String(x)) : [String(v)];
				}
			}
		}
		return { tags: [...tagSet], frontmatter };
	}

	// Which row to highlight as "current": the droste focus in droste mode,
	// otherwise the last note located on canvas (if any).
	private currentMenuHighlightId(): string | null {
		if (this.laid.drosteGallery) return this.settings.drosteFocus || null;
		return this.locatedNoteId;
	}

	// Single dispatcher for a navigator-row click. Routes per mode:
	//   • droste mode               → setDrosteFocus(id) (re-centre the gallery)
	//   • node positioned on canvas  → centre the viewport on it + highlight
	//   • else (aggregate / no pos)  → openFile(id)
	private focusNoteFromMenu(id: string): void {
		switch (menuClickAction(this.laid, id)) {
			case "drosteFocus":
				this.setDrosteFocus(id);
				return;
			case "locate":
				this.locateNodeOnCanvas(id);
				return;
			default:
				this.openFile(id);
		}
	}

	// Centre the viewport on a positioned node and select/highlight it so the
	// user can spot it. Reuses the existing pan/zoom + highlight machinery.
	private locateNodeOnCanvas(id: string): void {
		const node = this.laid.nodes.find((n) => n.id === id);
		if (!node) return;
		const cw = this.canvas.clientWidth || 1, ch = this.canvas.clientHeight || 1;
		// Zoom in enough to read the card, but never zoom out from the current
		// view if it's already closer.
		this.zoom = Math.max(this.zoom, 0.6);
		this.panX = cw / 2 - node.x * this.zoom;
		this.panY = ch / 2 - node.y * this.zoom;
		this.locatedNoteId = id;
		// Drive the shared highlight machinery exactly like a hover would, so the
		// node + its incident edges/clusters light up.
		this.applyHighlight({ kind: "node", nodeId: id });
		this.noteMenuRedraw?.();
	}

	// Always-on, mode-agnostic note navigator (folder tree + search). Built once
	// per rebuild and shown in EVERY view mode. Selecting a note routes through
	// `focusNoteFromMenu` (droste focus / canvas locate / openFile). Self-
	// suppresses when there are zero notes.
	private ensureNoteMenu(): void {
		// Respect the graph-settings show/hide toggle: when off, the menu must
		// never appear in ANY mode — tear down any existing panel and bail.
		if (!this.settings.noteMenuVisible) {
			this.removeNoteMenu();
			return;
		}
		if (this.noteMenu) return;
		const nodes = this.currentMenuNotes();
		if (nodes.length === 0) return;
		const isDroste = !!this.laid.drosteGallery;
		const panel = this.root.createDiv();
		this.noteMenu = panel;
		// Resolve the panel rect (px, relative to this.root). Priority:
		//   1. this.noteMenuRect — survives REBUILDS (set on every drag/resize).
		//   2. this.settings.noteMenuRect — survives RELOADS (persisted to data.json).
		//   3. the built-in default (top-left, 270px wide, container-tall).
		// On every (re)build we clamp the rect to the current container size so a
		// shrunken view can never strand the panel off-screen.
		const NOTE_MENU_MIN = { width: 180, height: 120 };
		const container = { width: this.root.clientWidth || 0, height: this.root.clientHeight || 0 };
		const defaultRect: MenuRect = {
			left: 8,
			top: 8,
			// Wider default than the old note-only menu so the Settings tab's form
			// rows (expressions, selects) fit without horizontal scrolling.
			width: 320,
			// Default height ≈ "calc(100% - 16px)" of the old maxHeight, but as an
			// explicit number so the resize handle has something to grow/shrink.
			height: Math.max(NOTE_MENU_MIN.height, (container.height || 600) - 16),
		};
		const seed: MenuRect = this.noteMenuRect
			?? (this.settings.noteMenuRect ? { ...this.settings.noteMenuRect } : defaultRect);
		// Only clamp when we know the container size (clientHeight can be 0 before
		// the first paint); otherwise keep the seed verbatim.
		const rect: MenuRect = container.width > 0 && container.height > 0
			? clampRect(seed, container, NOTE_MENU_MIN)
			: seed;
		this.noteMenuRect = rect;
		const pinned = !!this.settings.noteMenuPinned;
		// Docked width when pinned (clamped to ≤80% of the container).
		const pinnedW = Math.min(
			Math.max(NOTE_MENU_MIN.width, this.settings.noteMenuPinnedWidth ?? 320),
			Math.max(NOTE_MENU_MIN.width, Math.floor((container.width || 320) * 0.8)),
		);
		if (pinned) {
			// Dock to the RIGHT edge: full height, fixed width, square corners, a
			// left border only — the canvas reserves `pinnedMenuWidth()` so the
			// figure isn't covered (like a standard docked side panel).
			panel.setCssStyles({
				position: "absolute",
				left: "", right: "0", top: "0", bottom: "0", height: "", width: `${pinnedW}px`,
				display: "flex", flexDirection: "column", overflow: "hidden",
				background: "rgba(20,24,33,0.98)",
				border: "none", borderLeft: "1px solid #3a4760", borderRadius: "0",
				boxShadow: "-4px 0 16px rgba(0,0,0,0.5)", zIndex: "60", font: "12px sans-serif", color: "#e6edf3",
			});
		} else {
			panel.setCssStyles({
				position: "absolute",
				left: `${rect.left}px`, top: `${rect.top}px`, right: "", bottom: "",
				width: `${rect.width}px`, height: `${rect.height}px`,
				display: "flex", flexDirection: "column", overflow: "hidden",
				background: "rgba(20,24,33,0.96)", border: "1px solid #3a4760", borderRadius: "6px",
				boxShadow: "0 4px 16px rgba(0,0,0,0.5)", zIndex: "60", font: "12px sans-serif", color: "#e6edf3",
			});
		}
		const head = panel.createDiv();
		// When floating, the header IS the drag handle (cursor:move); when pinned
		// the panel is docked so it can't be moved (cursor:default).
		head.setCssStyles({
			padding: "6px 8px", borderBottom: "1px solid #2a3447", fontWeight: "600",
			cursor: pinned ? "default" : "move", userSelect: "none", flex: "0 0 auto",
		});
		// Header verb is mode-appropriate: droste focuses, other modes either
		// locate the card on canvas or open the file.
		const verb = isDroste ? "focus" : "locate/open";
		// Title row: name on the left, pin + × on the right.
		const titleRow = head.createDiv();
		titleRow.setCssStyles({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" });
		titleRow.createSpan({ text: "Tag Lens" });
		const headBtns = titleRow.createDiv();
		headBtns.setCssStyles({ display: "flex", alignItems: "center", gap: "2px", flex: "0 0 auto" });
		// Pin/unpin: dock the menu to the right edge (standard pin affordance).
		const pinBtn = headBtns.createSpan();
		pinBtn.setCssStyles({ cursor: "pointer", color: pinned ? "#2d6cdf" : "#9db4d6", display: "inline-flex", alignItems: "center", padding: "0 2px" });
		setIcon(pinBtn, pinned ? "pin-off" : "pin");
		pinBtn.setAttr("aria-label", pinned ? "Unpin (float)" : "Pin to right");
		pinBtn.addEventListener("mousedown", (ev) => ev.stopPropagation());
		pinBtn.addEventListener("dblclick", (ev) => ev.stopPropagation());
		pinBtn.addEventListener("click", (ev) => { ev.stopPropagation(); this.togglePin(); });
		const closeBtn = headBtns.createSpan({ text: "×" });
		closeBtn.setCssStyles({ cursor: "pointer", fontWeight: "700", fontSize: "16px", lineHeight: "1", padding: "0 4px", color: "#9db4d6", flex: "0 0 auto" });
		closeBtn.setAttr("aria-label", "Close menu");
		closeBtn.addEventListener("mousedown", (ev) => ev.stopPropagation());
		closeBtn.addEventListener("dblclick", (ev) => ev.stopPropagation());
		closeBtn.addEventListener("click", (ev) => { ev.stopPropagation(); this.toggleNoteMenu(); });
		// ── Top-level tabs: Notes | Settings ─────────────────────────────────────
		const tabBar = head.createDiv();
		// Underline-style tabs: the bar carries the divider line that the active
		// tab's accent underline sits on (marginBottom:-1px lines them up), so the
		// active tab reads as connected to the body below.
		tabBar.setCssStyles({ display: "flex", gap: "2px", marginTop: "8px", fontWeight: "400", fontSize: "11px", borderBottom: "1px solid #2a3447" });
		tabBar.addEventListener("mousedown", (ev) => ev.stopPropagation());
		// Don't let a double-click on the tab bar toggle the header's minimize.
		tabBar.addEventListener("dblclick", (ev) => ev.stopPropagation());
		// Two tab panes under a flex wrapper that fills the rest of the panel.
		const bodyWrap = panel.createDiv();
		bodyWrap.setCssStyles({ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: "0", overflow: "hidden" });
		const notesTab = bodyWrap.createDiv();
		notesTab.setCssStyles({ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: "0" });
		const settingsTab = bodyWrap.createDiv({ cls: "gim-menu-settings" });
		settingsTab.setCssStyles({ display: "none", overflow: "auto", flex: "1 1 auto", minHeight: "0", padding: "4px 6px 8px" });
		const insightTab = bodyWrap.createDiv();
		insightTab.setCssStyles({ display: "none", overflow: "auto", flex: "1 1 auto", minHeight: "0", padding: "4px 6px 8px" });
		type MenuTab = "notes" | "settings" | "insight";
		const TABS: MenuTab[] = ["notes", "settings", "insight"];
		const tabBtns: Partial<Record<MenuTab, HTMLElement>> = {};
		const styleTabs = (): void => {
			for (const key of TABS) {
				const b = tabBtns[key];
				if (!b) continue;
				const on = this.activeMenuTab === key;
				b.setCssStyles({
					background: "transparent", border: "none",
					borderBottom: on ? "2px solid #2d6cdf" : "2px solid transparent",
					borderRadius: "0", padding: "6px 14px", marginBottom: "-1px",
					color: on ? "#e6edf3" : "#9db4d6", fontWeight: on ? "600" : "400",
					cursor: "pointer", fontSize: "11px", lineHeight: "1.3",
				});
			}
		};
		const showTab = (key: MenuTab): void => {
			this.activeMenuTab = key;
			notesTab.setCssStyles({ display: key === "notes" ? "flex" : "none" });
			settingsTab.setCssStyles({ display: key === "settings" ? "block" : "none" });
			insightTab.setCssStyles({ display: key === "insight" ? "block" : "none" });
			if (key === "settings") this.renderSettingsBody(settingsTab);
			else this.settingsHostEl = null;
			if (key === "insight") this.renderInsightBody(insightTab);
			styleTabs();
		};
		const mkTab = (key: MenuTab, label: string): void => {
			const b = tabBar.createEl("button", { text: label });
			tabBtns[key] = b;
			b.addEventListener("mousedown", (ev) => ev.stopPropagation());
			b.addEventListener("click", (ev) => { ev.stopPropagation(); showTab(key); });
			// Hover affordance for the inactive tab (active styling wins via styleTabs).
			b.addEventListener("mouseenter", () => {
				if (this.activeMenuTab !== key) { b.setCssStyles({ color: "#cdd9ec" }); b.setCssStyles({ borderBottomColor: "#3a4760" }); }
			});
			b.addEventListener("mouseleave", () => styleTabs());
		};
		mkTab("notes", "Notes");
		mkTab("settings", "Settings");
		mkTab("insight", "Insight");
		// Note-count + click hint, shown at the top of the Notes pane.
		const notesHint = notesTab.createDiv({ text: `${nodes.length} notes — click to ${verb}` });
		notesHint.setCssStyles({ fontSize: "10px", color: "#7e8aa0", padding: "4px 8px 0" });
		// ── Grouping selector (Folder / Tag) ────────────────────────────────────
		// A small radio group in the header switches the tree between the FOLDER
		// tree (by note path, default) and the TAG tree (by GROUP_BY membership
		// keys). The chosen grouping survives rebuilds (this.noteMenuGroupBy) and
		// reloads (settings.noteMenuGroupBy). Changing it re-renders the tree.
		const groupBar = notesTab.createDiv();
		groupBar.setCssStyles({
			display: "flex", gap: "10px", marginTop: "4px", fontWeight: "400",
			fontSize: "11px", color: "#9db4d6", cursor: "default",
		});
		const groupName = "gim-notemenu-group";
		const mkGroupRadio = (value: "folder" | "tag", labelText: string): void => {
			const lab = groupBar.createEl("label");
			lab.setCssStyles({ display: "inline-flex", alignItems: "center", gap: "3px", cursor: "pointer", userSelect: "none" });
			const radio = lab.createEl("input", { attr: { type: "radio", name: groupName, value } });
			radio.checked = this.noteMenuGroupBy === value;
			lab.createSpan({ text: labelText });
			radio.addEventListener("change", () => {
				if (!radio.checked) return;
				this.noteMenuGroupBy = value;
				this.settings.noteMenuGroupBy = value;
				void this.save();
				this.noteMenuRedraw?.();
			});
			// Don't let a click in the selector start a header MOVE drag.
			lab.addEventListener("mousedown", (ev) => ev.stopPropagation());
		};
		mkGroupRadio("folder", "Folder");
		mkGroupRadio("tag", "Tag");
		// ── Select all / Deselect all ────────────────────────────────────────────
		// Two small buttons that (un)check EVERY note in the current menu set
		// at once. Operate on the full `nodes` list (currentMenuNotes, already
		// captured above as `nodes`), keyed by hideKey = stripTabPrefix(id) — the
		// same key the per-row checkboxes use. Does NOT call rebuild(); a plain
		// requestDraw() is enough because the draw() skipNode filter re-reads
		// hiddenNodes fresh every frame.
		const bulkBar = notesTab.createDiv();
		bulkBar.setCssStyles({
			display: "flex", gap: "6px", marginTop: "4px",
		});
		const mkBulkBtn = (label: string, handler: () => void): void => {
			const btn = bulkBar.createEl("button");
			btn.textContent = label;
			btn.setCssStyles({
				fontSize: "10px", padding: "2px 6px", cursor: "pointer",
				background: "#1a2236", border: "1px solid #3a4760",
				borderRadius: "3px", color: "#9db4d6", lineHeight: "1.4",
			});
			// Prevent the button click from starting a header move-drag.
			btn.addEventListener("mousedown", (ev) => ev.stopPropagation());
			btn.addEventListener("click", (ev) => {
				ev.stopPropagation();
				handler();
			});
		};
		mkBulkBtn("Select all", () => {
			// Show all: remove every listed note's hide-key from hiddenNodes.
			for (const n of nodes) {
				const k = hideKey(n);
				const idx = this.settings.hiddenNodes.indexOf(k);
				if (idx >= 0) this.settings.hiddenNodes.splice(idx, 1);
			}
			void this.save();
			this.requestDraw();
			// Redraw the menu so checkboxes reflect the new state without rebuilding
			// the panel (no scroll/expand collapse).
			this.noteMenuRedraw?.();
		});
		mkBulkBtn("Deselect all", () => {
			// Hide all: add every listed note's hide-key to hiddenNodes (dedup).
			for (const n of nodes) {
				const k = hideKey(n);
				if (!this.settings.hiddenNodes.includes(k)) {
					this.settings.hiddenNodes.push(k);
				}
			}
			void this.save();
			this.requestDraw();
			this.noteMenuRedraw?.();
		});
		// Search input lives in a relatively-positioned wrapper so the suggestion
		// dropdown can be absolutely positioned directly beneath it.
		const searchWrap = notesTab.createDiv();
		searchWrap.setCssStyles({ position: "relative", margin: "6px 8px", flex: "0 0 auto" });
		const search = searchWrap.createEl("input", { attr: { type: "text", placeholder: "Search: word, #tag, key:value" } });
		search.setCssStyles({ display: "block", width: "100%", boxSizing: "border-box", padding: "4px 6px", background: "#0f1116", border: "1px solid #2a3447", borderRadius: "4px", color: "#e6edf3" });
		// Restore the search query that was active before this rebuild (if any).
		// This preserves the user's typed text across vault-change-triggered rebuilds.
		if (this.noteMenuSearchQuery) search.value = this.noteMenuSearchQuery;
		// Suggestion (autocomplete) dropdown — absolutely positioned under the input,
		// same panel styling, zIndex above the body. Hidden until there are matches.
		const suggBox = searchWrap.createDiv();
		suggBox.setCssStyles({
			position: "absolute", left: "0", right: "0", top: "100%", marginTop: "2px",
			background: "rgba(20,24,33,0.98)", border: "1px solid #3a4760", borderRadius: "4px",
			boxShadow: "0 4px 16px rgba(0,0,0,0.5)", zIndex: "70", overflow: "auto", maxHeight: "240px",
			display: "none",
		});
		const body = notesTab.createDiv({ cls: "gim-notemenu-body" });
		// flex:1 1 auto + minHeight:0 → the tree scroll area grows/shrinks with the
		// panel height (set above / on resize) instead of a fixed maxHeight.
		body.setCssStyles({ overflow: "auto", padding: "4px 6px 8px", flex: "1 1 auto", minHeight: "0" });
		// FLOATING: header-drag MOVE + bottom-right RESIZE + double-click MINIMIZE.
		// PINNED: none of those (it's docked) — a left-edge handle resizes width.
		if (!pinned) {
		const grip = this.wireNoteMenuDrag(panel, head, search, NOTE_MENU_MIN);

		// ── MINIMIZE: header DOUBLE-CLICK toggles minimized ⇄ restored ───────────
		// No icon/button — a clean double-click on the header is the only affordance.
		// dblclick (not click) so it never conflicts with the single-click/drag MOVE.
		// Minimized ⇒ hide the search + tree body and collapse the panel to the
		// header bar height (width unchanged). The body height to restore to is
		// remembered on minimize so a second double-click round-trips back.
		const headerOnlyHeight = (): number => {
			// Header bar + the panel's borders (= total height when body is hidden).
			const h = head.offsetHeight || 0;
			const border = panel.offsetHeight - panel.clientHeight; // top+bottom border
			return Math.max(1, h + (border > 0 ? border : 2));
		};
		const applyMinimizedState = (): void => {
			if (this.noteMenuMinimized) {
				// Collapse to the header bar (title + tabs): hide the whole tab body.
				bodyWrap.setCssStyles({ display: "none" });
				// Resize is meaningless while collapsed — hide the grip.
				grip.setCssStyles({ display: "none" });
				const collapsed = noteMenuHeight(true, headerOnlyHeight(), rect.height, this.noteMenuRestoreHeight);
				panel.setCssStyles({ height: `${collapsed}px` });
			} else {
				bodyWrap.setCssStyles({ display: "flex" });
				grip.setCssStyles({ display: "" });
				// Restore the remembered body height (fall back to the live rect).
				const current = this.noteMenuRect?.height ?? rect.height;
				const h = noteMenuHeight(false, headerOnlyHeight(), current, this.noteMenuRestoreHeight);
				panel.setCssStyles({ height: `${h}px` });
				if (this.noteMenuRect) this.noteMenuRect = { ...this.noteMenuRect, height: h };
			}
		};
		head.addEventListener("dblclick", (ev: MouseEvent) => {
			ev.preventDefault();
			ev.stopPropagation();
			if (!this.noteMenuMinimized) {
				// Remember the current (expanded) height before collapsing.
				this.noteMenuRestoreHeight = this.noteMenuRect?.height ?? panel.offsetHeight;
			}
			this.noteMenuMinimized = !this.noteMenuMinimized;
			applyMinimizedState();
			// Persist across reloads (NOT in DEFAULT_SETTINGS — stays optional).
			this.settings.noteMenuMinimized = this.noteMenuMinimized;
			void this.save();
		});
		// Reapply the persisted/in-memory minimized state on every (re)build so it
		// survives rebuilds and reloads.
		applyMinimizedState();
		} else {
			// PINNED: a thin left-edge handle resizes the docked column width.
			// Dragging LEFT widens; the canvas reservation + pan update live.
			const lgrip = panel.createDiv();
			lgrip.setCssStyles({
				position: "absolute", left: "0", top: "0", bottom: "0", width: "6px",
				cursor: "ew-resize", zIndex: "61", background: "transparent",
			});
			lgrip.addEventListener("mousedown", (ev: MouseEvent) => {
				if (ev.button !== 0) return;
				ev.preventDefault();
				ev.stopPropagation();
				const startX = ev.clientX;
				const startW = panel.offsetWidth;
				const onMove = (e: MouseEvent): void => {
					const cw = this.root.clientWidth || 0;
					const raw = startW + (startX - e.clientX); // drag left → wider
					const w = Math.min(
						Math.max(NOTE_MENU_MIN.width, raw),
						Math.max(NOTE_MENU_MIN.width, Math.floor((cw || 320) * 0.8)),
					);
					panel.setCssStyles({ width: `${w}px` });
					this.settings.noteMenuPinnedWidth = w;
					this.requestDraw(); // re-reserve canvas width + re-pan the figure
				};
				const onUp = (): void => {
					activeWindow.removeEventListener("mousemove", onMove, true);
					activeWindow.removeEventListener("mouseup", onUp, true);
					void this.save();
				};
				activeWindow.addEventListener("mousemove", onMove, true);
				activeWindow.addEventListener("mouseup", onUp, true);
			});
		}
		// A row checkbox that must NOT trigger the row's click (focus/locate/open)
		// nor start a header MOVE drag. We stopPropagation on mousedown (so the
		// header-drag listener and the row-click handler never see it) and on click
		// (belt-and-braces). The visibility toggle is handled by the caller's
		// `onToggle` callback.
		//
		// Custom <span> element (not <input type="checkbox">) — avoids cascade
		// conflicts with Obsidian core/theme checkbox styles entirely. State is
		// driven by `data-state` ("checked" | "unchecked" | "indeterminate")
		// and styled in styles.css via `.gim-nav-cb[data-state="..."]`.
		type CbState = "checked" | "unchecked" | "indeterminate";
		const setCbState = (el: HTMLElement, state: CbState): void => {
			el.dataset.state = state;
			el.setAttribute("aria-checked", state === "indeterminate" ? "mixed" : state === "checked" ? "true" : "false");
		};
		const isCbChecked = (el: HTMLElement): boolean => el.dataset.state === "checked";
		const mkRowCheckbox = (host: HTMLElement, onToggle: () => void): HTMLElement => {
			// `gim-nav-cb` drives the custom tri-state rendering in styles.css
			// (checked ✓ / empty / indeterminate –) so the partial state is
			// unmistakable regardless of the active Obsidian theme.
			const cb = host.createEl("span", {
				cls: "gim-nav-cb",
				attr: { role: "checkbox", "aria-checked": "false", tabindex: "0" },
			});
			cb.dataset.state = "unchecked";
			cb.addEventListener("mousedown", (ev) => ev.stopPropagation());
			cb.addEventListener("click", (ev) => { ev.stopPropagation(); onToggle(); });
			cb.addEventListener("keydown", (ev: KeyboardEvent) => {
				if (ev.key === " " || ev.key === "Enter") {
					ev.preventDefault();
					ev.stopPropagation();
					onToggle();
				}
			});
			return cb;
		};
		// Current global hidden-set (path-or-id keys). Rebuilt fresh on every draw()
		// so checkbox states always reflect the persisted `hiddenNodes`.
		const hiddenSetNow = (): Set<string> => new Set(this.settings.hiddenNodes);

		// Live checkbox-state refreshers. Every rendered row (leaf + folder/group)
		// registers a closure that recomputes its checked/indeterminate state from
		// the CURRENT hiddenNodes. After ANY toggle we run them all so sibling/parent
		// boxes update WITHOUT tearing down the tree DOM (which would collapse open
		// folders). The list is reset whenever the tree body is re-rendered (draw()).
		const checkboxRefreshers: (() => void)[] = [];
		const refreshCheckboxes = (): void => { for (const r of checkboxRefreshers) r(); };

		const leafRow = (container: HTMLElement, id: string, label: string, depth: number): HTMLElement => {
			const row = container.createDiv();
			const highlightId = this.currentMenuHighlightId();
			const baseBg = id === highlightId ? "#2d6cdf55" : "";
			// padding must come BEFORE paddingLeft — Object.assign applies properties
			// left-to-right; putting padding last would overwrite the depth indent.
			row.setCssStyles({ display: "flex", alignItems: "center", padding: "2px 4px", paddingLeft: `${6 + depth * 12}px`, cursor: "pointer", borderRadius: "3px", whiteSpace: "nowrap", overflow: "hidden", background: baseBg });
			// Per-note visibility checkbox. CHECKED ⇔ the note is NOT hidden. The
			// state is GLOBAL per note (driven by hiddenNodes, keyed by PATH) so a
			// note appearing in multiple tag groups shows the same state everywhere.
			const noteKey = stripTabPrefix(id);
			const cb = mkRowCheckbox(row, () => {
				// Toggle this note's hide key (its PATH) so EVERY on-canvas copy of
				// the note is hidden/shown at once in every mode.
				// IMPORTANT: do NOT call rebuild() here — the graph draw() already
				// reads hiddenNodes fresh on every paint (via nodeIsHidden / skipNode),
				// so requestDraw() is enough to hide/show the node on canvas.
				// Calling rebuild() would tear down and recreate the whole menu panel,
				// collapsing all expanded folders and resetting the scroll position,
				// which makes it impossible to uncheck several notes in a row inside
				// an open folder.
				this.toggleArrayMember("hiddenNodes", noteKey, isCbChecked(cb));
				void this.save();
				this.requestDraw();
				// Reflect the new global state in every other visible box (parents
				// go indeterminate, a duplicate leaf re-syncs) — no tree rebuild.
				refreshCheckboxes();
			});
			setCbState(cb, hiddenSetNow().has(noteKey) ? "unchecked" : "checked");
			// Register a live refresher so a group cascade (or a duplicate of this
			// note elsewhere in the tree) updates THIS box without a tree rebuild.
			checkboxRefreshers.push(() => { setCbState(cb, hiddenSetNow().has(noteKey) ? "unchecked" : "checked"); });
			// The label carries the row-click behaviour (focus/locate/open) + ellipsis.
			const lbl = row.createSpan({ text: label });
			lbl.setCssStyles({ flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
			if (id === highlightId) lbl.setCssStyles({ color: "#ffd35c" });
			row.addEventListener("mouseenter", () => { row.setCssStyles({ background: "#2a3447" }); });
			row.addEventListener("mouseleave", () => { row.setCssStyles({ background: baseBg }); });
			lbl.addEventListener("click", () => this.focusNoteFromMenu(id));
			return row;
		};
		// ── (all) subtree renderer (tag tree only) ──────────────────────────────
		// Renders a collapsible "(all)" folder that lists ALL descendant notes of
		// a parent node as a flat list. The (all) row itself has NO checkbox;
		// individual leaf notes inside it carry the standard checkbox.
		const renderAllFolder = (
			container: HTMLElement,
			leaves: TreeLeaf[],
			depth: number,
			parentPath: string,
		): void => {
			const allPath = buildFolderPathKey(parentPath, "(all)");
			const row = container.createDiv();
			row.dataset.menupath = allPath;
			row.setCssStyles({
				display: "flex", alignItems: "center",
				padding: "2px 4px", paddingLeft: `${26 + depth * 12}px`,
				color: "#7a8aa0", fontWeight: "600", fontStyle: "italic",
			});
			// (all) has NO checkbox — only a collapsible label
			const lbl = row.createSpan({ text: `\u25b8 (all)` });
			lbl.setCssStyles({
				flex: "1 1 auto", cursor: "pointer",
				overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
			});
			const kids = container.createDiv();
			kids.setCssStyles({ display: "none" });
			let built = false;
			const openAll = (): void => {
				kids.setCssStyles({ display: "block" });
				lbl.textContent = `\u25be (all)`;
				if (!built) {
					for (const lf of leaves) leafRow(kids, lf.id, lf.label, depth + 1);
					built = true;
				}
			};
			const closeAll = (): void => {
				kids.setCssStyles({ display: "none" });
				lbl.textContent = `\u25b8 (all)`;
			};
			lbl.addEventListener("click", () => {
				if (kids.style.display !== "none") closeAll(); else openAll();
			});
			if (this.noteMenuExpandedPaths.has(allPath)) openAll();
		};
		// The folders/leaves are already deterministically sorted by buildFolderTree
		// / buildTagTree, so renderTree just walks them in insertion order.
		// `parentPath` is the accumulated path prefix (folder keys joined by "/")
		// used to stamp each folder row with a stable data-menupath attribute so
		// removeNoteMenu() can snapshot which paths were open, and the restore
		// pass after draw() can re-open them.
		// `isTagTree` enables the (all) subtree feature for tag-grouped views.
		const renderTree = (container: HTMLElement, t: TreeNode, depth: number, parentPath = "", isTagTree = false): void => {
			for (const [name, child] of t.folders.entries()) {
				// Tag-tree folders carry a display label ("#project", "#A * #B");
				// folder-tree nodes have none, so fall back to the Map key.
				const display = child.label ?? name;
				const folderPath = buildFolderPathKey(parentPath, name);
				const row = container.createDiv();
				// Stamp the stable path key so removeNoteMenu() can record which
				// folders were open and ensureNoteMenu() can re-open them.
				row.dataset.menupath = folderPath;
				// padding before paddingLeft — same order as leafRow (see comment there).
				row.setCssStyles({ display: "flex", alignItems: "center", padding: "2px 4px", paddingLeft: `${6 + depth * 12}px`, color: "#9db4d6", fontWeight: "600" });
				// Folder/group/combo checkbox — TRI-STATE over its descendant notes:
				// checked = all visible, unchecked = all hidden, indeterminate = mixed.
				// Toggling cascades to EVERY descendant note (check-all / uncheck-all).
				const descKeys = collectDescendantNoteKeys(child);
				const fcb = mkRowCheckbox(row, () => {
					// Standard cascade: currently fully checked → hide all; otherwise
					// (unchecked OR indeterminate) → show all. Update every descendant
					// note key at once, save once.
					// IMPORTANT: same as the leaf checkbox — do NOT call rebuild() here.
					// requestDraw() is enough; the draw() skipNode filter re-reads
					// hiddenNodes fresh each frame.
					const wasChecked = folderCheckState(descKeys, hiddenSetNow()) === "checked";
					const hide = wasChecked;
					for (const k of descKeys) this.toggleArrayMember("hiddenNodes", k, hide);
					void this.save();
					this.requestDraw();
					// Update this group's own box + its leaves/ancestors live.
					refreshCheckboxes();
				});
				const applyFolderState = (): void => {
					const st = folderCheckState(descKeys, hiddenSetNow());
					// `.gim-nav-cb` CSS renders all three states: checked ✓, empty, and
					// the indeterminate dash for a PARTIAL group (some descendants hidden).
					setCbState(fcb, st);
				};
				applyFolderState();
				// Live-refresh this group's tri-state after any toggle elsewhere.
				checkboxRefreshers.push(applyFolderState);
				const lbl = row.createSpan({ text: `▸ ${display}` });
				lbl.setCssStyles({ flex: "1 1 auto", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
				const kids = container.createDiv();
				kids.setCssStyles({ display: "none" });
				let built = false;
				// Open this folder (build children lazily if not yet built).
				const openFolder = (): void => {
					kids.setCssStyles({ display: "block" });
					lbl.textContent = `▾ ${display}`;
					if (!built) {
						// (all) subtree: in tag-tree mode, folders with sub-folders get a
						// collapsible "(all)" at the top listing every descendant note.
						if (isTagTree && child.folders.size > 0) {
							const allLeaves = collectDescendantLeaves(child);
							if (allLeaves.length > 0) {
								renderAllFolder(kids, allLeaves, depth + 1, folderPath);
							}
						}
						renderTree(kids, child, depth + 1, folderPath, isTagTree);
						built = true;
					}
				};
				// Close this folder.
				const closeFolder = (): void => {
					kids.setCssStyles({ display: "none" });
					lbl.textContent = `▸ ${display}`;
				};
				lbl.addEventListener("click", () => {
					if (kids.style.display !== "none") closeFolder(); else openFolder();
				});
				// If this folder's path was open before the last rebuild, restore it.
				if (this.noteMenuExpandedPaths.has(folderPath)) openFolder();
			}
			for (const lf of t.leaves) leafRow(container, lf.id, lf.label, depth);
		};
		const draw = (): void => {
			body.empty();
			// The tree DOM is rebuilt below — drop refreshers bound to the old rows.
			checkboxRefreshers.length = 0;
			const q = search.value.trim();
			if (q) {
				// Advanced search ALWAYS shows a flat, UNIQUE-by-path list — never
				// duplicated by grouping. (Tag-tree duplication applies only to the
				// non-search tree shown when the query is empty.)
				const hits = advancedSearch(nodes, q).slice(0, 300);
				if (!hits.length) { body.createDiv({ text: "(no matches)" }); return; }
				for (const n of hits) leafRow(body, n.id, n.label, 0);
			} else {
				const isTag = this.noteMenuGroupBy === "tag";
				const tree = isTag ? buildTagTree(nodes, this.clusterLabels) : buildFolderTree(nodes);
				// Root-level (all): in tag-tree mode, insert a top-level (all)
				// listing every note in the navigator before the tag folders.
				if (isTag && tree.folders.size > 0) {
					const allLeaves = collectDescendantLeaves(tree);
					if (allLeaves.length > 0) {
						renderAllFolder(body, allLeaves, 0, "");
					}
				}
				renderTree(body, tree, 0, "", isTag);
			}
		};

		// ── Suggestion dropdown machinery ────────────────────────────────────────
		// `suggestions` mirrors what's currently rendered in `suggBox`; `selIdx` is
		// the keyboard-highlighted row (−1 = none). The dropdown completes the TOKEN
		// currently being typed (substring after the last space).
		let suggestions: Suggestion[] = [];
		let selIdx = -1;
		const kindGlyph: Record<Suggestion["kind"], string> = { tag: "#", field: "⊳", note: "·" };
		const kindColor: Record<Suggestion["kind"], string> = { tag: "#7fc8ff", field: "#c8a6ff", note: "#9db4d6" };
		// Replace the current token in the input with `text`. Tags/notes get a
		// trailing space (term complete); "key:" stays open (no space) so the user
		// can keep typing the value.
		const acceptSuggestion = (text: string, kind: Suggestion["kind"]): void => {
			const val = search.value;
			const tok = currentToken(val);
			const head = val.slice(0, val.length - tok.length);
			const trailing = text.endsWith(":") ? "" : " ";
			search.value = head + text + trailing;
			closeSuggest();
			search.focus();
			draw();
		};
		const renderSelection = (): void => {
			const rows = Array.from(suggBox.children) as HTMLElement[];
			rows.forEach((r, i) => { r.setCssStyles({ background: i === selIdx ? "#2a3447" : "" }); });
		};
		const closeSuggest = (): void => {
			suggBox.setCssStyles({ display: "none" });
			suggBox.empty();
			suggestions = [];
			selIdx = -1;
		};
		const openSuggest = (): void => {
			suggestions = suggestQuery(nodes, search.value);
			suggBox.empty();
			selIdx = -1;
			if (suggestions.length === 0) { suggBox.setCssStyles({ display: "none" }); return; }
			suggestions.forEach((s, i) => {
				const row = suggBox.createDiv();
				row.setCssStyles({ padding: "3px 8px", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", gap: "6px", alignItems: "center" });
				const glyph = row.createSpan({ text: kindGlyph[s.kind] });
				glyph.setCssStyles({ color: kindColor[s.kind], width: "10px", flex: "0 0 auto", textAlign: "center" });
				row.createSpan({ text: s.text });
				row.addEventListener("mouseenter", () => { selIdx = i; renderSelection(); });
				// mousedown (not click) so it fires before the input's blur closes the box.
				row.addEventListener("mousedown", (ev) => {
					ev.preventDefault();
					acceptSuggestion(s.text, s.kind);
				});
			});
			suggBox.setCssStyles({ display: "block" });
		};
		// Re-suggest as the user types; close when the current token is empty.
		const onInput = (): void => {
			draw();
			if (currentToken(search.value).length === 0) closeSuggest();
			else openSuggest();
		};
		this.noteMenuRedraw = draw;
		search.addEventListener("input", onInput);
		search.addEventListener("keydown", (ev: KeyboardEvent) => {
			const open = suggBox.style.display !== "none" && suggestions.length > 0;
			if (ev.key === "ArrowDown") {
				if (!open) { openSuggest(); return; }
				ev.preventDefault();
				selIdx = (selIdx + 1) % suggestions.length;
				renderSelection();
			} else if (ev.key === "ArrowUp") {
				if (!open) return;
				ev.preventDefault();
				selIdx = (selIdx - 1 + suggestions.length) % suggestions.length;
				renderSelection();
			} else if (ev.key === "Enter") {
				if (open && selIdx >= 0) {
					ev.preventDefault();
					const s = suggestions[selIdx];
					acceptSuggestion(s.text, s.kind);
				} else {
					// No highlighted suggestion → just run the search (close any box).
					closeSuggest();
					draw();
				}
			} else if (ev.key === "Escape") {
				if (open) { ev.preventDefault(); ev.stopPropagation(); closeSuggest(); }
			}
		});
		// Close on blur — small delay so a suggestion mousedown/click lands first.
		search.addEventListener("blur", () => { window.setTimeout(closeSuggest, 150); });
		// Open the dropdown again when the field regains focus with a live token.
		search.addEventListener("focus", () => { if (currentToken(search.value).length > 0) openSuggest(); });
		draw();
		// Restore the scroll position of the body after the tree is built. The
		// expanded-folder restoring happens synchronously inside renderTree (via
		// the openFolder() calls), so by the time draw() returns the DOM already
		// reflects the correct expanded state. Restoring scrollTop after that
		// keeps the viewport at the exact position it was before the rebuild.
		if (this.noteMenuScrollTop > 0) {
			body.scrollTop = this.noteMenuScrollTop;
		}
		// Show the active tab (Notes by default; preserved across rebuilds). This
		// also renders the Settings body on demand when that tab is active.
		showTab(this.activeMenuTab);
	}

	// Wire the note navigator's two pure mouse-drag affordances — NO icons or
	// buttons are added:
	//   • MOVE   — mousedown on the HEADER bar starts a drag that updates the
	//              panel left/top. Drags starting on the search input or a tree
	//              row are ignored (those need their own clicks); only the bare
	//              header surface initiates a move.
	//   • RESIZE — an invisible bottom-right CORNER grab zone (cursor
	//              nwse-resize) whose drag updates the panel width/height. The
	//              flex column makes the body scroll-area grow/shrink with it.
	// Both clamp through clampRect (min size + on-screen guarantee) and persist
	// the final rect on mouseup: to this.noteMenuRect (survives rebuilds) and to
	// this.settings.noteMenuRect via this.save() (survives reloads).
	// Returns the invisible resize-grip element so the caller can hide it while
	// the panel is minimized (resize is meaningless when collapsed).
	private wireNoteMenuDrag(
		panel: HTMLElement,
		head: HTMLElement,
		search: HTMLElement,
		min: { width: number; height: number },
	): HTMLElement {
		const NOTE_MENU_MIN = min;
		const containerSize = (): { width: number; height: number } => ({
			width: this.root.clientWidth || 0,
			height: this.root.clientHeight || 0,
		});
		// Apply a (clamped) rect to both the live DOM and the persisted fields.
		const applyRect = (raw: MenuRect): void => {
			const c = containerSize();
			const r = c.width > 0 && c.height > 0 ? clampRect(raw, c, NOTE_MENU_MIN) : raw;
			this.noteMenuRect = r;
			panel.setCssStyles({ left: `${r.left}px` });
			panel.setCssStyles({ top: `${r.top}px` });
			panel.setCssStyles({ width: `${r.width}px` });
			panel.setCssStyles({ height: `${r.height}px` });
		};
		const persist = (): void => {
			if (this.noteMenuRect) this.settings.noteMenuRect = { ...this.noteMenuRect };
			void this.save();
		};

		// ── MOVE: drag the header ───────────────────────────────────────────────
		head.addEventListener("mousedown", (ev: MouseEvent) => {
			if (ev.button !== 0) return;
			// Don't hijack mousedowns meant for the search input (it lives in the
			// header column in some layouts) — only the bare header surface drags.
			if (ev.target !== head && !head.contains(ev.target as Node | null)) return;
			if (search.contains(ev.target as Node | null)) return;
			const start = this.noteMenuRect ?? { left: 0, top: 0, width: panel.offsetWidth, height: panel.offsetHeight };
			const ox = ev.clientX, oy = ev.clientY;
			const baseLeft = start.left, baseTop = start.top;
			ev.preventDefault();
			const onMove = (e: MouseEvent): void => {
				applyRect({ left: baseLeft + (e.clientX - ox), top: baseTop + (e.clientY - oy), width: start.width, height: start.height });
			};
			const onUp = (): void => {
				activeWindow.removeEventListener("mousemove", onMove, true);
				activeWindow.removeEventListener("mouseup", onUp, true);
				persist();
			};
			activeWindow.addEventListener("mousemove", onMove, true);
			activeWindow.addEventListener("mouseup", onUp, true);
		});

		// ── RESIZE: drag the invisible bottom-right corner ──────────────────────
		const grip = panel.createDiv();
		grip.setCssStyles({
			position: "absolute", right: "0", bottom: "0", width: "16px", height: "16px",
			cursor: "nwse-resize", zIndex: "61",
			// Invisible (no icon): just a transparent hit target in the corner.
			background: "transparent",
		});
		grip.addEventListener("mousedown", (ev: MouseEvent) => {
			if (ev.button !== 0) return;
			const start = this.noteMenuRect ?? { left: 0, top: 0, width: panel.offsetWidth, height: panel.offsetHeight };
			const ox = ev.clientX, oy = ev.clientY;
			const baseW = start.width, baseH = start.height;
			ev.preventDefault();
			ev.stopPropagation();
			const onMove = (e: MouseEvent): void => {
				applyRect({ left: start.left, top: start.top, width: baseW + (e.clientX - ox), height: baseH + (e.clientY - oy) });
			};
			const onUp = (): void => {
				activeWindow.removeEventListener("mousemove", onMove, true);
				activeWindow.removeEventListener("mouseup", onUp, true);
				persist();
			};
			activeWindow.addEventListener("mousemove", onMove, true);
			activeWindow.addEventListener("mouseup", onUp, true);
		});
		return grip;
	}

	private drosteHitTest(sx: number, sy: number): string | null {
		if (!this.laid.drosteGallery) return null;
		const dpr = activeWindow.devicePixelRatio || 1;
		const dx = sx * dpr, dy = sy * dpr;
		for (let i = this.drosteHit.length - 1; i >= 0; i--) {
			const r = this.drosteHit[i];
			if (dx >= r.x0 && dx <= r.x1 && dy >= r.y0 && dy <= r.y1) return r.id;
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
				? node.displayTags.map((s) => `#${s}`).join(" * ")
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
		panel.setCssStyles({
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
		});

		const head = panel.createDiv({ cls: "gim-detail-head" });
		head.setCssStyles({
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			padding: "6px 8px",
			borderBottom: "1px solid #2a3447",
			fontWeight: "700",
		});
		head.createSpan({ text: title });
		const close = head.createEl("button", { text: "×" });
		close.setCssStyles({
			background: "transparent",
			border: "none",
			color: "#9eb0c4",
			cursor: "pointer",
			fontSize: "16px",
		});
		close.addEventListener("click", () => {
			if (onCloseSelection) onCloseSelection();
			this.closeDetail();
			this.requestDraw();
		});

		const list = panel.createDiv({ cls: "gim-detail-list" });
		list.setCssStyles({ overflowY: "auto", padding: "4px 0" });
		if (ids.length === 0) {
			const empty = list.createDiv({ text: "(no shared notes)" });
			empty.setCssStyles({ padding: "6px 10px", color: "#7a8aa0" });
		}
		for (const id of ids) {
			const sep = id.indexOf("\t");
			const path = sep >= 0 ? id.slice(sep + 1) : id;
			const f = this.app.vault.getAbstractFileByPath(path);
			const name = f instanceof TFile ? f.basename : path;
			const row = list.createDiv({ cls: "gim-detail-row", text: name });
			row.setCssStyles({
				padding: "4px 10px",
				cursor: "pointer",
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis",
			});
			row.addEventListener("mouseenter", () => { row.setCssStyles({ background: "rgba(160,190,230,0.14)" }); });
			row.addEventListener("mouseleave", () => { row.setCssStyles({ background: "transparent" }); });
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
		el.setCssStyles({ left: `${x}px` });
		el.setCssStyles({ top: `${y}px` });
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
		if (this.laid.drosteGallery) {
			// Icon Gallery: highlight the hovered cell AND show the same node hover tip
			// (file name + folder) other view modes use. Synthetic markers ("__…") and
			// empty space show no tip.
			const id = this.drosteHitTest(sx, sy);
			const target: HoverTarget = id && !id.startsWith("__") ? { kind: "node", nodeId: id } : null;
			if (!sameTarget(this.hoverTarget, target)) {
				this.cancelHover(); // also clears hoveredNodeId
				this.hoverTarget = target;
				this.hoveredNodeId = id; // set AFTER cancelHover for the cell highlight
				if (target) this.scheduleHover(target, sx, sy);
				this.requestDraw();
			} else if (this.tipEl) {
				this.positionTip(sx, sy, this.tipEl);
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
		const tip = activeDocument.createElement("div");
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
				tip.createSpan({ cls: "gim-tip-title", text: `${ti.label} * ${tj.label}` });
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
		tip.setCssStyles({ left: x + "px" });
		tip.setCssStyles({ top: y + "px" });
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
			c.setCssStyles({ cursor: "grabbing" });
			this.cancelHover();
		});
		activeWindow.addEventListener("mousemove", (e) => {
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
		activeWindow.addEventListener("mouseup", (e) => {
			if (this.marquee.isActive()) {
				this.marquee.finish(e.clientX, e.clientY);
				return;
			}
			this.dragging = false;
			c.setCssStyles({ cursor: "grab" });
		});
		activeWindow.addEventListener("keydown", (e) => {
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
				// intersections show the DISPLAY tag list joined by " * " (the unified
				// AND operator; same resolution the header uses).
				this.openLatticeDetail(hitNode, sx, sy);
				return;
			}
			if (this.laid.drosteGallery) {
				// Click a node cell (① or a member square) → open the note AND update
				// the focus highlight. Pan/zoom is intentionally NOT changed here so
				// the user's current viewport is preserved; use the mini-menu to centre.
				const id = this.drosteHitTest(sx, sy);
				if (id && !id.startsWith("__")) {
					this.openFile(id);
					this.setDrosteFocus(id, false); // center=false: keep current pan/zoom
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
			const drosteHovered = this.laid.drosteGallery != null && this.hoveredNodeId !== null;
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

