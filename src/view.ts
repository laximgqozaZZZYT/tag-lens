import { ItemView, WorkspaceLeaf, TFile, debounce, setIcon, Notice, Menu, MarkdownView } from "obsidian";
import { exportCanvasDims } from "./visual/image-export";
import { renderInsightTab } from "./insight/render";
import { evaluateEncoding, type BindingLegend } from "./encoding/evaluate";
import { effectiveEncoding } from "./encoding/migrate";
import type { EncContext, EncNode, NodeDrawParams, EncodingBinding } from "./encoding/types";
import { axisLayout, type AxisSpec, type AxisBand, type AxisTick } from "./layout/axis-layout";
import { assignGalleryAxes } from "./layout/droste-axis";
import { LaneRegistry, routeZ } from "./layout/edge-routing";
import { buildIdToRect, buildRouteObstacles } from "./layout/layout-shared";
import { buildGraph } from "./query/parser";
import {
	layout,
	type LaidOut,
	type PositionedNode,
	type SizedNode,
	type ClusterRect,
} from "./layout/layout";
import type { MiniSettings, GraphNode, GraphData, ViewMode, LensPreset } from "./types";
import { CARD_CELL_W, CARD_CELL_H, NONE_BUCKET } from "./types";
import { type LimitRule, applyLimitRules } from "./query/limit";
import { filterMemberships, filterLabels } from "./query/query-filters";
import {
	parseLimitRules as parseLimitRulesFn,
	getSortKey as getSortKeyFn,
	computeDroppedClusters as computeDroppedClustersFn,
} from "./query/query-pipeline";
import { clusterHue, createStripePattern, createStripeGradient, resolveNodeStripe } from "./draw/canvas-utils";
import { resolveTheme, setTheme, theme, colorAlpha } from "./draw/theme";
import { expandClustersByInheritance, computeClusterBBoxes } from "./layout/cluster-bbox";
import { runAggregateSnap } from "./layout/aggregate-snap";
import {
	drawCardGrid as drawCardGridFn,
	drawGridHeaders as drawGridHeadersFn,
	drawClusterLabels as drawClusterLabelsFn,
	drawAggregateStack as drawAggregateStackFn,
	drawOverviewLabels as drawOverviewLabelsFn,
} from "./draw/draw-helpers";
import {
	computeMemberSets,
	computeStrictSupersets,
} from "./layout/cluster-relations";

import {
	resolveNodeDisplay as resolveNodeDisplayFn,
	resolveFromCluster as resolveFromClusterFn,
	visualScale,
	UNION_LAYER_KEY,
	INTERSECTION_LAYER_KEY,
	SET_LAYER_LABEL,
	type NodeDisplay,
	type NodeDisplayDeps,
} from "./visual/node-display";
import { drawEnclosures } from "./draw/draw-enclosures";
import { drawBaseEdges, drawAccentEdges, drawGhostEdges } from "./draw/draw-edges";
import {
	drawUpsetFooter,
	upsetFooterHeight,
	LEFT_BAND_PX as UPSET_LEFT_BAND_PX,
} from "./draw/draw-upset";
import { drawMatrix, matrixGeom, MATRIX_BADGE_W } from "./draw/draw-matrix";
import type { MatrixLine } from "./draw/draw-matrix";
import { drawHeatmap, heatmapGeom } from "./draw/draw-heatmap";
import { clampSpreadsheetPan } from "./interaction/spreadsheet-pan";
import { drawDroste } from "./draw/draw-droste";
import { layoutStream } from "./layout/stream-layout";
import { drawStream, streamGeom } from "./draw/draw-stream";
import {
	drawLattice,
	latticeCellAt,
	latticeHeaderCheckboxHit,
	latticeNamedRowAt,
	TIER_GUTTER as LATTICE_TIER_GUTTER,
} from "./draw/draw-lattice";
import { latticeNodeAt, lodFor } from "./layout/lattice-layout";
import { drawCard as drawCardFn } from "./draw/draw-card";
import { drawLegend } from "./draw/legend-layout";
import { encodingToSpecs } from "./draw/legend-spec";
import { buildModeLegend, legendAnchor, type ModeLegendInput } from "./draw/mode-legend";
import {
	hitTest as hitTestFn,
	screenToWorld as screenToWorldFn,
	type HoverTarget,
} from "./interaction/hit-test";
import {
	resolveEffectiveQuery,
	resolveEffectiveHaving,
	computeDegreeMaps,
	filterEdgesByAlive,
	filterLayoutData,
	buildAdjacency,
} from "./query/rebuild-pipeline";
import {
	type CardContent,
	computeCardSize,
	computeChannelDims,
	measureCard as measureCardFn,
	minFontScale,
} from "./layout/card-sizing";
import {
	toggleArrayMember as toggleArrayMemberFn,
} from "./panel/panel-sections";

import {
	renderSettingsViewTab,
	renderSettingsDisplayTab,
	renderSettingsEncodeTab,
	renderFilterBodyTab,
} from "./panel/settings-tabs";
import { renderDataTableView } from "./panel/data-table-view";
import { projectMenuNotes, menuLimitedNodes } from "./panel/menu-notes";
import { copyBlobToClipboard, saveBlobToVault, copySvgToClipboard, saveSvgToVault } from "./panel/export-image";
import { SvgRecorderContext } from "./visual/svg-recorder";
import { findGaps, type TagGap } from "./query/gap-finder";
import { findBridges, type BridgeCandidate } from "./query/bridge-finder";
import {
	HOVER_DELAY_MS,
	sameTarget,
	computeHighlight,
	positionTip as positionTipFn,
} from "./interaction/highlight";
import { MarqueeController } from "./interaction/marquee-controller";
import { menuNoteList, menuClickAction, clampRect, noteMenuHeight, buildFolderTree, buildTagTree, advancedSearch, suggestQuery, currentToken, stripTabPrefix, nodeIsHidden, hideKey, collectDescendantNoteKeys, collectDescendantLeaves, folderCheckState, buildFolderPathKey, navigatorNodeSource, type MenuRect, type NoteRef, type TreeNode, type TreeLeaf, type Suggestion } from "./interaction/note-menu";
import { NOTE_MENU_MIN, resolveMenuRect, clampPinnedWidth } from "./interaction/note-menu-geom";
import { zoomAroundPointer, fitTransform } from "./interaction/zoom-math";
import { serializePresets, presetFileName, parsePresets, mergePresets } from "./interaction/preset-io";
import { mergeBundled } from "./interaction/bundled-presets";
import { hitMatrixLine, hitMatrixCol, hitHeatmapCell } from "./interaction/hit-modes";

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
	// PNG export: when true, draw() renders into a detached offscreen canvas and
	// must NOT touch the live DOM (note-navigator panel). `exportDprMul`
	// supersamples by inflating the effective device-pixel-ratio only — zoom is
	// untouched, so LOD decisions match the on-screen figure exactly.
	private exporting = false;
	private exportDprMul = 1;
	private dragging = false;
	private lastX = 0;
	private lastY = 0;
	// Pointer-down position + "moved beyond a click" flag, so a drag (pan /
	// scroll) doesn't fire a click that opens a file.
	private downX = 0;
	private downY = 0;
	private pointerMoved = false;
	private rafId = 0;
	private sessionHiddenLegends = new Set<ViewMode>();
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

	private currentGaps: TagGap[] = [];
	private currentBridges: BridgeCandidate[] = [];

	// Marquee state machine lives in its own controller — the view
	// just queries it (isArmed / isActive) and pumps pointer events.
	private marquee!: MarqueeController;
	private highlightedNodes: Set<string> = new Set();
	private highlightedEdgeIdx: Set<number> = new Set();
	// Clusters to render with accent stroke on hover. Populated from the
	// hovered node's memberships PLUS every connected node's memberships,
	// so aggregate stacks for connected-but-collapsed cards light up too.
	private highlightedClusters: Set<string> = new Set();
	private highlightedHavingClusters: Map<string, number> = new Map();
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
	private activeFileDebounceTimer: number | null = null;
	public isInternalClick = false;
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
	// Which top-level tab the unified menu shows. In-memory only — opening via the toolbar
	// gear always resets to "notes"; a manual switch survives graph rebuilds.
	private activeMenuTab: "data" | "settings" | "insight" = "data";
	// Sensitivity coefficient K for the Insight tab's cognitive-load thresholds
	// (1.0–5.0). In-memory; survives rebuilds, adjustable via the tab's slider.
	private clInsightK = 2.0;
	// Only show the global Notice once per Obsidian session to prevent spam.
	private hasShownCognitiveAlert = false;
	// The live container the settings tab renders into (replaces the old docking
	// panel's `panelEl` as the host that `applyTabFilter`/`renderTabButton` query).
	private settingsHostEl: HTMLElement | null = null;
	private dataHostEl: HTMLElement | null = null;

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
	// Visual Encoding output (computed per rebuild): per-node draw params + legends.
	private encParams: Map<string, NodeDrawParams> = new Map();
	private encLegends: BindingLegend[] = [];
	// F5: cached screen-space rect of the on-canvas legend's × button, set every
	// draw so the click handler can hit-test it. Null when no legend / no close.
	private legendCloseRect: { x: number; y: number; w: number; h: number } | null = null;
	private legendPanelRect: { x: number; y: number; w: number; h: number } | null = null;
	private legendDrag: { dx: number; dy: number } | null = null;
	private legendScrollDrag: { startY: number; startScrollY: number } | null = null;
	private legendScrollY: Partial<Record<ViewMode, number>> = {};
	private legendMaxScrollY = 0;
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
	private settingsSubTab: "view" | "display" | "encode" = "view";
	private dataSubTab: "logic" | "tree" | "table" | "json" = "logic";
	private insightSubTab: "overview" | "alerts" | "suggest" = "overview";
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
	// Action button element for returning to panorama
	private panoramaActionEl: HTMLElement | null = null;
	// Lattice: keys of nodes whose body is expanded into a list of file
	// names (header checkbox checked). Transient — relayout prunes keys
	// whose node no longer exists.
	private latticeNamedKeys: Set<string> = new Set();
	// Heatmap mode: selected cell (tag i × tag j) drawn as an on-canvas
	// crosshair; hovered row/col (-1 = none). Cell clicks open the closeup
	// (switchToCloseup), not a DOM overlay.
	private heatmapSelected: { i: number; j: number } | null = null;
	private heatmapHoverRow = -1;
	private heatmapHoverCol = -1;
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

		// Resolve Obsidian's theme colours into concrete strings for the canvas
		// (Canvas 2D cannot read CSS variables). Re-resolved on `css-change`.
		setTheme(resolveTheme(root));

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
		
		// To place this to the RIGHT of "Zoom in" (assuming Obsidian prepends actions),
		// we must add it BEFORE "Zoom in" so it ends up later in the right-to-left stack.
		this.panoramaActionEl = this.addAction("map", "Return to Panorama view", () => this.switchToPanorama());
		this.updatePanoramaActionVisibility();

		this.addAction("zoom-in", "Zoom in", () => this.zoomBy(1.4));
		this.addAction("zoom-out", "Zoom out", () => this.zoomBy(1 / 1.4));
		this.addAction("maximize", "Fit to view", () => this.fitToView());
		this.addAction("image-down", "Export image (PNG)", (e) => this.openExportMenu(e));

		// 2. Obsidianのfile-openイベントをフック
		this.registerEvent(
			this.app.workspace.on('file-open', (file: TFile | null) => {
				this.handleActiveFileChange(file);
			})
		);

		this.attachInputs();
		this.resizeObs = new ResizeObserver(() => this.resize());
		this.resizeObs.observe(root);

		// Follow live theme / appearance changes: re-resolve base colour and
		// repaint so the canvas tracks Obsidian's base colour immediately.
		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				if (!this.root) return;
				setTheme(resolveTheme(this.root));
				this.requestDraw();
			}),
		);

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
				this.cardCache.delete(f.path);
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

	private handleActiveFileChange(file: TFile | null) {
		// ガード1: 設定が無効な場合は処理をスキップ
		if (!this.settings?.autoFollowActiveNote) return;
		
		// ガード2: Tag Lens内のノードクリックに起因するfile-openイベントは1回スキップ（探索文脈の保護）
		if (this.isInternalClick) { 
			this.isInternalClick = false; 
			return; 
		}
		
		// ガード3: マークダウンファイル以外は処理対象外
		if (!file || file.extension !== 'md') return; 

		// ガード4: パフォーマンス最適化。Tag LensのView自体が現在非表示（裏のタブ、または折りたたまれている）なら計算をスキップ
		if (!this.containerEl.getClientRects().length) return;

		// ガード5: メインエディタからの発火であることを確認（サイドバー等でのファイル開きを検知対象外にする）
		const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
		if (!activeLeaf || activeLeaf.getRoot() !== this.app.workspace.rootSplit) return;

		// 1200msのデバウンス制御（連続タイピングや高速ファイル切り替えによるメインスレッドのブロックを完全防止）
		if (this.activeFileDebounceTimer) {
			window.clearTimeout(this.activeFileDebounceTimer);
		}
		
		this.activeFileDebounceTimer = window.setTimeout(() => {
			void this.updateViewContextToElement(file.path);
		}, 1200);
	}

	private async updateViewContextToElement(activePath: string) {
		// メモリ上のグラフデータ（キャッシュ）の存在チェック。存在しない場合は処理をスキップ
		const currentGraphData: GraphData | null = this.drosteData; 
		if (!currentGraphData || !currentGraphData.nodes) return;

		const activeFile = this.app.vault.getAbstractFileByPath(activePath);
		if (!(activeFile instanceof TFile)) return;

		// 1. アクティブノートのメタデータ（タグ）を取得
		const activeCache = this.app.metadataCache.getFileCache(activeFile);
		const activeTags = activeCache?.tags?.map(t => t.tag.toLowerCase()) || [];
		const activeTagSet = new Set(activeTags);

		// 2. 既存の解決済みリンク（双方向リンク判定用）のマップを取得
		const resolvedLinks = this.app.metadataCache.resolvedLinks;
		
		const settings = this.settings;
		const w_link = settings?.W_link ?? 3.0;
		const w_tag = settings?.W_tag ?? 2.0;
		const maxNeighborhoodSize = settings?.maxNeighborhoodSize ?? 50;

		const scoredNodes: { node: GraphNode; score: number }[] = [];

		// 3. 全ノードに対する関連度スコア計算（O(N)の軽量ループ、buildGraphは呼ばない）
		for (const node of currentGraphData.nodes) {
			// 自分自身（中心ノード）はスコアを無限大にして最優先、かつ一律表示
			if (node.id === activePath) {
				node.score = Infinity;
				node.filtered = false;
				continue;
			}

			// HasLink の判定 (双方向リンクチェック)
			const hasLinkFromActive = (resolvedLinks[activePath] && resolvedLinks[activePath][node.id]) ? 1 : 0;
			const hasLinkToActive = (resolvedLinks[node.id] && resolvedLinks[node.id][activePath]) ? 1 : 0;
			const hasLink = (hasLinkFromActive || hasLinkToActive) ? 1 : 0;

			// Jaccard 係数の計算
			const nodeFile = this.app.vault.getAbstractFileByPath(node.id);
			let jaccard = 0;

			if (nodeFile instanceof TFile) {
				const nodeCache = this.app.metadataCache.getFileCache(nodeFile);
				const nodeTags = nodeCache?.tags?.map(t => t.tag.toLowerCase()) || [];
				const nodeTagSet = new Set(nodeTags);

				if (activeTagSet.size > 0 || nodeTagSet.size > 0) {
					const intersection = new Set([...activeTagSet].filter(x => nodeTagSet.has(x)));
					const union = new Set([...activeTagSet, ...nodeTagSet]);
					jaccard = intersection.size / union.size;
				}
			}

			// 総合スコア算出
			const score = (w_link * hasLink) + (w_tag * jaccard);
			node.score = score;

			if (score > 0) {
				scoredNodes.push({ node, score });
			} else {
				// スコア0（関連なし）のノードはフィルタリングフラグを立てる
				node.filtered = true;
			}
		}

		// 4. スコア降順にソートして上位を絞り込み（トポロジーを維持するため配列からは間引かない）
		scoredNodes.sort((a, b) => b.score - a.score);

		for (let i = 0; i < scoredNodes.length; i++) {
			if (i < maxNeighborhoodSize) {
				// 上位50件は描画対象
				scoredNodes[i].node.filtered = false;
			} else {
				// 50件から漏れた近傍ノードはフィルタリング（非表示/薄色）対象
				scoredNodes[i].node.filtered = true;
			}
		}

		// 5. 既存のレイアウトエンジン・Viewに対して安全に再描画を要求
		// this.drosteFocus は中心にしたいノート
		this.settings.drosteFocus = activePath;
		void this.save();
		this.requestDraw();
	}

	// Open/close the unified menu. Opening always lands on the Notes tab; the
	// menu itself is (re)built by ensureNoteMenu() on the next draw pass.
	private toggleNoteMenu(): void {
		this.settings.noteMenuVisible = !this.settings.noteMenuVisible;
		void this.save();
		if (this.settings.noteMenuVisible) {
			this.activeMenuTab = "data";
			this.dataSubTab = "tree";
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
		// Same clamp as the docked panel itself (note-menu-geom). cw > 0 is
		// guaranteed above, so this matches the old inline Math.min/max exactly.
		return clampPinnedWidth(this.settings.noteMenuPinnedWidth, cw);
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
		subBar.setCssStyles({ display: "flex", flexWrap: "wrap", gap: "1px", marginBottom: "6px", borderBottom: "1px solid var(--background-modifier-border)" });
		const content = host.createDiv({ cls: "gim-panel-content" });
		type SubKey = "view" | "display" | "encode";
		const SUBS: { key: SubKey; label: string }[] = [
			{ key: "view", label: "View" },
			{ key: "display", label: "Display" },
			{ key: "encode", label: "Encode" },
		];
		const subBtns = new Map<string, HTMLElement>();
		const styleSubs = (): void => {
			for (const { key } of SUBS) {
				const b = subBtns.get(key);
				if (!b) continue;
				const on = this.settingsSubTab === key;
				b.setCssStyles({
					background: "transparent", border: "none",
					borderBottom: on ? "2px solid var(--interactive-accent)" : "2px solid transparent",
					borderRadius: "0", padding: "4px 8px", marginBottom: "-1px",
					color: on ? "var(--text-normal)" : "var(--text-muted)", fontWeight: on ? "600" : "400",
					cursor: "pointer", fontSize: "10.5px", lineHeight: "1.3",
				});
			}
		};
		const renderSub = (): void => {
			content.empty();
			switch (this.settingsSubTab) {
				case "view": 
					renderSettingsViewTab(content, {
						settings: this.settings,
						save: () => void this.save(),
						rebuild: () => void this.rebuild(),
						refreshSettingsTab: () => this.refreshSettingsTab(),
						requestDraw: () => this.requestDraw(),
					});
					break;
				case "display": 
					renderSettingsDisplayTab(content, {
						settings: this.settings,
						save: () => void this.save(),
						rebuild: () => void this.rebuild(),
						requestDraw: () => this.requestDraw(),
						refreshSettingsTab: () => this.refreshSettingsTab(),
						scheduleRebuild: () => this.scheduleRebuild(),
						clearCardCache: () => this.cardCache.clear(),
						resolveFromCluster: (groupKey) => this.resolveLayerDisplay(groupKey),
					});
					break;
				case "encode": 
					renderSettingsEncodeTab(content, {
						settings: this.settings,
						save: () => void this.save(),
						rebuild: () => this.rebuild(),
						requestDraw: () => this.requestDraw(),
						refreshSettingsTab: () => this.refreshSettingsTab(),
						encLegends: this.encLegends,
						cardCache: this.cardCache,
						laid: this.laid,
						activeTab: this.activeTab,
						setActiveTab: (t) => { this.activeTab = t; },
						tabFilter: this.tabFilter,
						setTabFilter: (f) => { this.tabFilter = f; },
						clearCardCache: () => this.cardCache.clear(),
						resolveFromCluster: (groupKey) => this.resolveLayerDisplay(groupKey),
					});
					break;
			}
		};
		for (const { key, label } of SUBS) {
			const b = subBar.createEl("button", { text: label });
			subBtns.set(key, b);
			b.addEventListener("click", () => { this.settingsSubTab = key; styleSubs(); renderSub(); });
			b.addEventListener("mouseenter", () => { if (this.settingsSubTab !== key) { b.setCssStyles({ color: "var(--text-muted)" }); b.setCssStyles({ borderBottomColor: "var(--background-modifier-border)" }); } });
			b.addEventListener("mouseleave", () => styleSubs());
		}
		styleSubs();
		renderSub();
	}

	// ── Settings sub-tabs have been extracted to src/panel/settings-tabs.ts ──

	// Re-render the settings tab in place after a settings change. No-op unless
	// the unified menu is open AND currently showing the Settings tab (so a
	// change made elsewhere doesn't force a tab switch). Replaces the old
	// `renderPanel()` self-refresh of the docking panel.
	private refreshSettingsTab(): void {
		if (this.noteMenu && this.activeMenuTab === "settings" && this.settingsHostEl) {
			this.renderSettingsBody(this.settingsHostEl);
		}
	}

	private renderDataLogicBody(host: HTMLElement): void {
		this.dataHostEl = host;
		renderFilterBodyTab(host, {
			settings: this.settings,
			save: () => void this.save(),
			rebuild: () => void this.rebuild(),
			refreshFilterTab: () => this.refreshFilterTab(),
			refreshSettingsTab: () => this.refreshSettingsTab(),
			whereError: this.whereError,
			groupByError: this.groupByError,
			havingError: this.havingError,
			limitError: this.limitError,
			syncLensCommands: (presets) => this.syncLensCommands(presets),
		});
	}

	// Re-register the per-preset command-palette entries after the preset list
	// changes (save / import / bundled). Looks up this plugin instance via the
	// Obsidian app and calls its syncLensCommands if present.
	private syncLensCommands(presets: LensPreset[]): void {
		interface AppWithPlugins {
			plugins?: { plugins?: { "tag-lens"?: { syncLensCommands?: (p: LensPreset[]) => void } } };
		}
		const plugin = (this.app as unknown as AppWithPlugins).plugins?.plugins?.["tag-lens"];
		plugin?.syncLensCommands?.(presets);
	}

	// Data ▸ JSON tab: import/export Lens presets as JSON (F1). `status` shows the
	// outcome of the last import / bundled-load (re-rendered after each).
	private renderDataJsonBody(host: HTMLElement, status?: { msg: string; errors: string[] }): void {
		host.empty();
		const title = host.createDiv({ text: "Presets — JSON import / export" });
		title.setCssStyles({ fontWeight: "600", fontSize: "12px", marginBottom: "6px" });

		// ── Export ──
		const { lensPresets, ...settingsWithoutPresets } = this.settings;
		const presetCount = lensPresets.length;
		const nodeCount = this.laid?.nodes?.length || 0;
		const expLabel = host.createDiv({ text: `Export View State (${nodeCount} node${nodeCount === 1 ? "" : "s"}, ${presetCount} preset${presetCount === 1 ? "" : "s"})` });
		expLabel.setCssStyles({ fontSize: "11px", fontWeight: "600", margin: "4px 0 2px" });

		const exportData = {
			schema: "tag-lens/presets",
			version: 1,
			nodes: this.laid?.nodes || [],
			settings: settingsWithoutPresets,
			presets: lensPresets,
		};
		const json = JSON.stringify(exportData, null, 2);
		const ta = host.createEl("textarea");
		ta.value = json;
		ta.readOnly = true;
		ta.setCssStyles({
			width: "100%", height: "110px", fontFamily: "var(--font-monospace, monospace)",
			fontSize: "10px", resize: "vertical", boxSizing: "border-box",
		});
		ta.addEventListener("mousedown", (ev) => ev.stopPropagation());
		const btnRow = host.createDiv();
		btnRow.setCssStyles({ display: "flex", gap: "6px", marginTop: "4px" });
		const copyBtn = btnRow.createEl("button", { text: "Copy to clipboard" });
		copyBtn.addEventListener("click", (ev) => { ev.stopPropagation(); void this.copyTextToClipboard(json); });
		const saveBtn = btnRow.createEl("button", { text: "Save .json to vault" });
		saveBtn.addEventListener("click", (ev) => { ev.stopPropagation(); void this.savePresetsJson(json); });

		// ── Import ──
		const impLabel = host.createDiv({ text: "Import" });
		impLabel.setCssStyles({ fontSize: "11px", fontWeight: "600", margin: "12px 0 2px" });
		const impTa = host.createEl("textarea");
		impTa.placeholder = "Paste preset JSON here (bundle or array)…";
		impTa.setCssStyles({
			width: "100%", height: "90px", fontFamily: "var(--font-monospace, monospace)",
			fontSize: "10px", resize: "vertical", boxSizing: "border-box",
		});
		impTa.addEventListener("mousedown", (ev) => ev.stopPropagation());
		const impRow = host.createDiv();
		impRow.setCssStyles({ display: "flex", gap: "6px", marginTop: "4px" });
		const importBtn = impRow.createEl("button", { text: "Import" });
		importBtn.addEventListener("click", (ev) => {
			ev.stopPropagation();
			const text = impTa.value.trim();
			if (!text) { this.renderDataJsonBody(host, { msg: "Nothing to import — paste JSON first.", errors: [] }); return; }
			const { presets, errors } = parsePresets(text);
			if (presets.length > 0) {
				this.settings.lensPresets = mergePresets(this.settings.lensPresets, presets);
				void this.save();
				this.syncLensCommands(this.settings.lensPresets);
				this.refreshFilterTab();
			}
			const msg = presets.length > 0
				? `Imported ${presets.length} preset${presets.length === 1 ? "" : "s"}.`
				: "No valid presets found.";
			this.renderDataJsonBody(host, { msg, errors });
		});
		const bundledBtn = impRow.createEl("button", { text: "Load bundled presets" });
		bundledBtn.addEventListener("click", (ev) => {
			ev.stopPropagation();
			const before = this.settings.lensPresets.length;
			this.settings.lensPresets = mergeBundled(this.settings.lensPresets);
			const added = this.settings.lensPresets.length - before;
			void this.save();
			this.syncLensCommands(this.settings.lensPresets);
			this.refreshFilterTab();
			this.renderDataJsonBody(host, { msg: `Added ${added} bundled preset${added === 1 ? "" : "s"}.`, errors: [] });
		});

		// ── Status (last import / bundled-load) ──
		if (status) {
			const st = host.createDiv({ text: status.msg });
			st.setCssStyles({ fontSize: "10.5px", marginTop: "8px", color: status.errors.length ? "var(--text-warning, var(--text-muted))" : "var(--text-muted)" });
			for (const e of status.errors.slice(0, 20)) {
				const line = host.createDiv({ text: `• ${e}` });
				line.setCssStyles({ fontSize: "10px", color: "var(--text-error, var(--text-muted))", paddingLeft: "6px" });
			}
			if (status.errors.length > 20) {
				const more = host.createDiv({ text: `…and ${status.errors.length - 20} more.` });
				more.setCssStyles({ fontSize: "10px", color: "var(--text-muted)", paddingLeft: "6px" });
			}
		}
	}

	private async copyTextToClipboard(text: string): Promise<void> {
		const clip = (activeWindow as unknown as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator?.clipboard;
		if (!clip?.writeText) { new Notice("Tag Lens: clipboard unavailable."); return; }
		try {
			await clip.writeText(text);
			new Notice("Tag Lens: presets copied to clipboard.");
		} catch (e) {
			new Notice("Tag Lens: clipboard copy failed.");
			console.error("[tag-lens] preset clipboard copy failed:", e);
		}
	}

	private async savePresetsJson(json: string): Promise<void> {
		try {
			const fm = this.app.fileManager as unknown as {
				getAvailablePathForAttachment?: (n: string, src?: string) => Promise<string> | string;
			};
			let path = presetFileName(new Date());
			if (typeof fm.getAvailablePathForAttachment === "function") {
				path = await fm.getAvailablePathForAttachment(path, "");
			}
			const file = await this.app.vault.create(path, json);
			new Notice(`Tag Lens: presets saved to ${file.path}`);
		} catch (e) {
			new Notice(`Tag Lens: failed to save presets — ${e instanceof Error ? e.message : String(e)}`);
			console.error("[tag-lens] save presets failed:", e);
		}
	}

	private refreshFilterTab(): void {
		if (this.noteMenu && this.activeMenuTab === "data" && this.dataHostEl) {
			this.renderDataLogicBody(this.dataHostEl);
		}
	}


	private toggleArrayMember(
		field: "hiddenNodes" | "aggregatedLayers",
		value: string,
		present: boolean,
	): void {
		toggleArrayMemberFn(this.settings, field, value, present);
	}

	// Resolve a cluster's "rendered" NODE_DISPLAY (= what the inheritance
	// chain produces when this cluster has no override) so the per-layer
	// panel can show it as placeholder text and the user can tell what
	// they're overriding.
	private resolveFromCluster(groupKey: string): NodeDisplay {
		return resolveFromClusterFn(groupKey, this.nodeDisplayDeps());
	}

	// Resolve NODE_DISPLAY for a synthetic ∩/∪ set-layer. Single-tag clusters
	// are SUPERSETS of these layers, so single-set settings cascade. When the
	// key is in `layerInheritFull` the layer's OWN overrides are ignored and it
	// resolves purely via inheritFrom → superset → global (FULL inheritance);
	// otherwise its own overrides apply where set (PARTIAL override).
	// Panel-facing resolver: dispatches the synthetic ∩/∪ set-layer keys to
	// resolveSetLayer (which honours layerInheritFull + superset cascade) and
	// every real cluster key to the standard chain.
	private resolveLayerDisplay(groupKey: string): NodeDisplay {
		if (groupKey === UNION_LAYER_KEY || groupKey === INTERSECTION_LAYER_KEY) {
			return this.resolveSetLayer(groupKey);
		}
		return this.resolveFromCluster(groupKey);
	}

	private resolveSetLayer(setKey: string): NodeDisplay {
		const base = this.nodeDisplayDeps();
		const supers = new Map(base.supersetsOf);
		// Real single-tag clusters are supersets of the set-layers.
		supers.set(setKey, (this.laid.clusters ?? []).map((c) => c.groupKey));
		const full = this.settings.layerInheritFull?.includes(setKey) ?? false;
		const overrides = full
			? Object.fromEntries(Object.entries(base.overrides).filter(([k]) => k !== setKey))
			: base.overrides;
		return resolveFromClusterFn(setKey, { ...base, overrides, supersetsOf: supers });
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
		const { effGroupBy, effWhere, filterMode, dvjsFilter } = resolveEffectiveQuery(this.settings);
		const { result, errors } = buildGraph(
			this.app,
			effWhere,
			effGroupBy,
			filterMode,
			dvjsFilter,
			this.settings.focusNodeIds,
			// Prevent recursive expansion in closeup view. The focused nodes
			// already include the relevant neighborhood from the panorama state.
			this.settings.focusNodeIds ? false : this.settings.expandNeighborhood
		);
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
				const { computeCognitiveLoad } = await import("./insight/compute");
				const cl = computeCognitiveLoad(this.app, this.clInsightK);
				if (cl.score >= 80) { // High / Critical
					new Notice("⚠️ Cognitive Load is CRITICAL. Please check the Insight tab in Tag Lens for advice.", 8000);
					this.hasShownCognitiveAlert = true;
				}
			} catch (e) {
				// Don't let a metric error abort the rebuild, but surface it —
				// a silent swallow here hid cognitive-load regressions before.
				console.error("[tag-lens] cognitive-load metric failed:", e);
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
		const { dropped, errors: havingErrors } = this.computeDroppedClusters(
			data.nodes,
			effHaving,
			effHavingAuto,
		);
		if (havingErrors.length > 0) this.havingError = havingErrors.join("; ");
		else this.havingError = "";

		if (this.settings.havingMode === "highlight") {
			this.highlightedHavingClusters = dropped;
		} else {
			this.highlightedHavingClusters.clear();
			if (dropped.size > 0) {
				const droppedSet = new Set(dropped.keys());
				data = filterMemberships(data, droppedSet);
				clusterLabels = filterLabels(clusterLabels, droppedSet);
			}
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
			limitedNodes: menuLimitedNodes(menuSourceData, {
				app: this.app,
				settings: this.settings,
				tiers: this.parseLimitRules(),
			}),
		});
		this.menuNotes = projectMenuNotes(menuNodeSource, this.app);

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

		// Visual Encoding: map displayed nodes' attributes -> per-node draw params.
		// Runs BEFORE `cardFor` so the physical pixel dimensions of the cards
		// (derived from `sizeScale`) are available to the layout engine.
		const encCtx: EncContext = {
			nowMs: Date.now(),
			degreeOf: (id) => {
				const d = this.degreeMap.get(id);
				if (d == null) return undefined;
				return {
					inDeg: this.inDegreeMap.get(id) ?? 0,
					outDeg: this.outDegreeMap.get(id) ?? 0,
					degree: d,
				};
			},
			frontmatterOf: (id) => {
				const f = this.app.vault.getAbstractFileByPath(id);
				return f instanceof TFile
					? (this.app.metadataCache.getFileCache(f)?.frontmatter as Record<string, unknown> | undefined)
					: undefined;
			},
		};
		const effEnc = effectiveEncoding(this.settings.encoding, this.settings);
		const encRes = evaluateEncoding(layoutData.nodes, effEnc, encCtx, this.settings.viewMode);
		this.encParams = encRes.params;
		this.encLegends = encRes.legends;

		// Card sizes derive from the user-configured row × column span
		// times the canonical CARD_CELL_W × CARD_CELL_H lattice step, with
		// an optional encoding-driven scale that preserves the m : n aspect.
		const sized = layoutData.nodes.map((n) => this.cardFor(n));
		const wasEmpty = this.laid.clusters.length === 0;
		// Seed the bipartite force layout from the previous frame's positions
		// (only when the outgoing layout WAS bipartite) so a tag-count change
		// nudges nodes instead of teleporting them.
		const bipartitePrev = this.laid?.setNodeIds
			? new Map(this.laid.nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
			: undefined;

		this.currentBridges = [];
		if (this.settings.showGhostEdges) {
			const linkedPairs = new Set<string>();
			for (const e of layoutData.edges) {
				const a = e.source < e.target ? e.source : e.target;
				const b = e.source < e.target ? e.target : e.source;
				linkedPairs.add(`${a}|${b}`);
			}
			const bridgeNodes = layoutData.nodes.map(n => ({ id: n.id, tags: n.memberships }));
			this.currentBridges = findBridges(
				bridgeNodes,
				linkedPairs,
				this.settings.ghostEdgeMinJaccard,
				50
			);
		}

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
			latticeNodeLOD: "auto",
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
			heatmapCriterion: this.settings.heatmapCriterion,
			heatmapSortDir: this.settings.heatmapSortDir,
			ghostBridges: this.settings.showGhostEdges ? this.currentBridges : undefined,
		});

		this.currentGaps = [];
		if (this.settings.gapFinder && this.settings.viewMode === "heatmap" && this.laid.heatmap) {
			this.currentGaps = findGaps(
				this.laid.heatmap.tags,
				this.laid.heatmap.counts,
				this.laid.heatmap.n,
				this.laid.heatmap.totalNotes,
				50
			);
		}

		if (this.settings.viewMode === "stream") {
			this.laid.stream = layoutStream(data, {
				axisField: this.settings.streamAxisField,
				binning: this.settings.streamBinning,
				rowSort: this.settings.streamRowSort,
				deps: {
					app: this.app,
					degreeMap: this.degreeMap,
					membershipsOf: (id) => this.laid.nodes.find((n) => n.id === id)?.memberships,
				}
			});
		} else {
			this.laid.stream = undefined;
		}
		// Stage 5: id → incident-edge-index adjacency for hover lookups.
		this.adjacency = buildAdjacency(this.laid.edges);

		// Custom axis layout (Encode → Position X/Y): override card placement when
		// axisX/axisY are bound. Reads only — never changes the displayed node set.
		// Runs AFTER layout because it requires `this.laid.slotW` to compute coordinates.
		this.applyAxisLayout(effEnc, encCtx);



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
		// Keep the "Return to Panorama" toolbar button in sync with
		// settings.perspective regardless of which code path drove this
		// rebuild (toolbar buttons, drill-down, or the View mode radios in
		// the settings panel).
		this.updatePanoramaActionVisibility();
		this.requestDraw();
		this.refreshSettingsTab();
	}
	private applyAxisLayout(effEnc: EncodingBinding[], encCtx: EncContext): void {
		const bindingX = effEnc.find((b) => b.channelId === "axisX");
		const bindingY = effEnc.find((b) => b.channelId === "axisY");
		if (!bindingX?.enabled && !bindingY?.enabled) {
			this.laid.axes = undefined;
			return;
		}

		// Icon Gallery (droste): a bespoke (col,row) tile grid, not the card lattice.
		// Re-assign each cell's (col,row) from the axes (cells stay; positions only).
		if (this.settings.viewMode === "droste") {
			this.applyDrosteAxisLayout(bindingX, bindingY);
			return;
		}

		const isCardMode =
			this.settings.viewMode === "euler" ||
			this.settings.viewMode === "euler-true" ||
			this.settings.viewMode === "euler-venn" ||
			this.settings.viewMode === "bipartite" ||
			this.settings.viewMode === "bubblesets";

		if (!isCardMode) {
			this.laid.axes = undefined;
			return;
		}

		let nSpan = Math.max(20, Math.ceil(Math.sqrt(this.laid.nodes.length)) * 4);
		if (nSpan % 2 !== 0) nSpan += 1; // Force even to ensure integer cx/cy
		const fallbackWidth = nSpan * this.laid.slotW;
		const fallbackHeight = nSpan * this.laid.slotH;

		const { positions, axes, width: finalWidth, height: finalHeight } = axisLayout(this.laid.nodes, encCtx, {
			bindingX: bindingX?.enabled ? bindingX : undefined,
			bindingY: bindingY?.enabled ? bindingY : undefined,
			width: fallbackWidth,
			height: fallbackHeight,
			cell: { w: this.laid.slotW, h: this.laid.slotH },
			measureText: (text, font) => this.measureLatticeText(text, font),
		});

		const cx = finalWidth / 2;
		const cy = finalHeight / 2;

		for (const n of this.laid.nodes) {
			const pos = positions.get(n.id);
			if (pos) {
				n.x = pos.x - cx;
				n.y = pos.y - cy;
			}
		}

		const shiftSpec = (spec: AxisSpec | undefined, offset: number): AxisSpec | undefined => {
			if (!spec) return undefined;
			const out = { ...spec };
			if (out.bands) out.bands = out.bands.map((b: AxisBand) => ({ ...b, start: b.start - offset, end: b.end - offset, center: b.center - offset }));
			if (out.ticks) out.ticks = out.ticks.map((t: AxisTick) => ({ ...t, pos: t.pos - offset }));
			return out;
		};

		this.laid.axes = {
			x: shiftSpec(axes.x, cx),
			y: shiftSpec(axes.y, cy),
		};

		if (this.laid.clusters && this.laid.clusters.length > 0) {
			const { clusters } = computeClusterBBoxes(this.laid.nodes, {
				clusterKeys: this.laid.clusters.map((c) => c.groupKey),
				labels: this.clusterLabels,
				slotW: this.laid.slotW,
				slotH: this.laid.slotH,
				channelW: this.laid.channelW,
				channelH: this.laid.channelH,
				clusterSpacing: this.settings.clusterSpacing,
			});
			this.laid.clusters = clusters;
		}

		if (this.laid.edges && this.laid.edges.length > 0) {
			const idToRect = buildIdToRect(this.laid.nodes);
			const routeObstacles = buildRouteObstacles(this.laid.nodes, this.laid.slotW, this.laid.slotH);
			const lanes = new LaneRegistry();
			for (const e of this.laid.edges) {
				const a = idToRect.get(e.source);
				const b = idToRect.get(e.target);
				if (!a || !b) continue;
				let path = routeZ(
					a,
					b,
					lanes,
					this.laid.slotW,
					this.laid.slotH,
					this.laid.channelW,
					this.laid.channelH,
					routeObstacles,
					e.source,
					e.target,
				);
				if (!path || path.length < 2) path = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
				e.path = path;
			}
			if (this.laid.ghostEdges) {
				for (const e of this.laid.ghostEdges) {
					const a = idToRect.get(e.source);
					const b = idToRect.get(e.target);
					if (!a || !b) continue;
					let path = routeZ(
						a,
						b,
						lanes,
						this.laid.slotW,
						this.laid.slotH,
						this.laid.channelW,
						this.laid.channelH,
						routeObstacles,
						e.source,
						e.target,
					);
					if (!path || path.length < 2) path = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
					e.path = path;
				}
			}
		}
	}

	// Icon Gallery (droste) custom-axis Cartesian layout. Re-assigns every gallery
	// cell's (col,row) from the bound axes and stores the band/tick geometry on the
	// gallery so drawDroste paints variable-width gridlines + labels. NEVER changes
	// which cells are shown — positions only (selection non-interference invariant).
	// When NO axis is bound the early guard in applyAxisLayout never reaches here, so
	// the gallery keeps the fresh default contact-sheet tiling from buildGallery.
	private applyDrosteAxisLayout(
		bindingX: EncodingBinding | undefined,
		bindingY: EncodingBinding | undefined,
	): void {
		this.laid.axes = undefined;
		const g = this.laid.drosteGallery;
		if (!g || g.cells.length === 0) {
			if (g) g.axes = undefined;
			return;
		}

		// EncNode per cell from the FULL gallery graph snapshot (drosteData), so
		// mtime/status/maturity/ageDays/tags are all available. Fall back to a
		// memberships-only node from the gallery index if the graph snapshot is
		// missing (keeps tag/degree axes working without it).
		const nodeById = new Map<string, GraphNode>();
		for (const n of this.drosteData?.nodes ?? []) nodeById.set(n.id, n);
		const nodeFor = (id: string): EncNode => {
			const n = nodeById.get(id);
			if (n) {
				return {
					id: n.id,
					label: n.label,
					memberships: n.memberships,
					mtime: n.mtime,
					fmMaturity: n.fmMaturity,
					isPeripheral: n.isPeripheral,
				};
			}
			return { id, memberships: g.nodeKeys.get(id) ?? [], label: g.nodeLabel.get(id) };
		};

		// Degree from the FULL gallery adjacency (links + backlinks), so the degree
		// axis reflects the whole vault the gallery bakes — not the LIMIT-trimmed
		// edge set used by the other modes' encCtx.
		const degreeOf = (id: string) => {
			const out = (g.links.get(id) ?? []).length;
			const inc = (g.backlinks.get(id) ?? []).length;
			return { inDeg: inc, outDeg: out, degree: inc + out };
		};
		const ctx: EncContext = {
			nowMs: Date.now(),
			degreeOf,
			frontmatterOf: (id) => {
				const f = this.app.vault.getAbstractFileByPath(id);
				return f instanceof TFile
					? (this.app.metadataCache.getFileCache(f)?.frontmatter as Record<string, unknown> | undefined)
					: undefined;
			},
		};

		const res = assignGalleryAxes(
			g.cells,
			nodeFor,
			ctx,
			bindingX?.enabled ? bindingX : undefined,
			bindingY?.enabled ? bindingY : undefined,
		);
		for (const cell of g.cells) {
			const p = res.pos.get(cell.id);
			if (p) {
				cell.col = p.col;
				cell.row = p.row;
			}
		}
		g.cols = res.cols;
		g.rows = res.rows;
		g.axes = res.axes;
		// laid.axes stays undefined: droste draws its own grid (column/row units →
		// cellSize world coords), distinct from the card lattice's world-coord grid.
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
	): { dropped: Map<string, number>; errors: string[] } {
		const { dropped, errors } = computeDroppedClustersFn(
			nodes,
			rawRows,
			havingAutoOverride ?? this.settings.havingAuto,
		);
		this.havingError = errors.length > 0 ? errors.join("; ") : "";
		return { dropped, errors };
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
		const scaleFactor = this.encParams.get(nodeId)?.sizeScale ?? 1.0;
		return visualScale(display, scaleFactor, {
			nodeRows: this.settings.nodeRows,
			nodeCols: this.settings.nodeCols,
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
			scaleFactor: this.encParams.get(n.id)?.sizeScale ?? 1.0,
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
			},
		};
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

	// ── PNG export ──────────────────────────────────────────────────────────
	// A native menu off the toolbar "image-down" action. Kept flat (no submenus)
	// so it works on minAppVersion 1.5.0.
	private openExportMenu(evt: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle("Copy view to clipboard")
				.setIcon("copy")
				.onClick(() => void this.exportImage({ scale: 2, fit: false, target: "clipboard" })),
		);
		menu.addItem((i) =>
			i
				.setTitle("Save view as PNG (2×)")
				.setIcon("image-down")
				.onClick(() => void this.exportImage({ scale: 2, fit: false, target: "vault" })),
		);
		menu.addItem((i) =>
			i
				.setTitle("Save view as PNG (4×)")
				.setIcon("image-down")
				.onClick(() => void this.exportImage({ scale: 4, fit: false, target: "vault" })),
		);
		menu.addItem((i) =>
			i
				.setTitle("Save whole figure as PNG (2×)")
				.setIcon("maximize")
				.onClick(() => void this.exportImage({ scale: 2, fit: true, target: "vault" })),
		);
		menu.addSeparator();
		// Vector (SVG) — resolution-independent, reuses the same draw() pipeline.
		menu.addItem((i) =>
			i
				.setTitle("Copy view as SVG")
				.setIcon("copy")
				.onClick(() => void this.exportSvg({ fit: false, target: "clipboard" })),
		);
		menu.addItem((i) =>
			i
				.setTitle("Save view as SVG")
				.setIcon("file-code")
				.onClick(() => void this.exportSvg({ fit: false, target: "vault" })),
		);
		menu.addItem((i) =>
			i
				.setTitle("Save whole figure as SVG")
				.setIcon("maximize")
				.onClick(() => void this.exportSvg({ fit: true, target: "vault" })),
		);
		menu.showAtMouseEvent(evt);
	}

	// Render the current figure into a detached, supersampled offscreen canvas
	// and either copy it to the clipboard or save it into the vault. The on-DOM
	// canvas, zoom and pan are never mutated except for an optional fit-to-figure
	// reframe (restored afterwards).
	private async exportImage(opts: {
		scale: number;
		fit: boolean;
		target: "vault" | "clipboard";
	}): Promise<void> {
		if (this.exporting) return;

		const savedZoom = this.zoom;
		const savedPanX = this.panX;
		const savedPanY = this.panY;
		// "Whole figure" reframes the LIVE canvas first (fitToView reads its real
		// clientWidth/Height), then we restore the user's view at the end.
		if (opts.fit) this.fitToView();

		const srcW = this.canvas.width;
		const srcH = this.canvas.height;
		const dims = exportCanvasDims(srcW, srcH, opts.scale);
		if (dims.scale < opts.scale - 1e-6) {
			new Notice(
				`Tag Lens: export limited to ${dims.scale.toFixed(1)}× (canvas size cap).`,
			);
		}

		const off = this.canvas.ownerDocument.createElement("canvas");
		off.width = dims.width;
		off.height = dims.height;
		const offCtx = off.getContext("2d");
		if (!offCtx) {
			new Notice("Tag Lens: image export failed (no 2D context).");
			this.zoom = savedZoom;
			this.panX = savedPanX;
			this.panY = savedPanY;
			this.requestDraw();
			return;
		}

		const savedCanvas = this.canvas;
		const savedCtx = this.ctx;
		this.exporting = true;
		this.exportDprMul = dims.scale;
		this.canvas = off;
		this.ctx = offCtx;
		try {
			this.draw();
		} catch (e) {
			console.error("[tag-lens] export render failed:", e);
		} finally {
			this.canvas = savedCanvas;
			this.ctx = savedCtx;
			this.exporting = false;
			this.exportDprMul = 1;
			this.zoom = savedZoom;
			this.panX = savedPanX;
			this.panY = savedPanY;
		}

		const blob = await new Promise<Blob | null>((res) =>
			off.toBlob((b) => res(b), "image/png"),
		);
		this.requestDraw();
		if (!blob) {
			new Notice("Tag Lens: image export failed (encode).");
			return;
		}

		const ioDeps = { app: this.app, viewMode: this.settings.viewMode };
		if (opts.target === "clipboard") {
			await copyBlobToClipboard(blob, ioDeps);
		} else {
			await saveBlobToVault(blob, ioDeps);
		}
	}

	// Vector export. Same strategy as exportImage(): swap ctx for an
	// SvgRecorderContext (a Canvas2D-compatible recorder) and replay the existing
	// draw() pipeline — no per-mode duplication. The on-DOM canvas/zoom/pan are
	// restored afterwards (an optional fit-to-figure reframe is undone too).
	private async exportSvg(opts: { fit: boolean; target: "vault" | "clipboard" }): Promise<void> {
		if (this.exporting) return;

		const savedZoom = this.zoom;
		const savedPanX = this.panX;
		const savedPanY = this.panY;
		if (opts.fit) this.fitToView();

		const w = this.canvas.width;
		const h = this.canvas.height;
		// A real offscreen canvas backs accurate measureText() (font-dependent
		// widths) AND stands in for this.canvas (ownerDocument, width/height) so
		// draw() and the per-mode helpers behave exactly as in the PNG path.
		const off = this.canvas.ownerDocument.createElement("canvas");
		off.width = w;
		off.height = h;
		const measCtx = off.getContext("2d");
		const measure = (text: string, font: string): number => {
			if (!measCtx) return text.length * 6;
			measCtx.font = font;
			return measCtx.measureText(text).width;
		};
		const rec = new SvgRecorderContext(w, h, measure);

		const savedCanvas = this.canvas;
		const savedCtx = this.ctx;
		this.exporting = true;
		this.exportDprMul = 1;
		this.canvas = off;
		this.ctx = rec as unknown as CanvasRenderingContext2D;
		let svg = "";
		try {
			this.draw();
			svg = rec.toSvg();
		} catch (e) {
			console.error("[tag-lens] SVG export render failed:", e);
		} finally {
			this.canvas = savedCanvas;
			this.ctx = savedCtx;
			this.exporting = false;
			this.exportDprMul = 1;
			this.zoom = savedZoom;
			this.panX = savedPanX;
			this.panY = savedPanY;
		}

		this.requestDraw();
		if (!svg) {
			new Notice("Tag Lens: SVG export failed (render).");
			return;
		}

		const ioDeps = { app: this.app, viewMode: this.settings.viewMode };
		if (opts.target === "clipboard") {
			await copySvgToClipboard(svg, ioDeps);
		} else {
			await saveSvgToVault(svg, ioDeps);
		}
	}

	private zoomBy(factor: number): void {
		const rect = this.canvas.getBoundingClientRect();
		const sx = rect.width / 2;
		const sy = rect.height / 2;
		const t = zoomAroundPointer({ zoom: this.zoom, panX: this.panX, panY: this.panY }, factor, sx, sy);
		this.zoom = t.zoom;
		this.panX = t.panX;
		this.panY = t.panY;
		this.cancelHover();
		this.requestDraw();
	}

	private fitToRect(world: { minX: number; minY: number; maxX: number; maxY: number }): void {
		const t = fitTransform(world, this.canvas.clientWidth, this.canvas.clientHeight, 24);
		this.zoom = t.zoom;
		this.panX = t.panX;
		this.panY = t.panY;
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
		// Connection matrix / heatmap: these screen-space frozen-pane grids are
		// drawn AND hit-tested across the FULL canvas width (drawMatrix/drawHeatmap
		// use canvas.width/dpr; matrixColAt/heatmapCellAt use canvas.clientWidth) —
		// the pinned note menu is an overlay, it does not narrow the canvas. So the
		// clamp must compute geometry with the same full clientWidth, NOT
		// clientWidth-panelW; otherwise the panel-narrowed width yields a smaller
		// labelBand and clamps panX to the left of the drawn label band, hiding the
		// first column(s) and shifting every click off by ≥1 cell (clicking the
		// apparent "battle" diagonal lands on a different tag's cell).
		const fullW = Math.max(1, this.canvas.clientWidth);
		const fullH = this.canvas.clientHeight;

		if (this.laid.matrix) {
			const m = this.laid.matrix;
			const g = matrixGeom(m, this.zoom, fullW);
			const colsW = m.cols.length * g.colScreenW;
			const rowsH = this.matrixLines.length * g.rowScreenH; // floored pitch
			const c = clampSpreadsheetPan(this.panX, this.panY, g.labelBand, g.headerH, colsW, rowsH, fullW, fullH);
			this.panX = c.panX;
			this.panY = c.panY;
			return;
		}
		if (this.laid.heatmap) {
			// Spreadsheet scroll over the square grid.
			const h = this.laid.heatmap;
			const g = heatmapGeom(h, this.zoom, fullW);
			const grid = h.n * g.cellPx;
			const c = clampSpreadsheetPan(this.panX, this.panY, g.labelBand, g.headerH, grid, grid, fullW, fullH);
			this.panX = c.panX;
			this.panY = c.panY;
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

	private drawGlobalDisplayFallbacks(ctx: CanvasRenderingContext2D, dpr: number, mode: string): void {
		const cw = this.canvas.width;
		const ch = this.canvas.height;
		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const baseAlpha = 0.05;

		const isEuler = mode === "euler" || mode === "euler-true" || mode === "euler-venn" || mode === "bubblesets";

		// 1. showGrid: draw a subtle background grid.
		// Exclude euler since it natively draws a strong grid. Droste draws its own
		// Cartesian cell grid (drawDefaultGrid / drawAxisGrid). Matrix/Heatmap don't have native grid.
		if (this.settings.showGrid && !isEuler && mode !== "droste") {
			ctx.strokeStyle = `rgba(128, 128, 128, ${baseAlpha * 2})`;
			ctx.lineWidth = 1;
			ctx.beginPath();
			for (let x = 0; x < cw / dpr; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, ch / dpr); }
			for (let y = 0; y < ch / dpr; y += 40) { ctx.moveTo(0, y); ctx.lineTo(cw / dpr, y); }
			ctx.stroke();
		}

		// 2. showEnclosures: draw a bounding box around the canvas
		// Exclude euler since it natively has enclosures.
		if (this.settings.showEnclosures && !isEuler) {
			ctx.strokeStyle = `rgba(255, 128, 0, ${baseAlpha * 4})`;
			ctx.lineWidth = 4;
			ctx.strokeRect(4, 4, cw / dpr - 8, ch / dpr - 8);
		}

		// 3. showEdges: decorative faint connecting lines from corners
		// Exclude euler/bipartite since they draw native edges.
		if (this.settings.showEdges && !isEuler && mode !== "bipartite") {
			ctx.strokeStyle = `rgba(0, 128, 255, ${baseAlpha})`;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(0, 0); ctx.lineTo(cw / dpr, ch / dpr);
			ctx.moveTo(cw / dpr, 0); ctx.lineTo(0, ch / dpr);
			ctx.stroke();
		}

		// 4. showNodes: small badge in top right
		// Exclude euler/bipartite/upset/bubblesets since they natively draw nodes.
		if (this.settings.showNodes && !isEuler && mode !== "bipartite" && mode !== "upset") {
			ctx.fillStyle = `rgba(100, 100, 100, ${baseAlpha * 10})`;
			const tw = ctx.measureText(`${this.laid.nodes?.length ?? 0} nodes`).width;
			ctx.fillRect(cw / dpr - tw - 20, 10, tw + 10, 20);
			ctx.fillStyle = "white";
			ctx.font = "10px sans-serif";
			ctx.fillText(`${this.laid.nodes?.length ?? 0} nodes`, cw / dpr - tw - 15, 24);
		}

		// 5. Meta indicator badges
		// Apply to ALL modes if activated, stacking them vertically on the left side.
		let badgeY = 10;
		const drawBadge = (label: string, color: string) => {
			ctx.fillStyle = color;
			const bw = ctx.measureText(label).width + 12;
			ctx.fillRect(10, badgeY, bw, 20);
			ctx.fillStyle = "white";
			ctx.font = "10px sans-serif";
			ctx.fillText(label, 16, badgeY + 14);
			badgeY += 24;
		};

		if (this.settings.showMaturity) drawBadge("Maturity: ON", "rgba(0, 150, 0, 0.8)");
		// Node size fallback badge for modes that don't scale cards natively
		if (!isEuler && mode !== "bipartite" && mode !== "upset") {
			if (this.settings.nodeRows !== 1 || this.settings.nodeCols !== 1) {
				drawBadge(`Size: ${this.settings.nodeRows}x${this.settings.nodeCols}`, "rgba(50, 150, 200, 0.8)");
			}
		}

		if (mode === "stream") {
			if (this.settings.streamAxisField !== "none") drawBadge(`Axis: ${this.settings.streamAxisField}`, "rgba(100, 100, 0, 0.8)");
			if (this.settings.streamBinning !== "value") drawBadge(`Bin: ${this.settings.streamBinning}`, "rgba(0, 100, 100, 0.8)");
			if (this.settings.streamRowSort !== "size") drawBadge(`Sort: ${this.settings.streamRowSort}`, "rgba(100, 0, 0, 0.8)");
		}

		if (mode === "heatmap" && this.settings.heatmapJaccard) {
			drawBadge("Jaccard: ON", "rgba(100, 100, 100, 0.8)");
		}

		// F5: per-mode on-canvas legend. Pure overlay — never affects figure/selection.
		const vmode = mode as ViewMode;
		if (this.settings.showLegend && !this.sessionHiddenLegends.has(vmode)) {
			const t = theme();
			const specs = buildModeLegend(vmode, this.buildModeLegendInput());
			if (specs.length) {
				// Reserve a bottom inset so a bottom-anchored legend clears Obsidian's
				// status bar (≈24px) instead of being clipped off-screen.
				const usableH = ch / dpr - 24;
				const render = drawLegend(
					ctx, specs, cw / dpr, usableH, legendAnchor(vmode), 10,
					{ panelBg: colorAlpha(t.panelBg, 0.92), border: t.border, text: t.textNormal, textMuted: t.textMuted },
					{ scrollY: this.legendScrollY[vmode] ?? 0, maxH: Math.min(350, usableH) },
					this.exportDprMul === 1, // show the × only when NOT exporting
					this.settings.legendPos?.[vmode], // dragged position (clamped on-screen) if set
				);
				this.legendCloseRect = render.closeRect;
				this.legendPanelRect = render.panelRect;
				this.legendMaxScrollY = render.maxScrollY;
			} else {
				this.legendCloseRect = null;
				this.legendPanelRect = null;
				this.legendMaxScrollY = 0;
			}
		} else {
			this.legendCloseRect = null;
			this.legendPanelRect = null;
		}

		ctx.restore();
	}

	private requestDraw(): void {
		this.clampPan();
		cancelAnimationFrame(this.rafId);
		this.rafId = window.requestAnimationFrame(() => this.draw());
	}

	private draw(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		// `exportDprMul` is 1 during normal painting; >1 only while exportImage()
		// renders into the offscreen canvas, so every sub-draw supersamples
		// uniformly without any per-mode special-casing.
		const dpr = (activeWindow.devicePixelRatio || 1) * this.exportDprMul;
		const cw = this.canvas.width;
		const ch = this.canvas.height;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = theme().canvasBg;
		ctx.fillRect(0, 0, cw, ch);
		// Mode-agnostic note navigator (folder tree + search). Built once per
		// rebuild; shown in EVERY view mode. It self-suppresses when there are
		// zero notes. Sits top-left, the same slot as the old Icon Gallery menu.
		// ISOLATED: the navigator must NEVER prevent the figure from drawing — a
		// throw here (seen on mobile) used to abort the whole draw, leaving the
		// canvas blank. Catch it, keep drawing, and surface the cause in a banner.
		this.noteMenuError = null;
		// The note navigator is live-view DOM, not part of the export bitmap, and
		// rebuilding it against a detached canvas would throw — skip it on export.
		if (!this.exporting) {
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
				dpr,
				selectedCol: this.matrixSelectedCol,
				minFontPx: this.settings.minFontPx,
				lines: this.matrixLines,
				group: this.settings.matrixGroupBySignature,
				hoverLine: this.matrixHoverLine,
				hoverCol: this.matrixHoverCol,
			});
			this.drawGlobalDisplayFallbacks(ctx, dpr, "matrix");
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
					latticeNodeLOD: "auto",
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
			this.drawGlobalDisplayFallbacks(ctx, dpr, "lattice");
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
			this.drawGlobalDisplayFallbacks(ctx, dpr, "droste");
			return;
		}
		// Tag co-occurrence heatmap: screen-space frozen-pane cell grid.
		if (this.laid.heatmap && this.laid.heatmap.n > 0) {
			drawHeatmap(ctx, this.laid.heatmap, {
				zoom: this.zoom,
				panX: this.panX,
				panY: this.panY,
				canvas: this.canvas,
				dpr,
				minFontPx: this.settings.minFontPx,
				jaccard: this.settings.heatmapJaccard,
				// gapFinder toggles the dashed "missing intersection" overlay;
				// this.currentGaps is computed in rebuild() via findGaps when the
				// toggle is on (empty otherwise).
				gapFinder: this.settings.gapFinder,
				gaps: this.currentGaps,
				selected: this.heatmapSelected,
				hoverRow: this.heatmapHoverRow,
				hoverCol: this.heatmapHoverCol,
			});
			this.drawGlobalDisplayFallbacks(ctx, dpr, "heatmap");
			return;
		}
		
		if (this.settings.viewMode === "stream" && this.laid.stream) {
			const geom = streamGeom(this.laid.stream, this.canvas.clientWidth, this.canvas.clientHeight);
			drawStream(ctx, this.laid, this.laid.stream, geom, this.settings.minFontPx, theme().isDark ? "dark" : "light");
			
			// Highlight hovered stream cell if any
			if (this.hoveredNodeId?.startsWith("stream-cell:")) {
				const parts = this.hoveredNodeId.split(":");
				const r = parseInt(parts[2], 10);
				const c = parseInt(parts[3], 10);
				const cx = geom.x0 + c * geom.colWidth + geom.colWidth / 2;
				const cy = geom.y0 + r * geom.rowHeight + geom.rowHeight / 2;
				
				ctx.strokeStyle = "#ffffff";
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.arc(cx, cy, geom.cellSize / 2 + 2, 0, Math.PI * 2);
				ctx.stroke();
			}
			this.drawGlobalDisplayFallbacks(ctx, dpr, "stream");
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
			ctx.fillStyle = theme().textFaint;
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
		if (this.settings.showGrid && !this.laid.setNodeIds && !this.laid.upset) {
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
		// Visible range is locked to a single period — the user explicitly
		// requested "ちょうど一周分" (exactly one revolution) in both lat
		// and lon. So we draw only the base tile (i=0, j=0); panning past
		// the content boundary now reveals empty world, not a repeat. The
		// per-tile loop below is kept as scaffolding (periodX/periodY feed
		// the offset math) in case multi-revolution tiling returns.
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

		if (this.settings.showGrid && !this.laid.setNodeIds && !this.laid.upset) {
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
			ctx.fillStyle = colorAlpha(theme().danger, 0.92);
			ctx.fillRect(8, 8, tw + padX * 2, 22);
			ctx.fillStyle = theme().textNormal;
			ctx.fillText(text, 8 + padX, 8 + padY, Math.max(0, cw - 24));
		}


		this.drawGlobalDisplayFallbacks(ctx, dpr, this.settings.viewMode);
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
				this.settings.havingMode === "highlight" ? new Set(this.highlightedHavingClusters.keys()) : undefined,
				this.zoom,
				hn ? { x: hn.x, y: hn.y } : null,
				this.settings.viewMode === "bubblesets",
			);
		}

		if (this.settings.showEdges && !this.laid.upset) {
			if (this.settings.showGhostEdges) {
				drawGhostEdges(
					ctx,
					this.laid,
					this.zoom,
					skipNode
				);
			}

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

		if (hasHighlight && this.settings.showEdges && !this.laid.upset) {
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
			drawOverviewLabelsFn(ctx, this.laid, this.zoom, this.settings.havingMode === "highlight" ? this.highlightedHavingClusters : undefined);
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
			this.settings.havingMode === "highlight" ? this.highlightedHavingClusters : undefined,
		);
	}

	// Debug: last-drawn cluster label boxes (world space).
	_labelBoxes: import("./draw/draw-helpers").PlacedLabelBox[] = [];

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
			// A SET node that spans MULTIPLE clusters is a tag-core standing for
			// the WHOLE of those sets → it depicts a UNION → horizontal stripes
			// (isVertical=false). The per-node INTERSECTION (overlap) case is the
			// concept-lattice node whose `signature` lists ≥2 tags — that path is
			// drawn in draw-lattice.ts with vertical stripes. Single-membership
			// set nodes collapse to a solid fill inside createStripePattern.
			fillPattern: (isSet && n.memberships.length > 1)
				? (() => {
						const s = resolveNodeStripe(n.memberships, /*isUnionCore=*/ true);
						// One-cycle gradient across the card bbox (not a 16px repeat) so
						// the union bands read once across the whole node, matching
						// enclosures and lattice nodes.
						return createStripeGradient(
							ctx,
							n.x - n.width / 2,
							n.y - n.height / 2,
							n.width,
							n.height,
							s.hues,
							s.isVertical,
						);
					})()
				: undefined,
			// Clustered notes carry their island's main-tag in hueKey → muted tint.
			tintHue: !isSet && n.hueKey ? clusterHue(n.hueKey) : undefined,
			// Clustered LOD: the tag-centre label has a LOWER threshold than note
			// titles, so when zooming out the note names drop to markers first and
			// the island's tag label is the last to disappear.
			titleLodPx: clustered ? (isSet ? 26 : 48) : undefined,
			fmMaturity: n.fmMaturity,
			showMaturity: this.settings.showMaturity,
			encFillColor: this.encParams.get(n.id)?.fillColor,
			encOpacity: this.encParams.get(n.id)?.opacity,
			encBorderColor: this.encParams.get(n.id)?.borderColor,
			encShape: this.encParams.get(n.id)?.shape,
		});
	}

	// F5: gather the per-mode legend input (encoding specs + cluster swatches +
	// count range + heatmap flag) from the current layout. Pure read — never
	// mutates state, so the legend stays a display-only overlay.
	private buildModeLegendInput(): ModeLegendInput {
		const encodingSpecs = encodingToSpecs(this.encLegends);
		const t = theme();
		const aggSet = new Set(this.settings.aggregatedLayers);
		// LAYERS & OVERRIDES content is surfaced in EVERY view mode and perspective
		// now (the ∪/∩ set-layers + the resolved NODE_DISPLAY suffix), keeping the
		// per-mode intrinsic legends intact and merely ADDING the layer info.
		const isCloseup = this.settings.perspective === "closeup";
		// Per-tag VISIBLE COUNT that is correct in every view mode. Euler-family
		// stores it on `cluster.memberCount`, but node-grid modes
		// (matrix/upset/stream/bipartite) and droste leave `laid.clusters` empty,
		// so the count must be derived from each mode's own structure:
		//   • matrix     → `laid.matrix.cols[].size` (notes carrying that tag)
		//   • droste     → distinct gallery nodes whose tag-keys include the tag
		//   • clusters   → `cluster.memberCount` (already post-hide/aggregate)
		//   • node modes → `laid.nodes` whose memberships include the tag
		// All sources are post-hide/post-aggregate, so each is the live count.
		const tagVisibleCount = (tag: string): number => {
			const cluster = this.laid.clusters?.find((c) => c.groupKey === tag);
			if (cluster) return cluster.memberCount ?? 0;
			const mcol = this.laid.matrix?.cols?.find((c) => c.key === tag);
			if (mcol) return mcol.size ?? 0;
			const gallery = this.laid.drosteGallery;
			if (gallery?.cells.length) {
				const ids = new Set<string>();
				for (const cell of gallery.cells) {
					if ((gallery.nodeKeys.get(cell.id) ?? []).includes(tag)) ids.add(cell.id);
				}
				if (ids.size) return ids.size;
			}
			const latNodes = this.laid.lattice?.nodes;
			if (latNodes?.length) {
				let sum = 0;
				for (const node of latNodes) {
					if (node.signature?.includes(tag)) sum += node.count ?? 0;
				}
				if (sum > 0) return sum;
			}
			let n = 0;
			for (const node of this.laid.nodes) if (node.memberships?.includes(tag)) n++;
			return n;
		};
		// LAYERS & OVERRIDES content per layer, expressed with the SAME terms the
		// Settings ▸ Encode ▸ "Layers & Overrides" UI uses, so the legend faithfully
		// mirrors the panel:
		//   • Node display "Size (m × n)"        → `Size R×C`
		//   • header meta "N nodes"              → `N nodes`
		//   • Display "Aggregate (3-card stack)" → `Aggregate (3-card stack)`
		//   • "Inherit from" / "Full inheritance"→ `Inherit from <parent>` /
		//                                           `Full inheritance`
		// Parts are joined with " · " to match the panel's stacked fields. Shown in
		// EVERY view mode + perspective. `count` lets callers pass a pre-resolved
		// figure (e.g. the cluster's own memberCount) instead of re-deriving it;
		// when no count is derivable the count part is safely omitted.
		const clusterLabelFor = (groupKey: string): string =>
			this.laid.clusters?.find((c) => c.groupKey === groupKey)?.label ?? groupKey;
		// Inheritance descriptor matching the panel's "Inherit from" picker and the
		// set-layer "Full inheritance (ignore own overrides)" toggle.
		const inheritPart = (groupKey: string): string | null => {
			const isSetLayer = groupKey === UNION_LAYER_KEY || groupKey === INTERSECTION_LAYER_KEY;
			const parent = this.settings.inheritFrom?.[groupKey];
			const full = isSetLayer && (this.settings.layerInheritFull?.includes(groupKey) ?? false);
			if (full) {
				return parent
					? `Full inheritance from ${clusterLabelFor(parent)}`
					: "Full inheritance";
			}
			if (parent) return `Inherit from ${clusterLabelFor(parent)}`;
			return null;
		};
		// Build the " · "-joined "Size R×C · N nodes · …" suffix from the resolved
		// NODE_DISPLAY (= the value the renderer + panel placeholder both use).
		const layerSuffix = (groupKey: string, count?: number): string => {
			const n = count ?? tagVisibleCount(groupKey);
			const d = this.resolveLayerDisplay(groupKey);
			const parts: string[] = [`Size ${d.nodeRows}×${d.nodeCols}`];
			if (Number.isFinite(n)) parts.push(`${n} node${n === 1 ? "" : "s"}`);
			if (aggSet.has(groupKey)) parts.push("Aggregate (3-card stack)");
			const inh = inheritPart(groupKey);
			if (inh) parts.push(inh);
			return ` — ${parts.join(" · ")}`;
		};
		const seen = new Set<string>();
		const cleanLabel = (k: string) => k.startsWith("tag=") || k.startsWith("tag:") ? k.slice(4) : k;

		const tags: { key: string; color: string; label?: string }[] = [];
		for (const n of this.laid.nodes) {
			const k = n.memberships?.[0];
			if (!k || seen.has(k)) continue;
			seen.add(k);
			tags.push({ key: k, color: t.swatch(clusterHue(k), "fill"), label: cleanLabel(k) + layerSuffix(k) });
		}
		// MATRIX stores its rows in `laid.matrix` and leaves `laid.nodes` empty, so
		// derive the per-tag legend entries from the matrix COLUMNS (one per tag).
		if (this.settings.viewMode === "matrix" && this.laid.matrix?.cols?.length && !tags.length) {
			for (const col of this.laid.matrix.cols) {
				if (seen.has(col.key)) continue;
				seen.add(col.key);
				tags.push({ key: col.key, color: t.swatch(clusterHue(col.key), "fill"), label: cleanLabel(col.key) + layerSuffix(col.key, col.size) });
			}
		}
		if (this.settings.viewMode === "droste" && this.laid.drosteGallery?.cells.length) {
			const drosteSeen = new Set<string>();
			const drosteTags: { key: string; color: string; label?: string }[] = [];
			for (const cell of this.laid.drosteGallery.cells) {
				const keys = this.laid.drosteGallery.nodeKeys.get(cell.id) ?? [];
				for (const k of keys) {
					if (!k || drosteSeen.has(k)) continue;
					drosteSeen.add(k);
					drosteTags.push({ key: k, color: t.swatch(clusterHue(k), "fill"), label: cleanLabel(k) + layerSuffix(k) });
				}
			}
			tags.splice(0, tags.length, ...drosteTags);
		}
		let min = Infinity, max = -Infinity;
		for (const n of this.laid.nodes) {
			const c = (n as { count?: number }).count ?? 1;
			if (c < min) min = c;
			if (c > max) max = c;
		}
		if (!isFinite(min)) { min = 1; max = 1; }
		const hm = this.laid.heatmap;
		const drosteOps = this.settings.viewMode === "droste"
			? {
				focusColor: t.accent,
				intersectionColor: t.swatch(45, "fill"),
				unionColor: t.success,
			}
			: undefined;
		let hmTagMin = 1;
		let hmTagMax = 1;
		let hmCoMax = 1;
		if (hm && hm.tags.length > 0) {
			hmTagMin = Math.min(...hm.tags.map((x) => x.size));
			hmTagMax = Math.max(...hm.tags.map((x) => x.size));
			hmCoMax = Math.max(1, hm.p95 || hm.maxOff || 1);
		}
		let legendMin = min;
		let legendMax = max;
		let latticeInput: ModeLegendInput["lattice"] | undefined;
		if (this.settings.viewMode === "lattice" && this.laid.lattice?.nodes.length) {
			const nodes = this.laid.lattice.nodes;
			const counts = nodes.map((n) => n.count);
			legendMin = Math.min(...counts);
			legendMax = Math.max(...counts);
			const lod = "auto";
			const mix: NonNullable<ModeLegendInput["lattice"]>["lodMix"] = {
				overview: 0,
				density: 0,
				individual: 0,
			};
			const classColors: NonNullable<ModeLegendInput["lattice"]>["classColors"] = {
				overview: [],
				density: [],
				individual: [],
			};
			const seenColors: Record<"overview" | "density" | "individual", Set<string>> = {
				overview: new Set(),
				density: new Set(),
				individual: new Set(),
			};
			for (const node of nodes) {
				let eff = lodFor(node.count, this.zoom, {
					latticeNodeLOD: lod,
					latticeIndividualMax: this.settings.latticeIndividualMax,
					latticeDensityMax: this.settings.latticeDensityMax,
				});
				if (eff === "individual" && 12 * this.zoom < this.settings.minFontPx * 0.5) {
					eff = "density";
				}
				mix[eff] += 1;
				const seed = node.isOther
					? `__other__@${node.degree}`
					: node.signature.length
						? node.signature[0]
						: node.key || "?";
				const color = eff === "overview"
					? t.swatch(clusterHue(seed), "fill", 0.95)
					: eff === "density"
						? t.swatch(clusterHue(seed), "fill", 0.92)
						: t.swatch(clusterHue(seed), "fill", 0.90);
				if (!seenColors[eff].has(color)) {
					seenColors[eff].add(color);
					const head = node.displayTags?.[0] ?? node.signature?.[0] ?? node.key;
					classColors[eff].push({
						label: node.isOther ? `Other (deg ${node.degree})` : `#${head}`,
						color,
					});
				}
			}
			const nonZero = (["overview", "density", "individual"] as const).filter((k) => mix[k] > 0);
			const effectiveLod: NonNullable<ModeLegendInput["lattice"]>["effectiveLod"] =
				nonZero.length === 1 ? nonZero[0] : "mixed";
			latticeInput = {
				lod,
				effectiveLod,
				individualMax: this.settings.latticeIndividualMax,
				densityMax: this.settings.latticeDensityMax,
				densityCells: this.settings.latticeDensityCells,
				lodMix: mix,
				classColors,
			};
		}
		let groups: ModeLegendInput["groups"];
		let setLayers: ModeLegendInput["setLayers"];
		const enclosureModes = ["euler", "euler-true", "euler-venn", "bubblesets"];
		// `groups` (the cluster enclosure swatches) stay INTRINSIC to enclosure
		// modes — leaving the per-mode element policy unchanged.
		if (enclosureModes.includes(this.settings.viewMode) && this.laid.clusters?.length) {
			// `layerSuffix` already carries "· N nodes" (faithful to the panel's
			// "N nodes" header meta), so the bare leading "(memberCount)" is dropped
			// to avoid showing the count twice. `groupEnclosures` adds the "Group: "
			// prefix that mirrors the panel's per-cluster tab.
			groups = this.laid.clusters.map((c) => ({
				key: c.groupKey,
				label: `${c.label}${layerSuffix(c.groupKey, c.memberCount)}`,
				color: t.swatch(clusterHue(c.groupKey), "fill"),
			}));
		} else if (this.settings.viewMode === "lattice") {
			groups = [];
			for (const k of this.clusterLabels.keys()) {
				groups.push({
					key: k,
					label: `${cleanLabel(this.clusterLabels.get(k) ?? k)}${layerSuffix(k, tagVisibleCount(k))}`,
					color: t.swatch(clusterHue(k), "fill"),
				});
			}
		}
		// ∪ / ∩ are addressable layers DISTINCT from the single-tag clusters and are
		// surfaced in EVERY view mode. `unionN` = distinct visible notes, `interN` =
		// notes carrying 2+ tags. Each mode keeps its visible notes in a different
		// place, so derive the membership multiplicity from whichever source the
		// current layout populated (mirrors tagVisibleCount):
		//   • node modes → `laid.nodes[].memberships`
		//   • matrix     → `laid.matrix.bits` (per-row column bitset)
		//   • droste     → `laid.drosteGallery.nodeKeys` (cell id → tag keys)
		// resolveSetLayer applies the single-tag superset cascade (full/partial
		// inheritance) so single-set settings influence ∪/∩.
		const setMembershipCounts = (): { unionN: number; interN: number; pairwise: { t1: string; t2: string; interN: number; unionN: number }[] } | null => {
			let nodeTags: string[][] = [];
			const tagCounts = new Map<string, number>();

			if (this.laid.nodes.length) {
				for (const n of this.laid.nodes) {
					const tags = n.memberships ?? [];
					nodeTags.push(tags);
					for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
				}
			} else if (this.laid.matrix?.bits?.length) {
				const m = this.laid.matrix;
				for (const row of m.bits) {
					const tags: string[] = [];
					for (let c = 0; c < row.length; c++) {
						if (row[c]) {
							const t = m.cols[c].key;
							tags.push(t);
							tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
						}
					}
					nodeTags.push(tags);
				}
			} else if (this.laid.drosteGallery?.cells.length) {
				const gallery = this.laid.drosteGallery;
				const counted = new Set<string>();
				for (const cell of gallery.cells) {
					if (counted.has(cell.id)) continue;
					counted.add(cell.id);
					const tags = (gallery.nodeKeys.get(cell.id) ?? []).filter((k) => k !== NONE_BUCKET);
					nodeTags.push(tags);
					for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
				}
			} else {
				return null;
			}

			let unionN = 0, interN = 0;
			const pairInter = new Map<string, number>();

			for (const tags of nodeTags) {
				if (tags.length >= 1) unionN++;
				if (tags.length >= 2) interN++;
				const sortedTags = [...tags].sort();
				for (let i = 0; i < sortedTags.length; i++) {
					for (let j = i + 1; j < sortedTags.length; j++) {
						const t1 = sortedTags[i], t2 = sortedTags[j];
						const key = `${t1}\t${t2}`;
						pairInter.set(key, (pairInter.get(key) ?? 0) + 1);
					}
				}
			}

			const pairwise: { t1: string; t2: string; interN: number; unionN: number }[] = [];
			for (const [key, pInterN] of pairInter.entries()) {
				const [t1, t2] = key.split("\t");
				const c1 = tagCounts.get(t1) ?? 0;
				const c2 = tagCounts.get(t2) ?? 0;
				const pUnionN = c1 + c2 - pInterN;
				pairwise.push({ t1, t2, interN: pInterN, unionN: pUnionN });
			}
			pairwise.sort((a, b) => b.interN - a.interN || a.t1.localeCompare(b.t1) || a.t2.localeCompare(b.t2));

			return { unionN, interN, pairwise };
		};
		const setCounts = setMembershipCounts();
		if (setCounts) {
			const { unionN, interN, pairwise } = setCounts;
			setLayers = [];
			
			for (const p of pairwise) {
				const l1 = cleanLabel(this.clusterLabels.get(p.t1) ?? p.t1);
				const l2 = cleanLabel(this.clusterLabels.get(p.t2) ?? p.t2);

				const h1 = clusterHue(p.t1);
				const h2 = clusterHue(p.t2);
				// Striped pattern for union (horizontal) and intersection (vertical)
				setLayers.push({
					key: `__union__${p.t1}_${p.t2}`,
					label: `${l1} ∪ ${l2}${layerSuffix(UNION_LAYER_KEY, p.unionN)}`,
					color: createStripePattern([h1, h2], false),
				});
				setLayers.push({
					key: `__inter__${p.t1}_${p.t2}`,
					label: `${l1} ∩ ${l2}${layerSuffix(INTERSECTION_LAYER_KEY, p.interN)}`,
					color: createStripePattern([h1, h2], true),
				});
			}

			if (!pairwise.length && unionN > 0) {
				setLayers.push({
					key: UNION_LAYER_KEY,
					label: `${SET_LAYER_LABEL[UNION_LAYER_KEY]}${layerSuffix(UNION_LAYER_KEY, unionN)}`,
					color: t.swatch(140, "fill"),
				});
				setLayers.push({
					key: INTERSECTION_LAYER_KEY,
					label: `${SET_LAYER_LABEL[INTERSECTION_LAYER_KEY]}${layerSuffix(INTERSECTION_LAYER_KEY, interN)}`,
					color: t.swatch(45, "fill"),
				});
			}
		}
		return {
			encodingSpecs,
			tags,
			groups,
			setLayers,
			// DISPLAY-UNIT flag only: in closeup ∪/∩ are shown as an independent
			// legend section (incl. enclosure modes) instead of being folded into
			// the single-tag "Groups & overlap" spec. The ∪/∩ VALUES above are still
			// the resolveSetLayer()-backed labels, so single-set settings keep
			// cascading into ∪/∩ — only the display unit is split out.
			closeup: isCloseup,
			counts: { min: legendMin, max: legendMax },
			droste: drosteOps,
			lattice: latticeInput,
			heatmap: {
				jaccard: !!this.settings.heatmapJaccard,
				tagMin: hmTagMin,
				tagMax: hmTagMax,
				coMax: hmCoMax,
			},
		};
	}

	private screenToWorld(sx: number, sy: number): { x: number; y: number } {
		return screenToWorldFn(sx, sy, this.panX, this.panY, this.zoom);
	}

	private hitTest(wx: number, wy: number): HoverTarget {
		return hitTestFn(
			wx, 
			wy, 
			this.laid.nodes, 
			this.laid.clusters, 
			this.zoom,
			this.settings.showGhostEdges ? this.laid.ghostEdges : undefined
		);
	}

	private openFile(id: string): void {
		// Euler-nested copies use a `${tag}\t${origPath}` id — open the
		// ORIGINAL file path, not the prefixed copy id.
		const sepIdx = id.indexOf("\t");
		const path = sepIdx >= 0 ? id.slice(sepIdx + 1) : id;
		this.isInternalClick = true;
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
	// `focusNoteFromMenu` (droste focus / canvas locate / openFile).
	private ensureNoteMenu(): void {
		// Respect the graph-settings show/hide toggle: when off, the menu must
		// never appear in ANY mode — tear down any existing panel and bail.
		if (!this.settings.noteMenuVisible) {
			this.removeNoteMenu();
			return;
		}
		if (this.noteMenu) return;
		const nodes = this.currentMenuNotes();
		const isDroste = !!this.laid.drosteGallery;
		const panel = this.root.createDiv();
		this.noteMenu = panel;
		// Resolve the panel rect (px, relative to this.root). Priority:
		//   1. this.noteMenuRect — survives REBUILDS (set on every drag/resize).
		//   2. this.settings.noteMenuRect — survives RELOADS (persisted to data.json).
		//   3. the built-in default (top-left, 270px wide, container-tall).
		// On every (re)build we clamp the rect to the current container size so a
		// shrunken view can never strand the panel off-screen.
		const container = { width: this.root.clientWidth || 0, height: this.root.clientHeight || 0 };
		const rect = resolveMenuRect(this.noteMenuRect, this.settings.noteMenuRect, container);
		this.noteMenuRect = rect;
		const pinned = !!this.settings.noteMenuPinned;
		// Docked width when pinned (clamped to ≤80% of the container).
		const pinnedW = clampPinnedWidth(this.settings.noteMenuPinnedWidth, container.width);
		if (pinned) {
			// Dock to the RIGHT edge: full height, fixed width, square corners, a
			// left border only — the canvas reserves `this.pinnedMenuWidth()` so the
			// figure isn't covered (like a standard docked side panel).
			panel.setCssStyles({
				position: "absolute",
				left: "", right: "0", top: "0", bottom: "0", height: "", width: `${pinnedW}px`,
				display: "flex", flexDirection: "column", overflow: "hidden",
				background: "var(--background-secondary)",
				border: "none", borderLeft: "1px solid var(--background-modifier-border)", borderRadius: "0",
				boxShadow: "-4px 0 16px rgba(0,0,0,0.5)", zIndex: "60", font: "12px sans-serif", color: "var(--text-normal)",
			});
		} else {
			panel.setCssStyles({
				position: "absolute",
				left: `${rect.left}px`, top: `${rect.top}px`, right: "", bottom: "",
				width: `${rect.width}px`, height: `${rect.height}px`,
				display: "flex", flexDirection: "column", overflow: "hidden",
				background: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)", borderRadius: "6px",
				boxShadow: "0 4px 16px rgba(0,0,0,0.5)", zIndex: "60", font: "12px sans-serif", color: "var(--text-normal)",
			});
		}
		const head = panel.createDiv();
		// When floating, the header IS the drag handle (cursor:move); when pinned
		// the panel is docked so it can't be moved (cursor:default).
		head.setCssStyles({
			padding: "6px 8px", borderBottom: "1px solid var(--background-modifier-border)", fontWeight: "600",
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
		pinBtn.setCssStyles({ cursor: "pointer", color: pinned ? "var(--interactive-accent)" : "var(--text-muted)", display: "inline-flex", alignItems: "center", padding: "0 2px" });
		setIcon(pinBtn, pinned ? "pin-off" : "pin");
		pinBtn.setAttr("aria-label", pinned ? "Unpin (float)" : "Pin to right");
		pinBtn.addEventListener("mousedown", (ev) => ev.stopPropagation());
		pinBtn.addEventListener("dblclick", (ev) => ev.stopPropagation());
		pinBtn.addEventListener("click", (ev) => { ev.stopPropagation(); this.togglePin(); });
		const closeBtn = headBtns.createSpan({ text: "×" });
		closeBtn.setCssStyles({ cursor: "pointer", fontWeight: "700", fontSize: "16px", lineHeight: "1", padding: "0 4px", color: "var(--text-muted)", flex: "0 0 auto" });
		closeBtn.setAttr("aria-label", "Close menu");
		closeBtn.addEventListener("mousedown", (ev) => ev.stopPropagation());
		closeBtn.addEventListener("dblclick", (ev) => ev.stopPropagation());
		closeBtn.addEventListener("click", (ev) => { ev.stopPropagation(); this.toggleNoteMenu(); });
		// ── Top-level tabs: Notes | Settings ─────────────────────────────────────
		const tabBar = head.createDiv();
		// Underline-style tabs: the bar carries the divider line that the active
		// tab's accent underline sits on (marginBottom:-1px lines them up), so the
		// active tab reads as connected to the body below.
		tabBar.setCssStyles({ display: "flex", gap: "2px", marginTop: "8px", fontWeight: "400", fontSize: "11px", borderBottom: "1px solid var(--background-modifier-border)" });
		tabBar.addEventListener("mousedown", (ev) => ev.stopPropagation());
		// Don't let a double-click on the tab bar toggle the header's minimize.
		tabBar.addEventListener("dblclick", (ev) => ev.stopPropagation());
		// Two tab panes under a flex wrapper that fills the rest of the panel.
		const bodyWrap = panel.createDiv();
		bodyWrap.setCssStyles({ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: "0", overflow: "hidden" });
		
		const dataTabWrap = bodyWrap.createDiv({ cls: "gim-menu-data-wrap" });
		dataTabWrap.setCssStyles({ display: "none", flexDirection: "column", flex: "1 1 auto", minHeight: "0" });
		
		const dataSubBar = dataTabWrap.createDiv();
		dataSubBar.setCssStyles({ display: "flex", flexWrap: "wrap", gap: "1px", borderBottom: "1px solid var(--background-modifier-border)", padding: "4px 6px 0" });
		
		const logicTab = dataTabWrap.createDiv({ cls: "gim-menu-data-logic" });
		logicTab.setCssStyles({ display: "block", overflow: "auto", flex: "1 1 auto", minHeight: "0", padding: "4px 6px 8px" });
		
		const treeTab = dataTabWrap.createDiv({ cls: "gim-menu-data-tree" });
		treeTab.setCssStyles({ display: "none", flexDirection: "column", flex: "1 1 auto", minHeight: "0" });

		const tableTab = dataTabWrap.createDiv({ cls: "gim-menu-data-table" });
		tableTab.setCssStyles({ display: "none", overflow: "auto", flex: "1 1 auto", minHeight: "0", padding: "4px 6px 8px" });

		const jsonTab = dataTabWrap.createDiv({ cls: "gim-menu-data-json" });
		jsonTab.setCssStyles({ display: "none", overflow: "auto", flex: "1 1 auto", minHeight: "0", padding: "4px 6px 8px" });

		const settingsTab = bodyWrap.createDiv({ cls: "gim-menu-settings" });
		settingsTab.setCssStyles({ display: "none", overflow: "auto", flex: "1 1 auto", minHeight: "0", padding: "4px 6px 8px" });
		const insightTab = bodyWrap.createDiv();
		insightTab.setCssStyles({ display: "none", overflow: "auto", flex: "1 1 auto", minHeight: "0", padding: "4px 6px 8px" });

		// -- Data Sub-tabs: Logic | Tree | Table --
		type DataSubTab = "logic" | "tree" | "table" | "json";
		const D_SUBS: { key: DataSubTab; label: string }[] = [
			{ key: "logic", label: "Logic" },
			{ key: "tree", label: "Tree" },
			{ key: "table", label: "Table" },
			{ key: "json", label: "JSON" },
		];
		const dSubBtns = new Map<string, HTMLElement>();
		const styleDSubs = (): void => {
			for (const { key } of D_SUBS) {
				const b = dSubBtns.get(key);
				if (!b) continue;
				const on = this.dataSubTab === key;
				b.setCssStyles({
					background: "transparent", border: "none",
					borderBottom: on ? "2px solid var(--interactive-accent)" : "2px solid transparent",
					borderRadius: "0", padding: "4px 8px", marginBottom: "-1px",
					color: on ? "var(--text-normal)" : "var(--text-muted)", fontWeight: on ? "600" : "400",
					cursor: "pointer", fontSize: "10.5px", lineHeight: "1.3",
				});
			}
		};
		const showDSubTab = (key: DataSubTab): void => {
			this.dataSubTab = key;
			logicTab.setCssStyles({ display: key === "logic" ? "block" : "none" });
			treeTab.setCssStyles({ display: key === "tree" ? "flex" : "none" });
			tableTab.setCssStyles({ display: key === "table" ? "block" : "none" });
			jsonTab.setCssStyles({ display: key === "json" ? "block" : "none" });
			if (key === "table") {
				// Re-render table tab when activated
				renderDataTableView(tableTab, nodes, { app: this.app, edges: this.laid.edges });
			} else {
				tableTab.empty();
			}
			if (key === "json") {
				// Re-render JSON tab (preset import/export) on activation.
				this.renderDataJsonBody(jsonTab);
			} else {
				jsonTab.empty();
			}
			styleDSubs();
		};
		for (const { key, label } of D_SUBS) {
			const b = dataSubBar.createEl("button", { text: label });
			dSubBtns.set(key, b);
			b.addEventListener("mousedown", (ev) => ev.stopPropagation());
			b.addEventListener("click", (ev) => { ev.stopPropagation(); showDSubTab(key); });
			b.addEventListener("mouseenter", () => {
				if (this.dataSubTab !== key) { b.setCssStyles({ color: "var(--text-muted)" }); b.setCssStyles({ borderBottomColor: "var(--background-modifier-border)" }); }
			});
			b.addEventListener("mouseleave", () => styleDSubs());
		}
		showDSubTab(this.dataSubTab);

		type MenuTab = "data" | "settings" | "insight";
		const TABS: MenuTab[] = ["data", "settings", "insight"];
		const tabBtns: Partial<Record<MenuTab, HTMLElement>> = {};
		const styleTabs = (): void => {
			for (const key of TABS) {
				const b = tabBtns[key];
				if (!b) continue;
				const on = this.activeMenuTab === key;
				b.setCssStyles({
					background: "transparent", border: "none",
					borderBottom: on ? "2px solid var(--interactive-accent)" : "2px solid transparent",
					borderRadius: "0", padding: "6px 14px", marginBottom: "-1px",
					color: on ? "var(--text-normal)" : "var(--text-muted)", fontWeight: on ? "600" : "400",
					cursor: "pointer", fontSize: "11px", lineHeight: "1.3",
				});
			}
		};
		const showTab = (key: MenuTab): void => {
			this.activeMenuTab = key;
			dataTabWrap.setCssStyles({ display: key === "data" ? "flex" : "none" });
			settingsTab.setCssStyles({ display: key === "settings" ? "block" : "none" });
			insightTab.setCssStyles({ display: key === "insight" ? "block" : "none" });
			
			if (key === "data") this.renderDataLogicBody(logicTab);
			else this.dataHostEl = null;

			if (key === "settings") this.renderSettingsBody(settingsTab);
			else this.settingsHostEl = null;
			
			if (key === "insight") {
				renderInsightTab(insightTab, {
					app: this.app,
					settings: this.settings,
					save: () => void this.save(),
					laid: this.laid,
					canvasWidth: this.canvas.width / window.devicePixelRatio,
					canvasHeight: this.canvas.height / window.devicePixelRatio,
					currentGaps: this.currentGaps,
					currentBridges: this.currentBridges,
					highlightedHavingClusters: this.highlightedHavingClusters,
					insightK: this.clInsightK,
					setInsightK: (k) => { this.clInsightK = k; },
					insightSubTab: this.insightSubTab,
					setInsightSubTab: (tab) => { this.insightSubTab = tab; }
				});
			}
			styleTabs();
		};
		const mkTab = (key: MenuTab, label: string): void => {
			const b = tabBar.createEl("button", { text: label });
			tabBtns[key] = b;
			b.addEventListener("mousedown", (ev) => ev.stopPropagation());
			b.addEventListener("click", (ev) => { ev.stopPropagation(); showTab(key); });
			// Hover affordance for the inactive tab (active styling wins via styleTabs).
			b.addEventListener("mouseenter", () => {
				if (this.activeMenuTab !== key) { b.setCssStyles({ color: "var(--text-muted)" }); b.setCssStyles({ borderBottomColor: "var(--background-modifier-border)" }); }
			});
			b.addEventListener("mouseleave", () => styleTabs());
		};
		mkTab("data", "Data");
		mkTab("settings", "Settings");
		mkTab("insight", "Insight");
		// Note-count + click hint, shown at the top of the Result pane.
		const notesHint = treeTab.createDiv({ text: `${nodes.length} notes — click to ${verb}` });
		notesHint.setCssStyles({ fontSize: "10px", color: "var(--text-faint)", padding: "4px 8px 0" });
		// ── Grouping selector (Folder / Tag) ────────────────────────────────────
		// A small radio group in the header switches the tree between the FOLDER
		// tree (by note path, default) and the TAG tree (by GROUP_BY membership
		// keys). The chosen grouping survives rebuilds (this.noteMenuGroupBy) and
		// reloads (settings.noteMenuGroupBy). Changing it re-renders the tree.
		const groupBar = treeTab.createDiv();
		groupBar.setCssStyles({
			display: "flex", gap: "10px", marginTop: "4px", fontWeight: "400",
			fontSize: "11px", color: "var(--text-muted)", cursor: "default",
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
		const bulkBar = treeTab.createDiv();
		bulkBar.setCssStyles({
			display: "flex", gap: "6px", marginTop: "4px",
		});
		const mkBulkBtn = (label: string, handler: () => void): void => {
			const btn = bulkBar.createEl("button");
			btn.textContent = label;
			btn.setCssStyles({
				fontSize: "10px", padding: "2px 6px", cursor: "pointer",
				background: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)",
				borderRadius: "3px", color: "var(--text-muted)", lineHeight: "1.4",
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
		// Search input for filtering the tree.
		const searchWrap = treeTab.createDiv();
		searchWrap.setCssStyles({ position: "relative", margin: "6px 8px", flex: "0 0 auto" });
		const search = searchWrap.createEl("input", { attr: { type: "text", placeholder: "Search: word, #tag, key:value" } });
		search.setCssStyles({ display: "block", width: "100%", boxSizing: "border-box", padding: "4px 6px", background: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", borderRadius: "4px", color: "var(--text-normal)" });
		// Restore the search query that was active before this rebuild (if any).
		// This preserves the user's typed text across vault-change-triggered rebuilds.
		if (this.noteMenuSearchQuery) search.value = this.noteMenuSearchQuery;
		// Suggestion (autocomplete) dropdown — absolutely positioned under the input,
		// same panel styling, zIndex above the body. Hidden until there are matches.
		const suggBox = searchWrap.createDiv();
		suggBox.setCssStyles({
			position: "absolute", left: "0", right: "0", top: "100%", marginTop: "2px",
			background: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)", borderRadius: "4px",
			boxShadow: "0 4px 16px rgba(0,0,0,0.5)", zIndex: "70", overflow: "auto", maxHeight: "240px",
			display: "none",
		});
		const body = treeTab.createDiv({ cls: "gim-tree-scroll" });
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
			if (id === highlightId) lbl.setCssStyles({ color: "var(--color-yellow)" });
			row.addEventListener("mouseenter", () => { row.setCssStyles({ background: "var(--background-modifier-border)" }); });
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
				color: "var(--text-faint)", fontWeight: "600", fontStyle: "italic",
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
				row.setCssStyles({ display: "flex", alignItems: "center", padding: "2px 4px", paddingLeft: `${6 + depth * 12}px`, color: "var(--text-muted)", fontWeight: "600" });
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
		const kindColor: Record<Suggestion["kind"], string> = { tag: "var(--text-accent)", field: "var(--color-purple)", note: "var(--text-muted)" };
		// Replace the current token in the input with `text`. Tags/notes get a
		// trailing space (term complete); "key:" stays open (no space) so the user
		// can keep typing the value.
		const acceptSuggestion = (text: string, _kind: Suggestion["kind"]): void => {
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
			rows.forEach((r, i) => { r.setCssStyles({ background: i === selIdx ? "var(--background-modifier-border)" : "" }); });
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
		if (this.settings.viewMode === "stream" && this.laid.stream) {
			const geom = streamGeom(this.laid.stream, this.canvas.width / window.devicePixelRatio, this.canvas.height / window.devicePixelRatio);
			if (sx >= geom.x0 && sx <= geom.x0 + geom.w && sy >= geom.y0 && sy <= geom.y0 + geom.h) {
				const c = Math.floor((sx - geom.x0) / geom.colWidth);
				const r = Math.floor((sy - geom.y0) / geom.rowHeight);
				if (c >= 0 && c < this.laid.stream.cols.length && r >= 0 && r < this.laid.stream.rows.length) {
					// Check if cell actually exists
					const cell = this.laid.stream.matrix.find(m => m.r === r && m.c === c);
					if (cell) {
						return `stream-cell:${r}:${c}`;
					}
				}
			}
			return null;
		}

		return null;
	}


	// Heatmap cell click → Switch to Close-up focusing on shared notes.
	private openHeatmapDetail(i: number, j: number, _sx: number, _sy: number): void {
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
		this.heatmapSelected = null;
		this.switchToCloseup(ids);
	}

	private openStreamDetail(r: number, c: number, _sx: number, _sy: number): void {
		const s = this.laid.stream;
		if (!s) return;
		const cell = s.matrix.find(m => m.r === r && m.c === c);
		if (!cell || cell.nodeIds.length === 0) return;
		this.switchToCloseup(cell.nodeIds);
	}

	// Lattice node click (header / overview / density / Other) → Switch to
	// Close-up for the notes in that exact intersection.
	private openLatticeDetail(
		node: import("./layout/layout").LatticeNodeMeta,
		_sx: number,
		_sy: number,
	): void {
		this.latticeSelectedKey = null;
		this.switchToCloseup(node.nodeIds);
	}

	private switchToCloseup(ids: string[]): void {
		// Ensure array is a clean copy so we don't accidentally mutate or retain references.
		// Guard against undefined ids to prevent "TypeError: ids is not iterable" during E2E coverage.
		this.settings.focusNodeIds = Array.isArray(ids) ? [...ids] : [];
		this.settings.perspective = "closeup";
		this.settings.viewMode = this.settings.closeupMode || "droste";
		void this.save();
		this.updatePanoramaActionVisibility();
		void this.rebuild();
	}

	public switchToPanorama(): void {
		this.settings.focusNodeIds = undefined;
		delete this.settings.focusNodeIds;
		delete (this.settings as unknown as Record<string, unknown>).drillDownNodeIds; // Cleanup legacy state if any
		this.settings.perspective = "panorama";
		this.settings.viewMode = this.settings.panoramaMode || "heatmap";
		void this.save();
		this.updatePanoramaActionVisibility();
		void this.rebuild();
	}

	private updatePanoramaActionVisibility(): void {
		if (this.panoramaActionEl) {
			this.panoramaActionEl.style.display = this.settings.perspective === "closeup" ? "" : "none";
		}
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
		return hitMatrixLine(m, this.matrixLines.length, this.zoom, this.panY, this.canvas.clientWidth, sy);
	}

	// Column index under the cursor (-1 = label band / out of range).
	private matrixColAt(sx: number): number {
		const m = this.laid.matrix;
		if (!m) return -1;
		return hitMatrixCol(m, this.zoom, this.panX, this.canvas.clientWidth, sx);
	}

	// Heatmap cell (row i, col j) under the cursor, or null if over a frozen
	// band / out of range.
	private heatmapCellAt(sx: number, sy: number): { i: number; j: number } | null {
		const h = this.laid.heatmap;
		if (!h) return null;
		return hitHeatmapCell(h, this.zoom, this.panX, this.panY, this.canvas.clientWidth, sx, sy);
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
		if (this.settings.viewMode === "stream" && this.laid.stream) {
			const geom = streamGeom(this.laid.stream, this.canvas.width / window.devicePixelRatio, this.canvas.height / window.devicePixelRatio);
			let c = Math.floor((sx - geom.x0) / geom.colWidth);
			let r = Math.floor((sy - geom.y0) / geom.rowHeight);
			let target: HoverTarget = null;
			let id: string | null = null;
			if (sx >= geom.x0 && sx <= geom.x0 + geom.w && sy >= geom.y0 && sy <= geom.y0 + geom.h) {
				if (c >= 0 && c < this.laid.stream.cols.length && r >= 0 && r < this.laid.stream.rows.length) {
					const cell = this.laid.stream.matrix.find(m => m.r === r && m.c === c);
					if (cell) {
						target = { kind: "streamCell", r, c };
						id = `stream-cell:${r}:${c}`;
					}
				}
			}
			if (!sameTarget(this.hoverTarget, target)) {
				this.cancelHover();
				this.hoverTarget = target;
				this.hoveredNodeId = id;
				if (target) this.scheduleHover(target, sx, sy);
				this.requestDraw();
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
		if (target.kind === "streamCell") {
			const s = this.laid.stream;
			if (!s || target.r >= s.rows.length || target.c >= s.cols.length) return;
			const cell = s.matrix.find(m => m.r === target.r && m.c === target.c);
			if (cell) {
				tip.createSpan({ cls: "gim-tip-title", text: `${s.rows[target.r]} × ${s.cols[target.c]}` });
				tip.createSpan({ cls: "gim-tip-sub", text: `${cell.count} notes` });
				this.root.appendChild(tip);
				this.tipEl = tip;
				this.positionTip(sx, sy, tip);
			}
			return;
		}
		if (target.kind === "ghostEdge") {
			const b = target.bridge;
			const tagsStr = b.sharedTags.slice(0, 3).map(t => `#${t}`).join(" ");
			const moreTags = b.sharedTags.length > 3 ? ` (+${b.sharedTags.length - 3})` : "";
			tip.createSpan({ cls: "gim-tip-title", text: "Suggested link" });
			tip.createSpan({ cls: "gim-tip-sub", text: `shared tags: ${tagsStr}${moreTags} (Jaccard ${b.jaccard.toFixed(2)})` });
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
			// F5: begin dragging the legend panel (but not its × button).
			{
				const pr = this.legendPanelRect, cr0 = this.legendCloseRect;
				const inClose = !!cr0 && sx >= cr0.x && sx <= cr0.x + cr0.w && sy >= cr0.y && sy <= cr0.y + cr0.h;
				if (pr && !inClose && sx >= pr.x && sx <= pr.x + pr.w && sy >= pr.y && sy <= pr.y + pr.h) {
					// Detect scrollbar drag
					if (this.legendMaxScrollY > 0 && sx >= pr.x + pr.w - 12) {
						// Calculate absolute scroll position based on click Y coordinate
						const trackTop = this.exportDprMul === 1 ? 20 : 4;
						const trackH = pr.h - trackTop - 4;
						const thumbMinH = 20;
						const boxH = pr.h + this.legendMaxScrollY;
						const thumbH = Math.max(thumbMinH, trackH * (pr.h / boxH));
						const maxThumbY = trackH - thumbH;
						
						// Thumb's current physical position
						const curScrollY = this.legendScrollY[this.settings.viewMode as ViewMode] ?? 0;
						const curThumbY = pr.y + trackTop + (maxThumbY > 0 ? (curScrollY / this.legendMaxScrollY) * maxThumbY : 0);
						
						// If clicking directly on the thumb, do relative drag
						if (sy >= curThumbY && sy <= curThumbY + thumbH) {
							this.legendScrollDrag = { startY: sy, startScrollY: curScrollY };
						} else {
							// Clicking on the track outside the thumb: jump to position
							// Center the thumb at the clicked Y coordinate
							let targetThumbY = (sy - pr.y - trackTop) - thumbH / 2;
							targetThumbY = Math.max(0, Math.min(maxThumbY, targetThumbY));
							const newScrollY = maxThumbY > 0 ? (targetThumbY / maxThumbY) * this.legendMaxScrollY : 0;
							
							const vmode = this.settings.viewMode as ViewMode;
							this.legendScrollY[vmode] = newScrollY;
							this.requestDraw();
							
							// Allow dragging to continue from the new jumped position
							this.legendScrollDrag = { startY: sy, startScrollY: newScrollY };
						}
						
						e.preventDefault();
						return;
					}
					this.legendDrag = { dx: sx - pr.x, dy: sy - pr.y };
					this.pointerMoved = false;
					e.preventDefault();
					return;
				}
			}
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
			// Drag the legend scrollbar
			if (this.legendScrollDrag) {
				const rect = c.getBoundingClientRect();
				const sy = e.clientY - rect.top;
				const dy = sy - this.legendScrollDrag.startY;
				const pr = this.legendPanelRect!;
				const trackTop = this.exportDprMul === 1 ? 20 : 4;
				const trackH = pr.h - trackTop - 4;
				const thumbMinH = 20;
				const boxH = pr.h + this.legendMaxScrollY;
				const thumbH = Math.max(thumbMinH, trackH * (pr.h / boxH));
				const maxThumbY = trackH - thumbH;
				const scrollDelta = maxThumbY > 0 ? (dy / maxThumbY) * this.legendMaxScrollY : 0;
				const vmode = this.settings.viewMode as ViewMode;
				this.legendScrollY[vmode] = Math.max(0, Math.min(this.legendMaxScrollY, this.legendScrollDrag.startScrollY + scrollDelta));
				this.requestDraw();
				return;
			}
			// F5: move the legend panel; persists on mouseup.
			if (this.legendDrag) {
				const rect = c.getBoundingClientRect();
				const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
				this.settings.legendPos = {
					...this.settings.legendPos,
					[this.settings.viewMode]: { x: sx - this.legendDrag.dx, y: sy - this.legendDrag.dy },
				};
				this.pointerMoved = true;
				this.requestDraw();
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
			// Commit a legend scroll drag.
			if (this.legendScrollDrag) {
				this.legendScrollDrag = null;
				return;
			}
			// F5: commit a legend drag.
			if (this.legendDrag) {
				this.legendDrag = null;
				void this.save();
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
				return;
			}
			const rect = c.getBoundingClientRect();
			const sx = e.clientX - rect.left;
			const sy = e.clientY - rect.top;
			const { x: wx, y: wy } = this.screenToWorld(sx, sy);
			const hit = this.hitTest(wx, wy);

			if (hit && hit.kind === "node") {
				e.preventDefault();
				const sepIdx = hit.nodeId.indexOf("\t");
				const baseId = sepIdx >= 0 ? hit.nodeId.slice(sepIdx + 1) : hit.nodeId;
				const file = this.app.vault.getAbstractFileByPath(baseId);
				if (file instanceof TFile) {
					const menu = new Menu();
					menu.addItem((item) => {
						item.setTitle("Set maturity");
						item.setIcon("pencil");
						interface MenuItemWithSubmenu { setSubmenu: () => Menu; }
						const subMenu = (item as unknown as MenuItemWithSubmenu).setSubmenu();
						for (const maturity of ["fleeting", "literature", "permanent"]) {
							subMenu.addItem((subItem) => {
								subItem.setTitle(maturity);
								subItem.onClick(async () => {
									await this.app.fileManager.processFrontMatter(file, (fm: unknown) => {
										if (typeof fm === "object" && fm !== null) {
											(fm as Record<string, unknown>).maturity = maturity;
										}
									});
									new Notice(`Set maturity '${maturity}' on ${file.basename}`);
								});
							});
						}
					});
					menu.showAtMouseEvent(e);
				}
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
			// F5: the on-canvas legend's × dismisses the legend for the current mode.
			// Screen-space, checked first so it wins over any canvas content beneath.
			const cr = this.legendCloseRect;
			if (cr && sx >= cr.x && sx <= cr.x + cr.w && sy >= cr.y && sy <= cr.y + cr.h) {
				this.sessionHiddenLegends.add(this.settings.viewMode as ViewMode);
				this.draw();
				return;
			}
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
					this.requestDraw();
				}
				return;
			}
			if (this.settings.viewMode === "stream" && this.laid.stream) {
				const geom = streamGeom(this.laid.stream, this.canvas.width / window.devicePixelRatio, this.canvas.height / window.devicePixelRatio);
				if (sx >= geom.x0 && sx <= geom.x0 + geom.w && sy >= geom.y0 && sy <= geom.y0 + geom.h) {
					const c = Math.floor((sx - geom.x0) / geom.colWidth);
					const r = Math.floor((sy - geom.y0) / geom.rowHeight);
					if (c >= 0 && c < this.laid.stream.cols.length && r >= 0 && r < this.laid.stream.rows.length) {
						this.openStreamDetail(r, c, sx, sy);
					}
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
					this.requestDraw();
					return;
				}
				const hitNode = cbHit;
				if (!hitNode) {
					this.latticeSelectedKey = null;
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
						latticeNodeLOD: "auto",
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
			} else if (hit?.kind === "ghostEdge") {
				// Open one of the notes in a new leaf (the one that is not currently focused)
				const b = hit.bridge;
				const currentFile = this.app.workspace.getActiveFile();
				const targetId = (currentFile && currentFile.path === b.a) ? b.b : b.a;
				this.openFile(targetId);
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
			const rect = c.getBoundingClientRect();
			const sx = e.clientX - rect.left;
			const sy = e.clientY - rect.top;

			const lr = this.legendPanelRect;
			if (lr && sx >= lr.x && sx <= lr.x + lr.w && sy >= lr.y && sy <= lr.y + lr.h) {
				if (this.legendMaxScrollY > 0) {
					const vmode = this.settings.viewMode as ViewMode;
					const cur = this.legendScrollY[vmode] ?? 0;
					const dy = e.deltaMode === 1 ? e.deltaY * 20 : (e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY);
					this.legendScrollY[vmode] = Math.max(0, Math.min(this.legendMaxScrollY, cur + dy));
					this.requestDraw();
				}
				e.stopPropagation();
				return;
			}

			// Connection matrix: wheel scrolls the rows vertically (fixed row
			// height); the existing drag-pan also scrolls. No zoom here.
			if (this.laid.matrix) {
				this.panY -= e.deltaY;
				this.requestDraw();
				return;
			}

			// UpSet footer scroll path retired — the matrix is in world
			// space now, so the normal zoom-on-wheel below applies.
			const factor = Math.exp(-e.deltaY * 0.0015);
			const t = zoomAroundPointer({ zoom: this.zoom, panX: this.panX, panY: this.panY }, factor, sx, sy);
			this.zoom = t.zoom;
			this.panX = t.panX;
			this.panY = t.panY;
			this.requestDraw();
		}, { passive: false });
		c.addEventListener("dblclick", () => this.fitToView());
	}

}

