import { ItemView, type WorkspaceLeaf, TFile, debounce, setIcon, Notice, Menu, MarkdownView } from "obsidian";
import { exportCanvasDims } from "./visual/image-export";
import { renderInsightTab } from "./insight/render";
import { evaluateEncoding, type BindingLegend } from "./encoding/evaluate";

import type { EncContext, EncNode, NodeDrawParams, EncodingBinding } from "./encoding/types";
import { scatterAxisDefaults } from "./encoding/scatter-axis-defaults";
import { axisLayout } from "./layout/axis-layout";
import { axisFallbackSpan } from "./layout/axis-fallback-span";
import { shiftAxisSpec } from "./layout/axis-shift";
import { assignGalleryAxes } from "./layout/droste-axis";
import { LaneRegistry, routeZ } from "./layout/edge-routing";
import { buildIdToRect, buildRouteObstacles } from "./layout/layout-shared";

import { buildBaseIndex } from "./bases/build-index";
import { scanBaseFiles } from "./bases/parser";
import { ensureFallbackBase } from "./bases/fallback";
import { projectBaseIndexToGraph, type BaseEdgeKind } from "./bases/project";
import type { BaseIndex } from "./bases/types";
import {
	layout,
	type LaidOut,
	type PositionedNode,
	type SizedNode,
	type ClusterRect,
} from "./layout/layout";
import type { MiniSettings, GraphNode, GraphData, ViewMode, LensPreset } from "./types";
import { CARD_CELL_W, CARD_CELL_H } from "./types";

import { clusterHue, createStripeGradient, membershipStripeHues } from "./draw/canvas-utils";
import { resolveTheme, setTheme, theme, colorAlpha } from "./draw/theme";
import { expandClustersByInheritance, computeClusterBBoxes } from "./layout/cluster-bbox";
import { contentBounds } from "./layout/content-bounds";
import { contentFit } from "./layout/content-fit";
import { drosteFit } from "./layout/droste-fit";
import { heatmapFit } from "./layout/heatmap-fit";
import { latticeFit } from "./layout/lattice-fit";
import { upsetFit } from "./layout/upset-fit";
import { runAggregateSnap } from "./layout/aggregate-snap";
import {
	drawCardGrid as drawCardGridFn,
	drawGridHeaders as drawGridHeadersFn,
	drawClusterLabels as drawClusterLabelsFn,
	drawAggregateStack as drawAggregateStackFn,
	drawJunihitoeStack as drawJunihitoeStackFn,
} from "./draw/draw-helpers";
import {
	computeMemberSets,
	computeStrictSupersets,
} from "./layout/cluster-relations";
import { computeAggregationGroups } from "./aggregation/compute";
import type { AggregationState, AggregationGroup } from "./aggregation/types";

import {
	resolveNodeDisplay as resolveNodeDisplayFn,
	resolveFromCluster as resolveFromClusterFn,
	visualScale,
	UNION_LAYER_KEY,
	INTERSECTION_LAYER_KEY,
	type NodeDisplay,
	type NodeDisplayDeps,
} from "./visual/node-display";
import { drawEulerEnclosures } from "./draw/draw-enclosures";
import { drawBubbleSetsEnclosures } from "./draw/draw-bubblesets";
import { drawBaseEdges, drawAccentEdges, drawGhostEdges } from "./draw/draw-edges";
import {
	drawUpsetFooter,
	upsetFooterHeight,
	LEFT_BAND_PX as UPSET_LEFT_BAND_PX,
} from "./draw/draw-upset";
import { drawHeatmap, heatmapGeom } from "./draw/draw-heatmap";
import { clampSpreadsheetPan } from "./interaction/spreadsheet-pan";
import { clampUpsetPanX } from "./interaction/upset-pan";
import { drawDroste } from "./draw/draw-droste";
import {
	drawLattice,
	latticeCellAt,
	latticeHeaderCheckboxHit,
	latticeNamedRowAt,
	TIER_GUTTER as LATTICE_TIER_GUTTER,
} from "./draw/draw-lattice";
import { computeLatticeDrawInput } from "./draw/lattice-draw-input";
import { computeDrosteDrawInput } from "./draw/droste-draw-input";
import { computeEnclosureDrawInput } from "./draw/enclosure-draw-input";
import { computeEdgeDrawPlan } from "./draw/edge-draw-plan";
import { computeGlobalFallbackPlan } from "./draw/global-fallback-plan";
import { metaBadges } from "./draw/meta-badges";
import { computeHeatmapDrawInput } from "./draw/heatmap-draw-input";
import { computeUpsetDrawInput } from "./draw/upset-draw-input";
import { computeAggregateStackList } from "./draw/aggregate-stack-list";
import { computeJunihitoeStackList } from "./draw/junihitoe-stack-list";
import { computeNodeDrawList } from "./draw/node-draw-list";
import { latticeNodeAt } from "./layout/lattice-layout";
import { drawCard as drawCardFn } from "./draw/draw-card";
import { drawLegend } from "./draw/legend-layout";
import { buildModeLegend, legendAnchor, type ModeLegendInput } from "./draw/mode-legend";
import { computeModeLegendInput } from "./draw/mode-legend-input";
import {
	hitDrosteRect,
	hitTest as hitTestFn,
	hitTestAggregationGroup,
	screenToWorld as screenToWorldFn,
	type DrosteHitRect,
	type HoverTarget,
} from "./interaction/hit-test";
import {
	computeDegreeMaps,
	buildAdjacency,
	filterLayoutData,
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
	settingsSubTabs,
	type SettingsSubTab,
} from "./panel/settings-tabs";
import { viewRootStyle, viewCanvasStyle } from "./view-shell-style";
import { pluralize } from "./util/pluralize";
import { jaccardSimilarity } from "./util/jaccard";
import { pointInRect } from "./util/point-in-rect";
import { clampScroll } from "./util/clamp-scroll";
import { legendScrollbarGeom } from "./interaction/legend-scrollbar";
import { renderDataTableView } from "./panel/data-table-view";
import { projectMenuNotes } from "./panel/menu-notes";
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
import { menuNoteList, menuClickAction, clampRect, noteMenuHeight, buildFolderTree, buildTagTree, advancedSearch, suggestQuery, currentToken, applySuggestionToken, stripTabPrefix, nodeIsHidden, hideKey, bulkSetHidden, collectDescendantNoteKeys, collectDescendantLeaves, folderCheckState, folderCascadeHide, checkboxAriaChecked, noteMenuRowCheckboxSpec, buildFolderPathKey, folderToggleLabel, folderDisclosure, navigatorNodeSource, suggestKeyAction, type MenuRect, type NoteRef, type TreeNode, type TreeLeaf, type Suggestion, type FolderCheckState } from "./interaction/note-menu";
import { NOTE_MENU_MIN, resolveMenuRect, clampPinnedWidth, noteMenuPanelStyle, noteMenuRectStyle, noteMenuHeadStyle, noteMenuTabButtonStyle, noteMenuTabHoverStyle, noteMenuTitleButtons, noteMenuTitleRowStyle, noteMenuBulkBarStyle, noteMenuGroupBarStyle, noteMenuSearchStyle, noteMenuBodyPanelStyle, noteMenuTabBarStyle, noteMenuTopTabs, noteMenuDataSubTabs, noteMenuTopTabDisplay, noteMenuDataSubTabDisplay, noteMenuMinimizeDisplay, suggestionKindStyle, noteMenuSuggestStyle, noteMenuSuggestSelectionStyle, noteMenuLeftGripStyle, noteMenuBottomRightGripStyle, noteMenuNotesHint, noteMenuTreeRowStyle, noteMenuLeafHighlight, noteMenuLeafRowHoverStyle, noteMenuJsonLabelStyle, noteMenuJsonTextareaStyle, noteMenuJsonButtonRowStyle, noteMenuJsonTitleStyle, noteMenuJsonStatusStyle, type NoteMenuTab, type NoteMenuDataSubTab } from "./interaction/note-menu-geom";
import { heatmapCellNoteIds } from "./interaction/heatmap-detail";
import { heatmapCellTipText, ghostEdgeTipText, clusterTipText, aggregationGroupTipText } from "./interaction/hover-tip-text";
import { zoomAroundPointer, fitTransform } from "./interaction/zoom-math";
import { buildViewStateBundle, formatJsonStatusLines, jsonExportLabel, presetFileName, parsePresets, mergePresets } from "./interaction/preset-io";
import { mergeBundled } from "./interaction/bundled-presets";
import { hitHeatmapCell } from "./interaction/hit-modes";

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
	private aggregationState: AggregationState = {
		groups: new Map(),
		nodeToGroup: new Map(),
		aggregatedNodeIds: new Set(),
	};
	private highlightedHavingClusters: Map<string, number> = new Map();
	// The primary hovered node id (NOT the set of connected ones). Used to
	// pick outgoing vs incoming edge colours: edge.source === hoveredNodeId
	// is an OUTGOING link (out from this node), edge.target === hoveredNodeId
	// is an INCOMING backlink (into this node).
	private hoveredNodeId: string | null = null;
	// Clickable card rects (device px) recorded by the grid-mode Droste renderer,
	// so grid-mode hit-testing reuses the drawn geometry instead of re-deriving it.
	private drosteHit: DrosteHitRect[] = [];
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
	private settingsLayerExpanded: Set<string> = new Set();
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
	private activeMenuTab: NoteMenuTab = "data";
	// Sensitivity coefficient K for the Insight tab's cognitive-load thresholds
	// (1.0–5.0). In-memory; survives rebuilds, adjustable via the tab's slider.
	private clInsightK = 2.0;
	// Only show the global Notice once per Obsidian session to prevent spam.
	private hasShownCognitiveAlert = false;
	// The live container the settings tab renders into (replaces the old docking
	// panel's `panelEl` as the host that `applyTabFilter`/`renderTabButton` query).
	private settingsHostEl: HTMLElement | null = null;
	private dataHostEl: HTMLElement | null = null;
	private jsonHostEl: HTMLElement | null = null;

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
	// Bases integration (Stage 2): the last successfully built index when
	// selectedBases is non-empty, else null. Held so future stages (relation
	// inspection / hover detail) can read it; rebuild() rebuilds it each pass.
	private baseIndex: BaseIndex | null = null;
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
				const path = stripTabPrefix(id);
				const f = this.app.vault.getAbstractFileByPath(path);
				return f instanceof TFile ? f.basename : path;
			});
		}
		return out;
	}
	private displayMode: Map<string, "full" | "brief"> = new Map();
	private degreeMap: Map<string, number> = new Map();
	// Visual Encoding output (computed per rebuild): per-node draw params + legends.
	private encParams: Map<string, NodeDrawParams> = new Map();
	private encLegends: BindingLegend[] = [];
	// True when the colour channel is unbound OR bound to the tag/cluster field.
	// Only then may a multi-tag NOTE be striped with its tag colours — otherwise
	// the colour channel encodes some OTHER attribute and a tag-coloured stripe
	// would contradict it. Recomputed each rebuild from the effective encoding.
	private colorIsTagBased = true;
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
	private settingsSubTab: SettingsSubTab = "view";
	private dataSubTab: NoteMenuDataSubTab = "logic";
	private insightSubTab: "overview" | "alerts" | "suggest" = "overview";
	// UpSet mode: signature key (= `signature.join("|")`) of the column
	// currently selected by the user (highlighted in the matrix; drives
	// the detail panel listing in Phase C). null = nothing selected.
	private upsetSelectedSignatureKey: string | null = null;
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
		root.setCssStyles(viewRootStyle());
		this.root = root;

		// Resolve Obsidian's theme colours into concrete strings for the canvas
		// (Canvas 2D cannot read CSS variables). Re-resolved on `css-change`.
		setTheme(resolveTheme(root));

		this.canvas = root.createEl("canvas");
		this.canvas.setCssStyles(viewCanvasStyle());
		const ctx2d = this.canvas.getContext("2d");
		if (!ctx2d) throw new Error("Tag Lens: 2D canvas context unavailable");
		this.ctx = ctx2d;

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
		if (file?.extension !== 'md') return; 

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
		if (!currentGraphData?.nodes) return;

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
			const hasLinkFromActive = (resolvedLinks[activePath]?.[node.id]) ? 1 : 0;
			const hasLinkToActive = (resolvedLinks[node.id] && resolvedLinks[node.id][activePath]) ? 1 : 0;
			const hasLink = (hasLinkFromActive || hasLinkToActive) ? 1 : 0;

			// Jaccard 係数の計算
			const nodeFile = this.app.vault.getAbstractFileByPath(node.id);
			let jaccard = 0;

			if (nodeFile instanceof TFile) {
				const nodeCache = this.app.metadataCache.getFileCache(nodeFile);
				const nodeTags = nodeCache?.tags?.map(t => t.tag.toLowerCase()) || [];
				const nodeTagSet = new Set(nodeTags);
				// Empty union (both tag-less) → 0, matching the old size-guarded path.
				jaccard = jaccardSimilarity(activeTagSet, nodeTagSet);
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
		subBar.setCssStyles(noteMenuTabBarStyle("settings"));
		const content = host.createDiv({ cls: "gim-panel-content" });
		const SUBS = settingsSubTabs();
		const subBtns = new Map<string, HTMLElement>();
		const styleSubs = (): void => {
			for (const { key } of SUBS) {
				const b = subBtns.get(key);
				if (!b) continue;
				const on = this.settingsSubTab === key;
				b.setCssStyles(noteMenuTabButtonStyle(on, { padding: "4px 8px", fontSize: "10.5px" }));
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
						expandedLayers: this.settingsLayerExpanded,
						toggleLayerExpanded: (k) => {
							if (this.settingsLayerExpanded.has(k)) this.settingsLayerExpanded.delete(k);
							else this.settingsLayerExpanded.add(k);
						}
					});
					break;
			}
		};
		for (const { key, label } of SUBS) {
			const b = subBar.createEl("button", { text: label });
			subBtns.set(key, b);
			b.addEventListener("click", () => { this.settingsSubTab = key; styleSubs(); renderSub(); });
			b.addEventListener("mouseenter", () => { if (this.settingsSubTab !== key) b.setCssStyles(noteMenuTabHoverStyle()); });
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
			app: this.app,
			settings: this.settings,
			save: () => void this.save(),
			rebuild: () => void this.rebuild(),
			refreshFilterTab: () => this.refreshFilterTab(),
			refreshSettingsTab: () => this.refreshSettingsTab(),

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
		this.jsonHostEl = host;
		host.empty();
		const title = host.createDiv({ text: "Presets — JSON import / export" });
		title.setCssStyles(noteMenuJsonTitleStyle());

		// ── Export ──
		const presetCount = this.settings.lensPresets.length;
		const nodeCount = this.laid?.nodes?.length || 0;
		const expLabel = host.createDiv({ text: jsonExportLabel(nodeCount, presetCount) });
		expLabel.setCssStyles(noteMenuJsonLabelStyle("4px 0 2px"));

		// Node-stripping + schema/version wrapping + lensPresets split now live in
		// the pure buildViewStateBundle (preset-io); the view just serializes it.
		const json = JSON.stringify(buildViewStateBundle(this.laid?.nodes || [], this.settings), null, 2);
		const ta = host.createEl("textarea");
		ta.value = json;
		ta.readOnly = true;
		ta.setCssStyles(noteMenuJsonTextareaStyle("110px"));
		ta.addEventListener("mousedown", (ev) => ev.stopPropagation());
		const btnRow = host.createDiv();
		btnRow.setCssStyles(noteMenuJsonButtonRowStyle());
		const copyBtn = btnRow.createEl("button", { text: "Copy to clipboard" });
		copyBtn.addEventListener("click", (ev) => { ev.stopPropagation(); void this.copyTextToClipboard(json); });
		const saveBtn = btnRow.createEl("button", { text: "Save .json to vault" });
		saveBtn.addEventListener("click", (ev) => { ev.stopPropagation(); void this.savePresetsJson(json); });

		// ── Import ──
		const impLabel = host.createDiv({ text: "Import" });
		impLabel.setCssStyles(noteMenuJsonLabelStyle("12px 0 2px"));
		const impTa = host.createEl("textarea");
		impTa.placeholder = "Paste preset JSON here (bundle or array)…";
		impTa.setCssStyles(noteMenuJsonTextareaStyle("90px"));
		impTa.addEventListener("mousedown", (ev) => ev.stopPropagation());
		const impRow = host.createDiv();
		impRow.setCssStyles(noteMenuJsonButtonRowStyle());
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
				? `Imported ${pluralize(presets.length, "preset")}.`
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
			this.renderDataJsonBody(host, { msg: `Added ${pluralize(added, "bundled preset")}.`, errors: [] });
		});

		// ── Status (last import / bundled-load) ──
		if (status) {
			const statusStyle = noteMenuJsonStatusStyle(status.errors.length > 0);
			const st = host.createDiv({ text: status.msg });
			st.setCssStyles(statusStyle.status);
			const { errorLines, moreText } = formatJsonStatusLines(status.errors);
			for (const text of errorLines) {
				const line = host.createDiv({ text });
				line.setCssStyles(statusStyle.errorLine);
			}
			if (moreText) {
				const more = host.createDiv({ text: moreText });
				more.setCssStyles(statusStyle.more);
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

	private refreshJsonTab(): void {
		if (this.noteMenu && this.activeMenuTab === "data" && this.dataSubTab === "json" && this.jsonHostEl) {
			this.renderDataJsonBody(this.jsonHostEl);
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
			// Display-only toggle → keep the existing layout, just repaint.
			this.requestDraw();
			this.refreshJsonTab();
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


		// ── Bases FALLBACK: if the vault has zero `.base` files, synthesise `_all.base`
		// and auto-select it so the user sees every note graphed.
		try {
			if (scanBaseFiles(this.app).length === 0) {
				const created = await ensureFallbackBase(this.app);
				if (created && !this.settings.selectedBases.includes(created.path)) {
					this.settings.selectedBases.push(created.path);
					void this.save();
				}
			}
		} catch (e) {
			console.warn("[tag-lens] Bases fallback generation skipped:", e);
		}

		let data: GraphData = { nodes: [], edges: [] };
		let clusterLabels = new Map<string, string>();

		if (this.settings.selectedBases.length > 0) {
			try {
				const edgeKinds = new Set<BaseEdgeKind>();
				if (this.settings.basesLinkEdges) edgeKinds.add("link");
				if (this.settings.basesSharedTagEdges) edgeKinds.add("shared-tag");
				if (this.settings.basesSharedPropEdges) edgeKinds.add("shared-property");
				this.baseIndex = await buildBaseIndex(this.app, this.settings.selectedBases, {
					link: this.settings.basesLinkEdges,
					sharedTag: this.settings.basesSharedTagEdges,
					sharedProp: this.settings.basesSharedPropEdges,
					resolvedLinks: this.app.metadataCache.resolvedLinks,
				});
				if (this.baseIndex.errors.length) {
					console.warn("[tag-lens] Bases index warnings:", this.baseIndex.errors);
				}
				const { data: baseData, clusterLabels: baseLabels } = projectBaseIndexToGraph(
					this.baseIndex,
					{
						clusterByView: !!this.settings.basesClusterByView,
						showPrefix: !!this.settings.basesShowPrefix,
						injectBaseEnclosures: this.settings.viewMode === "bubblesets",
						focusNodeIds: this.settings.focusNodeIds,
						edgeKinds,
						labelOf: (notePath) => {
							const f = this.app.vault.getAbstractFileByPath(notePath);
							return f instanceof TFile ? f.basename : notePath;
						},
						mtimeOf: (notePath) => {
							const f = this.app.vault.getAbstractFileByPath(notePath);
							return f instanceof TFile ? f.stat.mtime : undefined;
						},
					},
				);
				data = baseData;
				clusterLabels = baseLabels;
			} catch (e) {
				this.baseIndex = null;
				console.error("[tag-lens] Bases projection failed:", e);
				new Notice("Tag Lens: Bases projection failed. See console.");
			}
		} else {
			this.baseIndex = null;
		}

		// ── Early-out: skip the (expensive) relayout/redraw/menu-rebuild when the
		// graph INPUTS are byte-for-byte identical to the last build.
		const rebuildSig = JSON.stringify({
			n: data.nodes.map((n) => [n.id, n.label, n.memberships ?? []]),
			e: data.edges.map((e) => [e.source, e.target]),
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
				console.error("[tag-lens] cognitive-load metric failed:", e);
			}
		}

		this.highlightedHavingClusters.clear();
		this.clusterLabels = clusterLabels;

		// Containment lens operates vault-wide: snapshot the graph
		const drosteFullData =
			this.settings.viewMode === "droste"
				? { nodes: data.nodes.slice(), edges: data.edges.slice() }
				: undefined;
		this.drosteData = drosteFullData ?? null;
		
		this.removeNoteMenu();
		this.locatedNoteId = null;

		const degrees = computeDegreeMaps(data.edges);
		this.degreeMap = degrees.degreeMap;
		this.inDegreeMap = degrees.inDegreeMap;
		this.outDegreeMap = degrees.outDegreeMap;

		const modes = new Map<string, "full" | "brief">();
		for (const n of data.nodes) modes.set(n.id, "full");
		this.displayMode = modes;

		// Note list for the note navigator.
		const menuNodeSource = navigatorNodeSource({
			isDroste: this.settings.viewMode === "droste",
			galleryNodes: drosteFullData?.nodes ?? [],
			limitedNodes: data.nodes,
		});
		this.menuNotes = projectMenuNotes(menuNodeSource, this.app);

		if (gen !== this.rebuildGen) return;

		// Recompute the cluster member sets + strict supersets against the
		// CURRENT graph so the NODE_DISPLAY override chain reflects
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
		const effEnc = this.settings.encoding ?? [];
		const encRes = evaluateEncoding(layoutData.nodes, effEnc, encCtx, this.settings.viewMode);
		this.encParams = encRes.params;
		this.encLegends = encRes.legends;
		// A multi-tag note may be striped with its tag colours only when the
		// colour channel does NOT encode some other attribute. An enabled colour
		// binding to anything but the tag field claims the fill, so the stripe
		// stands down (the legend would otherwise lie). No colour binding (or a
		// `color`→`tag` binding) ⇒ tag-based ⇒ stripe is the natural fill.
		const colorBinding = effEnc.find((b) => b.enabled && b.channelId === "color");
		this.colorIsTagBased = !colorBinding || colorBinding.fieldId === "tag";

		// Card sizes derive from the user-configured row × column span
		// times the canonical CARD_CELL_W × CARD_CELL_H lattice step, with
		// an optional encoding-driven scale that preserves the m : n aspect.
		const sized = layoutData.nodes.map((n) => this.cardFor(n));
		const wasEmpty = this.laid.clusters.length === 0;

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
			heatmapCriterion: this.settings.heatmapCriterion,
			heatmapSortDir: this.settings.heatmapSortDir,
			ghostBridges: this.settings.showGhostEdges ? this.currentBridges : undefined,
		});

		// Node Aggregation by Attribute (Junihitoe)
		this.aggregationState = computeAggregationGroups(
			this.laid.nodes,
			this.settings,
			this.settings.viewMode
		);

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

		// Stage 5: id → incident-edge-index adjacency for hover lookups.
		this.adjacency = buildAdjacency(this.laid.edges);

		// Custom axis layout (Encode → Position X/Y): override card placement when
		// axisX/axisY are bound. Reads only — never changes the displayed node set.
		// Runs AFTER layout because it requires `this.laid.slotW` to compute coordinates.
		this.applyAxisLayout(effEnc, encCtx);



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
		this.highlightedNodes.clear();
		this.highlightedEdgeIdx.clear();
		// Drop a selected column if the relayout removed it (UpSet).
		this.clearStaleSelection();
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
		this.refreshJsonTab();
	}
	private applyAxisLayout(effEnc: EncodingBinding[], encCtx: EncContext): void {
		let bindingX = effEnc.find((b) => b.channelId === "axisX");
		let bindingY = effEnc.find((b) => b.channelId === "axisY");
		// Scatter (F2) is DEFINED by its two quantitative axes — unlike the
		// euler/bubblesets overlay they are always on, defaulting to degree/ageDays
		// when the user has not bound them. The user's enabled bindings still win.
		if (this.settings.viewMode === "scatter") {
			const def = scatterAxisDefaults(bindingX, bindingY);
			bindingX = def.x;
			bindingY = def.y;
		}
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
			this.settings.viewMode === "bubblesets" ||
			this.settings.viewMode === "scatter";

		if (!isCardMode) {
			this.laid.axes = undefined;
			return;
		}

		const { width: fallbackWidth, height: fallbackHeight } =
			axisFallbackSpan(this.laid.nodes.length, this.laid.slotW, this.laid.slotH);

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

		this.laid.axes = {
			x: shiftAxisSpec(axes.x, cx),
			y: shiftAxisSpec(axes.y, cy),
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
				bubble: this.settings.viewMode === "bubblesets",
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

	private fitToView(): void {
		// UpSet: cards sit in the MAIN area above the screen-space
		// footer. Fit them into (canvas.height - footerH) so the cards
		// and the matrix never overlap, full canvas width horizontally.
		if (this.laid.upset) {
			const u = this.laid.upset;
			// UpSet fit: cards occupy the canvas ABOVE the footer
			// (full canvas width). Footer is screen-fixed at bottom.
			// Zoom to show ~8–20 card rows vertically; horizontal zoom
			// fits all columns into the canvas width. panX is set by
			// clampPan() (called inside requestDraw) — upsetFit returns 0.
			const footerH = upsetFooterHeight(
				this.canvas.clientHeight,
				u.sets.length,
			);
			const fit = upsetFit(
				u.cardSlotH,
				u.cardsWorldHeight,
				u.cardsWorldWidth,
				footerH,
				this.canvas.clientWidth,
				this.canvas.clientHeight,
				UPSET_LEFT_BAND_PX,
			);
			this.zoom = fit.zoom;
			this.panX = fit.panX;
			this.panY = fit.panY;
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
			const fit = latticeFit(L.worldWidth, L.worldHeight, visW, visH, LATTICE_TIER_GUTTER);
			this.zoom = fit.zoom;
			this.panX = fit.panX;
			this.panY = fit.panY;
			this.requestDraw();
			return;
		}
		if (this.laid.heatmap) {
			// Square n×n grid: fit all cells into the smaller of the two data-area
			// dimensions; pin the origin just past the frozen label bands.
			const fit = heatmapFit(this.laid.heatmap, this.canvas.clientWidth, this.canvas.clientHeight);
			this.zoom = fit.zoom;
			this.panX = fit.panX;
			this.panY = fit.panY;
			this.requestDraw();
			return;
		}
		if (this.laid.drosteGallery) {
			// Icon Gallery: centre on the focus node's cell at a readable zoom.
			this.centerDrosteOn(this.settings.drosteFocus || this.laid.drosteGallery.cells[0]?.id || "");
			return;
		}
		const bounds = contentBounds(this.laid.clusters, this.laid.nodes);
		if (!bounds) return;
		// The settings panel overlays the right side of the canvas without
		// pushing it, so subtract its width from the effective fit area and
		// centre against the visible half.
		const panelW = this.pinnedMenuWidth();
		const visW = Math.max(1, this.canvas.clientWidth - panelW);
		const visH = this.canvas.clientHeight;
		const fit = contentFit(bounds, visW, visH);
		this.zoom = fit.zoom;
		this.panX = fit.panX;
		this.panY = fit.panY;
		this.requestDraw();
	}

	// Clamp panX/panY so the area to the LEFT of column A or ABOVE row 1 can
	// never be revealed. The header band occupies the first headerW × headerH
	// screen pixels; the body must start at exactly worldX = minCol*W (the
	// left edge of column A) at screen x = headerW. That gives the upper-
	// bound constraint panX ≤ headerW − minCol*W*zoom. Same logic for Y.
	private clampPan(): void {
		// Heatmap: this screen-space frozen-pane grid is drawn AND hit-tested
		// across the FULL canvas width (drawHeatmap uses canvas.width/dpr;
		// heatmapCellAt uses canvas.clientWidth) — the pinned note menu is an
		// overlay, it does not narrow the canvas. So the clamp must compute
		// geometry with the same full clientWidth, NOT clientWidth-panelW;
		// otherwise the panel-narrowed width yields a smaller labelBand and
		// clamps panX to the left of the drawn label band, hiding the first
		// column(s) and shifting every click off by ≥1 cell.
		const fullW = Math.max(1, this.canvas.clientWidth);
		const fullH = this.canvas.clientHeight;

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
		// Cards (= the "Pareto-shaped" card-stack columns) and their
		// matching matrix dots must start at the RIGHT edge of the
		// footer's row-label band (`UPSET_LEFT_BAND_PX`), never to
		// the left of it — per user spec (2026-05-26).
		this.panX = clampUpsetPanX(
			this.panX,
			u.cardsWorldWidth * this.zoom,
			this.canvas.clientWidth,
			UPSET_LEFT_BAND_PX,
		);
	}

	private drawGlobalDisplayFallbacks(ctx: CanvasRenderingContext2D, dpr: number, mode: string): void {
		const cw = this.canvas.width;
		const ch = this.canvas.height;
		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const baseAlpha = 0.05;
		// Pure per-mode gating for every overlay layer/badge below (`mode` last so
		// it wins over any settings.mode).
		const plan = computeGlobalFallbackPlan({ ...this.settings, mode });

		// 1. showGrid: draw a subtle background grid.
		// Exclude euler since it natively draws a strong grid. Droste draws its own
		// Cartesian cell grid (drawDefaultGrid / drawAxisGrid). Matrix/Heatmap don't have native grid.
		if (plan.drawGrid) {
			ctx.strokeStyle = `rgba(128, 128, 128, ${baseAlpha * 2})`;
			ctx.lineWidth = 1;
			ctx.beginPath();
			for (let x = 0; x < cw / dpr; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, ch / dpr); }
			for (let y = 0; y < ch / dpr; y += 40) { ctx.moveTo(0, y); ctx.lineTo(cw / dpr, y); }
			ctx.stroke();
		}

		// 2. showEnclosures: draw a bounding box around the canvas
		// Exclude euler since it natively has enclosures.
		if (plan.drawEnclosures) {
			ctx.strokeStyle = `rgba(255, 128, 0, ${baseAlpha * 4})`;
			ctx.lineWidth = 4;
			ctx.strokeRect(4, 4, cw / dpr - 8, ch / dpr - 8);
		}

		// 3. showEdges: decorative faint connecting lines from corners
		// Exclude euler since it draws native edges.
		if (plan.drawEdges) {
			ctx.strokeStyle = `rgba(0, 128, 255, ${baseAlpha})`;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(0, 0); ctx.lineTo(cw / dpr, ch / dpr);
			ctx.moveTo(cw / dpr, 0); ctx.lineTo(0, ch / dpr);
			ctx.stroke();
		}

		// 4. showNodes: small badge in top right
		// Exclude euler/upset/bubblesets since they natively draw nodes.
		if (plan.drawNodesBadge) {
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

		for (const badge of metaBadges(plan, this.settings.nodeRows, this.settings.nodeCols)) {
			drawBadge(badge.label, badge.color);
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
		// Intersection lattice: world-space tier grid + subset links. drawLattice
		// applies its own dpr/zoom/pan transform; we draw and return.
		if (this.laid.lattice && this.laid.lattice.nodes.length > 0) {
			drawLattice(ctx, this.laid.lattice, computeLatticeDrawInput({
				settings: this.settings,
				canvas: this.canvas,
				dpr,
				zoom: this.zoom,
				panX: this.panX,
				panY: this.panY,
				selectedKey: this.latticeSelectedKey,
				hoverKey: this.latticeHoverKey,
				namedKeys: this.latticeNamedKeys,
				// Closure: id → file basename via the live vault. Falls back
				// to a path-tail strip inside draw-lattice when omitted, so
				// unit tests / probes still work without a vault.
				nameOf: (id: string) => {
					const path = stripTabPrefix(id);
					const f = this.app.vault.getAbstractFileByPath(path);
					return f instanceof TFile ? f.basename : path;
				},
			}));
			this.drawGlobalDisplayFallbacks(ctx, dpr, "lattice");
			return;
		}
		// Containment lens = Icon Gallery: every node's icon diagram, tiled, pan/zoomed.
		if (this.laid.drosteGallery && this.laid.drosteGallery.cells.length > 0) {
			drawDroste(ctx, computeDrosteDrawInput({
				settings: this.settings,
				canvas: this.canvas,
				dpr,
				gallery: this.laid.drosteGallery,
				cellSize: DROSTE_CELL,
				zoom: this.zoom,
				panX: this.panX,
				panY: this.panY,
				hoverId: this.hoveredNodeId,
				// biome-ignore lint/suspicious/noAssignInExpressions: assign-and-pass the live hit-region array so the draw path fills the same ref we read back on hit-testing
				hitRegions: (this.drosteHit = []),
			}));
			this.drawGlobalDisplayFallbacks(ctx, dpr, "droste");
			return;
		}
		// Tag co-occurrence heatmap: screen-space frozen-pane cell grid.
		if (this.laid.heatmap && this.laid.heatmap.n > 0) {
			drawHeatmap(ctx, this.laid.heatmap, computeHeatmapDrawInput({
				settings: this.settings,
				canvas: this.canvas,
				dpr,
				zoom: this.zoom,
				panX: this.panX,
				panY: this.panY,
				// this.currentGaps is computed in rebuild() via findGaps when the
				// gapFinder toggle is on (empty otherwise).
				gaps: this.currentGaps,
				selected: this.heatmapSelected,
				hoverRow: this.heatmapHoverRow,
				hoverCol: this.heatmapHoverCol,
			}));
			this.drawGlobalDisplayFallbacks(ctx, dpr, "heatmap");
			return;
		}
		const upsetHasColumns = (this.laid.upset?.columns.length ?? 0) > 0;
		const heatmapHasCells = (this.laid.heatmap?.n ?? 0) > 0;
		const latticeHasNodes = (this.laid.lattice?.nodes.length ?? 0) > 0;
		if (
			this.laid.nodes.length === 0 &&
			!upsetHasColumns &&
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
		ctx.setTransform(dpr * this.zoom, 0, 0, dpr * this.zoom, dpr * this.panX, dpr * this.panY);

		// Excel-style row/column underlay. Drawn first so enclosures, edges,
		// trunks, and cards all sit on top. Cells follow card geometry and
		// ignore the cluster bounding boxes by design.
		if (this.settings.showGrid && !this.laid.upset) {
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

		if (this.settings.showGrid && !this.laid.upset) {
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
				computeUpsetDrawInput({
					settings: this.settings,
					canvas: this.canvas,
					dpr,
					zoom: this.zoom,
					panX: this.panX,
					panY: this.panY,
					selectedSignatureKey: this.upsetSelectedSignatureKey,
				}),
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
		const encl = computeEnclosureDrawInput({
			settings: this.settings,
			upset: !!this.laid.upset,
			clusters: this.laid.clusters,
			nodes: this.laid.nodes,
			highlightedClusters: this.highlightedClusters,
			zoom: this.zoom,
			hoveredNodeId: this.hoveredNodeId,
		});
		if (encl) {
			const paint =
				encl.kind === "bubblesets"
					? drawBubbleSetsEnclosures
					: drawEulerEnclosures;
			paint(
				ctx,
				encl.clusters,
				encl.highlightedClusters,
				encl.warningClusters,
				encl.zoom,
				encl.hoverPos,
			);
		}

		const edgePlan = computeEdgeDrawPlan({
			showEdges: this.settings.showEdges,
			showGhostEdges: this.settings.showGhostEdges,
			upset: !!this.laid.upset,
			hasHighlight,
		});

		if (edgePlan.drawGhost) {
			drawGhostEdges(
				ctx,
				this.laid,
				this.zoom,
				skipNode
			);
		}

		if (edgePlan.drawBase) {
			drawBaseEdges(
				ctx,
				this.laid,
				this.zoom,
				this.highlightedEdgeIdx,
				skipNode,
			);
		}

		const nodeDrawList = computeNodeDrawList({
			nodes: this.laid.nodes,
			highlightedNodes: this.highlightedNodes,
			aggregatedNodeIds: this.aggregationState.aggregatedNodeIds,
			skipNode,
		});

		if (this.settings.showNodes) {
			for (const n of nodeDrawList.base) {
				this.drawCard(ctx, n, false);
			}
		}

		// Node Aggregation: Junihitoe Stacks
		const junihitoeStacks = computeJunihitoeStackList({
			showNodes: this.settings.showNodes,
			nodes: this.laid.nodes,
			groups: this.aggregationState.groups,
			highlightedNodes: this.highlightedNodes,
		});
		for (const s of junihitoeStacks) {
			this.drawJunihitoeStack(ctx, s.group, s.cardW, s.cardH, s.isHigh);
		}

		const aggregateStacks = computeAggregateStackList({
			showNodes: this.settings.showNodes,
			nodes: this.laid.nodes,
			clusters: this.laid.clusters,
			aggregateCount: this.aggregateCount,
			highlightedClusters: this.highlightedClusters,
		});
		for (const s of aggregateStacks) {
			this.drawAggregateStack(ctx, s.cluster, s.cardW, s.cardH, s.count, s.isHigh);
		}

		if (edgePlan.drawAccent) {
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
			for (const n of nodeDrawList.highlighted) {
				this.drawCard(ctx, n, true);
			}
		}

		// Overview auxiliary labels (the big centred name per enclosure)
		// removed per user request: the giant watermark text collided with
		// cards and with the small on-grid title bars. The on-grid title
		// bars (drawClusterLabels) remain the single source of cluster names.
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
			undefined,
			// BubbleSets de-conflicts labels OUT of their boxes at layout time;
			// don't clamp them back in (that re-creates the overlaps).
			this.settings.viewMode !== "bubblesets",
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

	private drawJunihitoeStack(
		ctx: CanvasRenderingContext2D,
		group: AggregationGroup,
		cardW: number,
		cardH: number,
		highlighted = false,
	): void {
		drawJunihitoeStackFn(
			ctx,
			group,
			cardW,
			cardH,
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
		const baseId = stripTabPrefix(n.id);
		const scale = this.getCardScale(baseId);


		// BubbleSets: clean figure — suppress Shape and Tag (title) rendering.
		const isBubbles = this.settings.viewMode === "bubblesets";

		drawCardFn(ctx, n, {
			scale,
			bodyLines: [],
			showBody: false, // body preview removed
			highlighted,
			zoom: this.zoom,
			minFontPx: this.settings.minFontPx,
			// Clustered notes carry their island's main-tag in hueKey → muted tint.
			tintHue: n.hueKey ? clusterHue(n.hueKey) : undefined,
			fmMaturity: n.fmMaturity,
			showMaturity: this.settings.showMaturity,
			encFillColor: this.encParams.get(n.id)?.fillColor,
			// A NOTE that belongs to MULTIPLE tags sits in their ∩, so it must read
			// as the VERTICAL stripe of its tag colours — NOT the single colour of
			// its first tag (the old field-source[0] behaviour) and NOT the solid
			// encFillColor (which the legend says is striped for ∩). Mirrors the
			// lattice intersection-node rule. Applies to ALL note cards so
			// BubbleSets/Euler/UpSet individual cards stripe too. Guarded by
			// `colorIsTagBased` so a non-tag colour encoding keeps its solid fill.
			multiTagStripe: this.multiTagStripeFor(ctx, n),
			encOpacity: this.encParams.get(n.id)?.opacity,
			encBorderColor: this.encParams.get(n.id)?.borderColor,
			encShape: isBubbles ? undefined : this.encParams.get(n.id)?.shape,
		});
	}

	// Build the ∩ vertical stripe for a NOTE card that belongs to MULTIPLE tags,
	// or `undefined` when the card must stay SOLID. Returns undefined when:
	//   • the node is a SET node (it owns the fillPattern/fillHue union path), or
	//   • the colour channel encodes a non-tag attribute (`colorIsTagBased` false
	//     ⇒ the encFillColor stands, so the stripe would contradict the legend), or
	//   • the node has ≤1 real tag (NONE_BUCKET dropped) ⇒ single-tag → solid.
	// Otherwise it paints a one-cycle vertical gradient across the card bbox —
	// one equal band per tag colour — identical to the lattice intersection node.
	private multiTagStripeFor(
		ctx: CanvasRenderingContext2D,
		n: PositionedNode,
	): CanvasGradient | string | undefined {
		if (!this.colorIsTagBased) return undefined;
		const hues = membershipStripeHues(n.memberships);
		if (hues.length <= 1) return undefined; // single-tag / untagged → solid
		return createStripeGradient(
			ctx,
			n.x - n.width / 2,
			n.y - n.height / 2,
			n.width,
			n.height,
			hues,
			/*isVertical=*/ true, // ∩ intersection → vertical bands
		);
	}

	// F5: gather the per-mode legend input (encoding specs + cluster swatches +
	// count range + heatmap flag) from the current layout. Pure read — never
	// mutates state, so the legend stays a display-only overlay.
	private buildModeLegendInput(): ModeLegendInput {
		// Thin wrapper: forward the view's live state into the pure builder
		// (src/draw/mode-legend-input.ts). resolveLayerDisplay is the only
		// behavioural callback the builder needs.
		return computeModeLegendInput({
			settings: this.settings,
			laid: this.laid,
			encLegends: this.encLegends,
			clusterLabels: this.clusterLabels,
			zoom: this.zoom,
			resolveLayerDisplay: (k) => this.resolveLayerDisplay(k),
		});
	}

	private screenToWorld(sx: number, sy: number): { x: number; y: number } {
		return screenToWorldFn(sx, sy, this.panX, this.panY, this.zoom);
	}

	private hitTest(wx: number, wy: number): HoverTarget {
		// 1. Check node aggregation groups (Junihitoe stacks) first
		if (this.aggregationState.groups.size > 0 && this.laid.nodes.length > 0) {
			// Stacks are roughly the same size as cards (subW/subH in drawJunihitoeStack)
			const hit = hitTestAggregationGroup(
				wx,
				wy,
				this.aggregationState.groups.values(),
				this.laid.nodes[0].width,
				this.laid.nodes[0].height,
				this.zoom,
			);
			if (hit) return hit;
		}

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
		const path = stripTabPrefix(id);
		this.isInternalClick = true;
		void this.app.workspace.openLinkText(path, "", false);
	}

	// Centre the gallery viewport on node `id`'s cell at a readable zoom.
	private centerDrosteOn(id: string): void {
		const g = this.laid.drosteGallery;
		if (!g) return;
		const cell = g.cells.find((c) => c.id === id) ?? g.cells[0];
		if (!cell) return;
		const fit = drosteFit(cell, this.canvas.clientWidth, this.canvas.clientHeight, DROSTE_CELL);
		this.zoom = fit.zoom;
		this.panX = fit.panX;
		this.panY = fit.panY;
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
		// Pinned docks to the RIGHT edge so the canvas reserves `this.pinnedMenuWidth()`
		// and the figure isn't covered; floating is a positioned box at `rect`.
		panel.setCssStyles(noteMenuPanelStyle(pinned, rect, pinnedW));
		const head = panel.createDiv();
		head.setCssStyles(noteMenuHeadStyle(pinned));
		// Title row: name on the left, pin + × on the right.
		const titleRowStyle = noteMenuTitleRowStyle();
		const titleRow = head.createDiv();
		titleRow.setCssStyles(titleRowStyle.row);
		titleRow.createSpan({ text: "Tag Lens" });
		const headBtns = titleRow.createDiv();
		headBtns.setCssStyles(titleRowStyle.btns);
		const titleBtns = noteMenuTitleButtons(pinned);

		// Pin/unpin: dock the menu to the right edge (standard pin affordance).
		const pinBtn = headBtns.createSpan();
		pinBtn.setCssStyles(titleBtns.pin.style);
		if (titleBtns.pin.icon) setIcon(pinBtn, titleBtns.pin.icon);
		pinBtn.setAttr("aria-label", titleBtns.pin.ariaLabel);
		pinBtn.addEventListener("mousedown", (ev) => ev.stopPropagation());
		pinBtn.addEventListener("dblclick", (ev) => ev.stopPropagation());
		pinBtn.addEventListener("click", (ev) => { ev.stopPropagation(); this.togglePin(); });
		const closeBtn = headBtns.createSpan({ text: "×" });
		closeBtn.setCssStyles(titleBtns.close.style);
		closeBtn.setAttr("aria-label", titleBtns.close.ariaLabel);
		closeBtn.addEventListener("mousedown", (ev) => ev.stopPropagation());
		closeBtn.addEventListener("dblclick", (ev) => ev.stopPropagation());
		closeBtn.addEventListener("click", (ev) => { ev.stopPropagation(); this.toggleNoteMenu(); });
		// ── Top-level tabs: Notes | Settings ─────────────────────────────────────
		const tabBar = head.createDiv();
		// Underline-style tabs: the bar carries the divider line that the active
		// tab's accent underline sits on (marginBottom:-1px lines them up), so the
		// active tab reads as connected to the body below.
		tabBar.setCssStyles(noteMenuTabBarStyle("top"));
		tabBar.addEventListener("mousedown", (ev) => ev.stopPropagation());
		// Don't let a double-click on the tab bar toggle the header's minimize.
		tabBar.addEventListener("dblclick", (ev) => ev.stopPropagation());
		// Two tab panes under a flex wrapper that fills the rest of the panel.
		const bodyWrap = panel.createDiv();
		bodyWrap.setCssStyles({ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: "0", overflow: "hidden" });
		
		const dataTabWrap = bodyWrap.createDiv({ cls: "gim-menu-data-wrap" });
		dataTabWrap.setCssStyles(noteMenuBodyPanelStyle("column", "none"));

		const dataSubBar = dataTabWrap.createDiv();
		dataSubBar.setCssStyles(noteMenuTabBarStyle("sub"));

		const logicTab = dataTabWrap.createDiv({ cls: "gim-menu-data-logic" });
		logicTab.setCssStyles(noteMenuBodyPanelStyle("scroll", "block"));

		const treeTab = dataTabWrap.createDiv({ cls: "gim-menu-data-tree" });
		treeTab.setCssStyles(noteMenuBodyPanelStyle("column", "none"));

		const tableTab = dataTabWrap.createDiv({ cls: "gim-menu-data-table" });
		tableTab.setCssStyles(noteMenuBodyPanelStyle("scroll", "none"));

		const jsonTab = dataTabWrap.createDiv({ cls: "gim-menu-data-json" });
		jsonTab.setCssStyles(noteMenuBodyPanelStyle("scroll", "none"));

		const settingsTab = bodyWrap.createDiv({ cls: "gim-menu-settings" });
		settingsTab.setCssStyles(noteMenuBodyPanelStyle("scroll", "none"));
		const insightTab = bodyWrap.createDiv();
		insightTab.setCssStyles(noteMenuBodyPanelStyle("scroll", "none"));

		// -- Data Sub-tabs: Logic | Tree | Table | JSON (descriptors from note-menu-geom) --
		type DataSubTab = NoteMenuDataSubTab;
		const D_SUBS = noteMenuDataSubTabs();
		const dSubBtns = new Map<string, HTMLElement>();
		const styleDSubs = (): void => {
			for (const { key } of D_SUBS) {
				const b = dSubBtns.get(key);
				if (!b) continue;
				const on = this.dataSubTab === key;
				b.setCssStyles(noteMenuTabButtonStyle(on, { padding: "4px 8px", fontSize: "10.5px" }));
			}
		};
		const showDSubTab = (key: DataSubTab): void => {
			this.dataSubTab = key;
			const disp = noteMenuDataSubTabDisplay(key);
			logicTab.setCssStyles({ display: disp.logic });
			treeTab.setCssStyles({ display: disp.tree });
			tableTab.setCssStyles({ display: disp.table });
			jsonTab.setCssStyles({ display: disp.json });
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
				if (this.dataSubTab !== key) b.setCssStyles(noteMenuTabHoverStyle());
			});
			b.addEventListener("mouseleave", () => styleDSubs());
		}
		showDSubTab(this.dataSubTab);

		type MenuTab = NoteMenuTab;
		const TABS = noteMenuTopTabs();
		const tabBtns: Partial<Record<MenuTab, HTMLElement>> = {};
		const styleTabs = (): void => {
			for (const { key } of TABS) {
				const b = tabBtns[key];
				if (!b) continue;
				const on = this.activeMenuTab === key;
				b.setCssStyles(noteMenuTabButtonStyle(on, { padding: "6px 14px", fontSize: "11px" }));
			}
		};
		const showTab = (key: MenuTab): void => {
			this.activeMenuTab = key;
			const disp = noteMenuTopTabDisplay(key);
			dataTabWrap.setCssStyles({ display: disp.data });
			settingsTab.setCssStyles({ display: disp.settings });
			insightTab.setCssStyles({ display: disp.insight });
			
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
				if (this.activeMenuTab !== key) b.setCssStyles(noteMenuTabHoverStyle());
			});
			b.addEventListener("mouseleave", () => styleTabs());
		};
		for (const { key, label } of TABS) mkTab(key, label);
		// Note-count + click hint, shown at the top of the Result pane.
		const notesHintDesc = noteMenuNotesHint(nodes.length, isDroste);
		const notesHint = treeTab.createDiv({ text: notesHintDesc.text });
		notesHint.setCssStyles(notesHintDesc.style);
		// ── Grouping selector (Folder / Tag) ────────────────────────────────────
		// A small radio group in the header switches the tree between the FOLDER
		// tree (by note path, default) and the TAG tree (by GROUP_BY membership
		// keys). The chosen grouping survives rebuilds (this.noteMenuGroupBy) and
		// reloads (settings.noteMenuGroupBy). Changing it re-renders the tree.
		const groupBarStyle = noteMenuGroupBarStyle();
		const groupBar = treeTab.createDiv();
		groupBar.setCssStyles(groupBarStyle.bar);
		const groupName = "gim-notemenu-group";
		const mkGroupRadio = (value: "folder" | "tag", labelText: string): void => {
			const lab = groupBar.createEl("label");
			lab.setCssStyles(groupBarStyle.label);
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
		const bulkBarStyle = noteMenuBulkBarStyle();
		const bulkBar = treeTab.createDiv();
		bulkBar.setCssStyles(bulkBarStyle.bar);
		const mkBulkBtn = (label: string, handler: () => void): void => {
			const btn = bulkBar.createEl("button");
			btn.textContent = label;
			btn.setCssStyles(bulkBarStyle.btn);
			// Prevent the button click from starting a header move-drag.
			btn.addEventListener("mousedown", (ev) => ev.stopPropagation());
			btn.addEventListener("click", (ev) => {
				ev.stopPropagation();
				handler();
			});
		};
		mkBulkBtn("Select all", () => {
			// Show all: remove every listed note's hide-key from hiddenNodes.
			this.settings.hiddenNodes = bulkSetHidden(this.settings.hiddenNodes, nodes.map(hideKey), false);
			void this.save();
			this.requestDraw();
			// Redraw the menu so checkboxes reflect the new state without rebuilding
			// the panel (no scroll/expand collapse).
			this.noteMenuRedraw?.();
		});
		mkBulkBtn("Deselect all", () => {
			// Hide all: add every listed note's hide-key to hiddenNodes (dedup).
			this.settings.hiddenNodes = bulkSetHidden(this.settings.hiddenNodes, nodes.map(hideKey), true);
			void this.save();
			this.requestDraw();
			this.noteMenuRedraw?.();
		});
		// Search input for filtering the tree. Static chrome from a pure builder.
		const searchStyle = noteMenuSearchStyle();
		const searchWrap = treeTab.createDiv();
		searchWrap.setCssStyles(searchStyle.wrap);
		const search = searchWrap.createEl("input", { attr: { type: "text", placeholder: "Search: word, #tag, key:value" } });
		search.setCssStyles(searchStyle.input);
		// Restore the search query that was active before this rebuild (if any).
		// This preserves the user's typed text across vault-change-triggered rebuilds.
		if (this.noteMenuSearchQuery) search.value = this.noteMenuSearchQuery;
		// Suggestion (autocomplete) dropdown — absolutely positioned under the input,
		// same panel styling, zIndex above the body. Hidden until there are matches.
		const suggBox = searchWrap.createDiv();
		suggBox.setCssStyles(searchStyle.suggBox);
		const body = treeTab.createDiv({ cls: "gim-tree-scroll" });
		// flex:1 1 auto + minHeight:0 → the tree scroll area grows/shrinks with the
		// panel height (set above / on resize) instead of a fixed maxHeight.
		body.setCssStyles(searchStyle.body);
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
			// Body/grip visibility flips with minimized; height is computed below.
			const disp = noteMenuMinimizeDisplay(this.noteMenuMinimized);
			bodyWrap.setCssStyles({ display: disp.body });
			grip.setCssStyles({ display: disp.grip });
			if (this.noteMenuMinimized) {
				// Collapse to the header bar (title + tabs): hide the whole tab body.
				const collapsed = noteMenuHeight(true, headerOnlyHeight(), rect.height, this.noteMenuRestoreHeight);
				panel.setCssStyles({ height: `${collapsed}px` });
			} else {
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
			lgrip.setCssStyles(noteMenuLeftGripStyle());
			lgrip.addEventListener("mousedown", (ev: MouseEvent) => {
				if (ev.button !== 0) return;
				ev.preventDefault();
				ev.stopPropagation();
				const startX = ev.clientX;
				const startW = panel.offsetWidth;
				const onMove = (e: MouseEvent): void => {
					const cw = this.root.clientWidth || 0;
					const raw = startW + (startX - e.clientX); // drag left → wider
					// Same floor-to-min / ceiling-to-80%-of-container rule as the
					// initial dock width — reuse the pure builder, never above 80%.
					const w = clampPinnedWidth(raw, cw);
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
		type CbState = FolderCheckState;
		const setCbState = (el: HTMLElement, state: CbState): void => {
			el.dataset.state = state;
			el.setAttribute("aria-checked", checkboxAriaChecked(state));
		};
		const isCbChecked = (el: HTMLElement): boolean => el.dataset.state === "checked";
		const mkRowCheckbox = (host: HTMLElement, onToggle: () => void): HTMLElement => {
			// `gim-nav-cb` drives the custom tri-state rendering in styles.css
			// (checked ✓ / empty / indeterminate –) so the partial state is
			// unmistakable regardless of the active Obsidian theme.
			const spec = noteMenuRowCheckboxSpec();
			const cb = host.createEl("span", { cls: spec.cls, attr: spec.attr });
			cb.dataset.state = spec.state;
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
			const hl = noteMenuLeafHighlight(id === this.currentMenuHighlightId());
			const leafStyle = noteMenuTreeRowStyle("leaf", depth, hl.rowBg);
			row.setCssStyles(leafStyle.row);
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
			lbl.setCssStyles(leafStyle.label);
			if (hl.labelColor) lbl.setCssStyles({ color: hl.labelColor });
			row.addEventListener("mouseenter", () => { row.setCssStyles(noteMenuLeafRowHoverStyle(true, hl.rowBg)); });
			row.addEventListener("mouseleave", () => { row.setCssStyles(noteMenuLeafRowHoverStyle(false, hl.rowBg)); });
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
			const allStyle = noteMenuTreeRowStyle("all", depth);
			row.setCssStyles(allStyle.row);
			// (all) has NO checkbox — only a collapsible label
			const lbl = row.createSpan({ text: folderToggleLabel("(all)", false) });
			lbl.setCssStyles(allStyle.label);
			const kids = container.createDiv();
			kids.setCssStyles({ display: "none" });
			let built = false;
			const openAll = (): void => {
				const d = folderDisclosure("(all)", true);
				kids.setCssStyles({ display: d.display });
				lbl.textContent = d.label;
				if (!built) {
					for (const lf of leaves) leafRow(kids, lf.id, lf.label, depth + 1);
					built = true;
				}
			};
			const closeAll = (): void => {
				const d = folderDisclosure("(all)", false);
				kids.setCssStyles({ display: d.display });
				lbl.textContent = d.label;
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
				const folderStyle = noteMenuTreeRowStyle("folder", depth);
				row.setCssStyles(folderStyle.row);
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
					const hide = folderCascadeHide(descKeys, hiddenSetNow());
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
				const lbl = row.createSpan({ text: folderToggleLabel(display, false) });
				lbl.setCssStyles(folderStyle.label);
				const kids = container.createDiv();
				kids.setCssStyles({ display: "none" });
				let built = false;
				// Open this folder (build children lazily if not yet built).
				const openFolder = (): void => {
					const d = folderDisclosure(display, true);
					kids.setCssStyles({ display: d.display });
					lbl.textContent = d.label;
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
					const d = folderDisclosure(display, false);
					kids.setCssStyles({ display: d.display });
					lbl.textContent = d.label;
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
		// Replace the current token in the input with `text`. Tags/notes get a
		// trailing space (term complete); "key:" stays open (no space) so the user
		// can keep typing the value.
		const acceptSuggestion = (text: string, _kind: Suggestion["kind"]): void => {
			search.value = applySuggestionToken(search.value, text);
			closeSuggest();
			search.focus();
			draw();
		};
		const renderSelection = (): void => {
			const rows = Array.from(suggBox.children) as HTMLElement[];
			rows.forEach((r, i) => { r.setCssStyles(noteMenuSuggestSelectionStyle(i === selIdx)); });
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
			const suggStyle = noteMenuSuggestStyle();
			suggestions.forEach((s, i) => {
				const row = suggBox.createDiv();
				row.setCssStyles(suggStyle.row);
				const ks = suggestionKindStyle(s.kind);
				const glyph = row.createSpan({ text: ks.glyph });
				glyph.setCssStyles({ ...suggStyle.glyph, color: ks.color });
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
			const action = suggestKeyAction(ev.key, { open, selIdx, count: suggestions.length });
			switch (action.type) {
				case "open":
					openSuggest();
					break;
				case "move":
					ev.preventDefault();
					selIdx = action.selIdx;
					renderSelection();
					break;
				case "accept": {
					ev.preventDefault();
					const s = suggestions[action.index];
					acceptSuggestion(s.text, s.kind);
					break;
				}
				case "search":
					// No highlighted suggestion → just run the search (close any box).
					closeSuggest();
					draw();
					break;
				case "close":
					ev.preventDefault();
					ev.stopPropagation();
					closeSuggest();
					break;
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
			panel.setCssStyles(noteMenuRectStyle(r));
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
		grip.setCssStyles(noteMenuBottomRightGripStyle());
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
		return hitDrosteRect(sx * dpr, sy * dpr, this.drosteHit);
	}


	// Heatmap cell click → Switch to Close-up focusing on shared notes.
	private openHeatmapDetail(i: number, j: number, _sx: number, _sy: number): void {
		const h = this.laid.heatmap;
		if (!h) return;
		const ids = heatmapCellNoteIds(h.nodeIds, i, j);
		this.heatmapSelected = null;
		this.switchToCloseup(ids);
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

	// Heatmap cell (row i, col j) under the cursor, or null if over a frozen
	// band / out of range.
	private heatmapCellAt(sx: number, sy: number): { i: number; j: number } | null {
		const h = this.laid.heatmap;
		if (!h) return null;
		return hitHeatmapCell(h, this.zoom, this.panX, this.panY, this.canvas.clientWidth, sx, sy);
	}

	// Shared guard: drop a selected column whose set no longer contains it
	// after a relayout (used for the UpSet selection).
	private clearStaleSelection(): void {
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

		if (target.kind === "heatmapCell") {
			// Heatmap cell: "(tag i × tag j = N shared)" — or tag size on diagonal.
			const h = this.laid.heatmap;
			if (!h || target.i >= h.n || target.j >= h.n) return;
			const ti = h.tags[target.i];
			const tj = h.tags[target.j];
			const cnt = h.counts[target.i * h.n + target.j];
			const cellTip = heatmapCellTipText(ti, tj, cnt, target.i === target.j);
			tip.createSpan({ cls: "gim-tip-title", text: cellTip.title });
			tip.createSpan({ cls: "gim-tip-sub", text: cellTip.sub });
			this.root.appendChild(tip);
			this.tipEl = tip;
			this.positionTip(sx, sy, tip);
			return;
		}
		if (target.kind === "ghostEdge") {
			const bridgeTip = ghostEdgeTipText(target.bridge);
			tip.createSpan({ cls: "gim-tip-title", text: bridgeTip.title });
			tip.createSpan({ cls: "gim-tip-sub", text: bridgeTip.sub });
			this.root.appendChild(tip);
			this.tipEl = tip;
			this.positionTip(sx, sy, tip);
			return;
		}
		if (target.kind === "node") {
			// Euler-nested copies carry a `${tag}\t${origPath}` id — resolve the
			// ORIGINAL path for the file lookup + body cache.
			const baseId = stripTabPrefix(target.nodeId);
			const file = this.app.vault.getAbstractFileByPath(baseId);
			if (!(file instanceof TFile)) return;
			tip.createSpan({ cls: "gim-tip-title", text: file.basename });
			tip.createSpan({ cls: "gim-tip-sub", text: file.parent?.path ?? "" });
			// Body preview removed — the tip shows the file name + folder only.
			if (gen !== this.hoverGen) return;
		} else if (target.kind === "cluster") {
			const cl = this.laid.clusters.find((c) => c.groupKey === target.group);
			if (!cl) return;
			const clusterTip = clusterTipText(cl.label, cl.memberCount);
			tip.createSpan({ cls: "gim-tip-title", text: clusterTip.title });
			tip.createSpan({ cls: "gim-tip-sub", text: clusterTip.sub });
		} else if (target.kind === "aggregationGroup") {
			const aggTip = aggregationGroupTipText(target.groupKey, target.nodeIds.length);
			tip.createSpan({ cls: "gim-tip-title", text: aggTip.title });
			tip.createSpan({ cls: "gim-tip-sub", text: aggTip.sub });
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
				const inClose = !!cr0 && pointInRect(sx, sy, cr0);
				if (pr && !inClose && pointInRect(sx, sy, pr)) {
					// Detect scrollbar drag
					if (this.legendMaxScrollY > 0 && sx >= pr.x + pr.w - 12) {
						// Calculate absolute scroll position based on click Y coordinate
						const { trackTop, thumbH, maxThumbY } = legendScrollbarGeom(
							pr.h,
							this.legendMaxScrollY,
							this.exportDprMul === 1,
						);

						// Thumb's current physical position
						const curScrollY = this.legendScrollY[this.settings.viewMode] ?? 0;
						const curThumbY = pr.y + trackTop + (maxThumbY > 0 ? (curScrollY / this.legendMaxScrollY) * maxThumbY : 0);
						
						// If clicking directly on the thumb, do relative drag
						if (sy >= curThumbY && sy <= curThumbY + thumbH) {
							this.legendScrollDrag = { startY: sy, startScrollY: curScrollY };
						} else {
							// Clicking on the track outside the thumb: jump to position
							// Center the thumb at the clicked Y coordinate
							const targetThumbY = clampScroll((sy - pr.y - trackTop) - thumbH / 2, maxThumbY);
							const newScrollY = maxThumbY > 0 ? (targetThumbY / maxThumbY) * this.legendMaxScrollY : 0;
							
							const vmode = this.settings.viewMode;
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
				// Invariant: legendScrollDrag is only ever set while the legend
				// panel is laid out, which is the same path that assigns
				// legendPanelRect — so it is non-null whenever we get here.
				const pr = this.legendPanelRect!;
				const { maxThumbY } = legendScrollbarGeom(
					pr.h,
					this.legendMaxScrollY,
					this.exportDprMul === 1,
				);
				const scrollDelta = maxThumbY > 0 ? (dy / maxThumbY) * this.legendMaxScrollY : 0;
				const vmode = this.settings.viewMode;
				this.legendScrollY[vmode] = clampScroll(this.legendScrollDrag.startScrollY + scrollDelta, this.legendMaxScrollY);
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
			if (cr && pointInRect(sx, sy, cr)) {
				this.sessionHiddenLegends.add(this.settings.viewMode);
				this.draw();
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
				this.openFile(hit.nodeId);
			} else if (hit?.kind === "ghostEdge") {
				// Open one of the notes in a new leaf (the one that is not currently focused)
				const b = hit.bridge;
				const currentFile = this.app.workspace.getActiveFile();
				const targetId = (currentFile && currentFile.path === b.a) ? b.b : b.a;
				this.openFile(targetId);
			}
		});
		c.addEventListener("mousemove", (e) => this.onPointerMove(e));
		c.addEventListener("mouseleave", () => {
			this.cancelHover();
			// Droste mode tracks hover via hoveredNodeId (no lattice
			// crosshair state) — clear it so no band stays lit after exit.
			const drosteHovered = this.laid.drosteGallery != null && this.hoveredNodeId !== null;
			if (drosteHovered) this.hoveredNodeId = null;
			if (
				drosteHovered ||
				this.heatmapHoverRow !== -1 ||
				this.heatmapHoverCol !== -1 ||
				this.latticeHoverKey !== null
			) {
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
			if (lr && pointInRect(sx, sy, lr)) {
				if (this.legendMaxScrollY > 0) {
					const vmode = this.settings.viewMode;
					const cur = this.legendScrollY[vmode] ?? 0;
					const dy = e.deltaMode === 1 ? e.deltaY * 20 : (e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY);
					this.legendScrollY[vmode] = clampScroll(cur + dy, this.legendMaxScrollY);
					this.requestDraw();
				}
				e.stopPropagation();
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

