import type { EncodingBinding } from "./encoding/types";
import type { AggregationConfig } from "./aggregation/types";

export interface GraphNode {
	id: string;
	label: string;
	// Cluster keys this node belongs to. Single-cluster files have one entry;
	// multi-tag files (when GROUP_BY uses `tag:?`) have one entry per tag.
	memberships: string[];
	score?: number;
	filtered?: boolean;
	mtime?: number;
	fmMaturity?: string;
	ageDays?: number;
	// Peripheral node included because it links to/from a core node (when expandNeighborhood is true).
	// These nodes did NOT pass the main filter.
	isPeripheral?: boolean;
}

export interface GraphEdge {
	source: string;
	target: string;
}

export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

interface Offset {
	dx: number;
	dy: number;
}

export type LensQuerySettings = Pick<MiniSettings,
	"viewMode" | "selectedBases" | "basesLinkEdges" | "basesSharedTagEdges" | "basesSharedPropEdges" | "basesClusterByView">;

export interface LensPreset {
	name: string;
	query: LensQuerySettings;
	// Optional Visual Encoding snapshot (color/size/opacity/axis bindings). When
	// present, applyLens restores it too; when absent (legacy query-only presets),
	// the current encoding is left untouched. Display-only — never changes which
	// notes appear, so the selection ⊥ encoding invariant still holds.
	encoding?: EncodingBinding[];
}

export interface MiniSettings {
	autoFollowActiveNote: boolean;
	maxNeighborhoodSize: number;
	W_link: number;
	W_tag: number;
	clusterSpacing: number;
	nodeSpacing: number;
	cardMaxChars: number;
	// "concentric": focus at centre, others fill expanding rings around it.
	// "flow": focus at top-left, others fill columns to the right (main flow
	// direction = toward the focus / "stage").
	anchorPlacement: "concentric" | "flow";
	staleDays: number;
	showMaturity: boolean;
	// Per-view display toggles.
	showBody: boolean;
	// Card span in grid units. nodeRows = m (height in cells), nodeCols = n
	// (width in cells). Default 1 × 1 (= a single cell). When nodeSizeMode
	// != "fixed" the (m, n) pair is multiplied by a shared scale factor so
	// card fills its cell span exactly at every Min font size.
	nodeRows: number;
	nodeCols: number;
	// Draw the node cards. When false, only enclosures / edges / grid show.
	showNodes: boolean;
	showEnclosures: boolean;
	showEdges: boolean;
	// Excel-style row/column lattice underlay. Cell size = unified card W × H;
	// rows/columns are inferred from actual card centres, not from cluster
	// bounding boxes (so clusters can overlap the grid freely).
	showGrid: boolean;
	// F4: paint the encoding legend (colour/shape/size … key) on the canvas.
	showLegend: boolean;
	// F5: per-mode legend dismissal. A mode whose key is `true` here hides the
	// on-canvas legend (via the legend's × button) regardless of `showLegend`.
	legendHiddenModes: Partial<Record<ViewMode, boolean>>;
	// F5: per-mode dragged legend position (top-left origin, CSS px). Absent ⇒
	// the mode's default anchor is used.
	legendPos: Partial<Record<ViewMode, { x: number; y: number }>>;
	// Per-card visibility. List of node IDs explicitly hidden globally.
	// Managed via per-layer card toggles in the settings panel.
	hiddenNodes: string[];
	// Cluster keys whose members are replaced on the canvas by a single
	// 3-card diagonal stack (aggregate display).
	aggregatedLayers: string[];
	// Synthetic ∩/∪ layer keys that "inherit fully": when a key is present,
	// the layer's OWN nodeDisplayOverrides are ignored and it resolves purely
	// via the inheritFrom → strict-superset → global chain (FULL inheritance).
	// Absent ⇒ the layer's own overrides apply where set (PARTIAL override).
	layerInheritFull: string[];
	// Inheritance map: child layer key → parent (source) layer key. When
	// set, the child cluster's bbox grows to engulf the parent's bbox so
	// the parent visually "joins" the child territory.
	inheritFrom: Record<string, string>;
	// Per-cluster NODE_DISPLAY overrides. Resolution order for a node:
	//   1. Override on the node's own group
	//   2. Override on `inheritFrom[group]`
	//   3. Override on any cluster that's a strict superset of the group
	//   4. Global setting (= this.nodeRows / nodeCols / nodeSizeMode)
	// Each field is optional — a partial override only replaces what it
	// defines; unset fields fall through to the next priority level.
	nodeDisplayOverrides: Record<
		string,
		{
			nodeRows?: number;
			nodeCols?: number;
		}
	>;
	// Global attribute used for node aggregation (e.g., "status", "maturity").
	// When unset or "", aggregation is globally disabled.
	globalAggregationAttribute: string;
	// Per-set aggregation configuration.
	// Key = cluster groupKey or synthetic layer key (UNION_LAYER_KEY, INTERSECTION_LAYER_KEY).
	aggregationSettings: Record<string, AggregationConfig>;
	// Per-layer category (Single, Union, Intersection) aggregation toggles.
	layerAggregation: {
		tags: boolean;
		unions: boolean;
		intersections: boolean;
	};
	panelVisible: boolean;
	clusterOffsets: Record<string, Offset>;
	nodeOffsets: Record<string, Offset>;
	// View mode for the [全体] tab. "euler" = the current Euler-diagram
	// rectangle layout. Future modes will be appended here.
	viewMode: ViewMode;
	// The active panorama mode (used when drill-down is NOT active).
	panoramaMode: ViewMode;
	// The target closeup mode to switch to when drilling down from a panorama mode.
	closeupMode: ViewMode;
	// The currently active perspective. The canvas respects this and copies either
	// panoramaMode or closeupMode into viewMode.
	perspective: "panorama" | "closeup";
	// Transient filter applied when a user clicks a node in panorama mode
	// to switch to closeup mode. If populated, the parser restricts the graph to
	// ONLY these node IDs.
	focusNodeIds?: string[];
	// Visual Encoding bindings (attribute -> visual channel). Independent of the
	// Visual Encoding filter layer: never changes which notes appear. See src/encoding/.
	encoding: EncodingBinding[];
	// UpSet plot column ordering. "size" = intersection size desc;
	// "degree" = signature length asc (= "1-way sets first, then
	// 2-way, then 3-way ..."), size desc within each degree.
	upsetColumnSort: "size" | "degree";
	// UpSet plot minimum column size — intersections with fewer nodes
	// are culled from the matrix. Default 1 = keep everything.
	upsetMinColumnSize: number;
	// Names saved presets (Lenses).
	lensPresets: LensPreset[];
	// Heatmap: minimum tag size to appear on an axis (default 2 = drop
	// singletons), the seriation criterion + direction, and whether cell shade
	// uses Jaccard (default) vs raw (log/clamped) co-occurrence count.
	heatmapMinTagSize: number;
	heatmapCriterion: "co-occurrence" | "size";
	heatmapSortDir: "asc" | "desc";
	heatmapJaccard: boolean;
	gapFinder: boolean;
	showGhostEdges: boolean;
	ghostEdgeMinJaccard: number;
	// Intersection lattice: per-node level-of-detail. "auto" picks one of
	// overview / density / individual from count and the current zoom; the
	// explicit values force a single LOD regardless.
	latticeNodeLOD: "auto" | "overview" | "density" | "individual";
	// auto-LOD thresholds (effective count = count / zoom):
	//   eff ≤ individualMax → individual (1 note = 1 cell)
	//   eff ≤ densityMax    → density   (fixed grid of bins, count-independent)
	//   else                → overview  (header + bar + number)
	latticeIndividualMax: number;
	latticeDensityMax: number;
	// Number of cells per density block — the render cost of a "density" node
	// is bounded by this, so a 500-note intersection doesn't draw 500 cells.
	latticeDensityCells: number;
	// Drop tier nodes whose count is below this. Same idea as upsetMinColumnSize.
	latticeMinNodeSize: number;
	// Per-tier cap: keep top-N nodes on each degree row; everything else is
	// bundled into a single "Other (×M)" aggregated node so wide tiers don't
	// blow the canvas width up.
	latticeMaxNodesPerTier: number;
	// Draw the subset links (this intersection → the smaller intersection that
	// keeps one tag less). Pure draw toggle; the structure is always computed.
	latticeShowSubsetLinks: boolean;
	// Tier stacking direction. true = higher degree on top (specific on top),
	// false = lower degree on top (general on top).
	latticeSpecificTop: boolean;
	// lattice: max note NAMES shown inside a checked node before "+N". Driver
	// for the per-node "show names" checkbox — toggling that checkbox swaps
	// the node body for a list of basenames truncated to this many rows.
	latticeNamedMax: number;
	// Minimum font size (screen pixels) below which NO text element
	// will render. Applies to card titles/bodies, cluster labels,
	// matrix labels, grid headers, etc. World-space fonts that would
	// shrink past this floor under heavy zoom-out get their world
	// units bumped up so the rendered screen size stays ≥ minFontPx.
	minFontPx: number;
	// --- Droste-effect view mode ---
	// Focus note id the containment view is centred on. "" ⇒ first note.
	// Clicking a note re-roots here.
	drosteFocus: string;
	// --- Note-navigator panel geometry (mouse move + resize) ---
	// Last {left, top, width, height} (px, relative to the view container) the
	// user dragged/resized the floating note navigator to. Optional so existing
	// vaults (data.json without this key) still load; absent ⇒ default top-left
	// 270px panel. Persisted on drag/resize end.
	noteMenuRect?: { left: number; top: number; width: number; height: number };
	// Whether the floating note navigator is shown at all. Controlled by a
	// checkbox in the graph-settings panel. In DEFAULT_SETTINGS (default true)
	// so the menu shows by default and existing vaults without the key get
	// `true` via the `{...DEFAULT_SETTINGS, ...raw}` merge. When false,
	// ensureNoteMenu() early-returns (and removes the menu) in every mode.
	noteMenuVisible: boolean;
	// Whether the navigator is minimized (header double-click toggles it). When
	// minimized only the header bar is shown; the search box + tree body are
	// hidden and the panel collapses to the header height. Optional and NOT in
	// DEFAULT_SETTINGS, so existing vaults load unchanged (absent ⇒ restored).
	noteMenuMinimized?: boolean;
	// Navigator tree grouping: "folder" (group by note path, default) or "tag"
	// (group by the note's GROUP_BY membership keys; a note appears under each of
	// its groups). Switched by a Folder/Tag radio group in the navigator header.
	// Optional and NOT in DEFAULT_SETTINGS, so existing vaults load unchanged
	// (absent ⇒ "folder").
	noteMenuGroupBy?: "folder" | "tag";
	// Pin-to-right: when true the unified menu docks to the right edge (full
	// height, reserves canvas width) instead of floating; toggled by a pin icon
	// in the header. `noteMenuPinnedWidth` is the docked column width (px).
	// Optional + defaulted in main.ts merge, so existing vaults load unchanged.
	noteMenuPinned?: boolean;
	noteMenuPinnedWidth?: number;
	// --- Bases integration (Stage 2) ---
	// Selected `.base` file paths. When NON-EMPTY the graph is SCOPED to the
	// elements/edges derived from these bases (the WHERE/GROUP_BY result is
	// REPLACED). Empty ⇒ Bases is inert and the classic pipeline runs unchanged.
	selectedBases: string[];
	// Which relation kinds become graph edges. Internal links default ON; the
	// (potentially dense) shared-tag / shared-property kinds default OFF.
	basesLinkEdges: boolean;
	basesSharedTagEdges: boolean;
	basesSharedPropEdges: boolean;
	// Cluster granularity for projected base nodes. false ⇒ one cluster per
	// `.base` file (default); true ⇒ one cluster per (base, view).
	basesClusterByView?: boolean;
	// When true, displays the base file name as a prefix before the view name (e.g. "Base / View").
	// When false, displays only the view name.
	basesShowPrefix?: boolean;
}

export type ViewMode =
	| "euler"
	| "bubblesets"
	| "heatmap"
	| "lattice"
	| "upset"
	| "scatter"
	| "droste";

export interface ViewModeOption {
	id: ViewMode;
	label: string;
	description?: string;
	// Experimental (beta) modes are segregated below the stable list in the
	// View-mode picker. They still render normally when selected — this flag
	// only affects how the picker groups/labels them.
	experimental?: boolean;
	// Perspective grouping for the View-mode picker:
	//   "panorama" = vault-wide structural overview (default when absent)
	//   "closeup"  = per-node detail view (currently Icon Gallery only)
	// Future: selecting a node in a panorama mode will drill down to the
	// closeup mode with that node as focus.
	perspective?: "panorama" | "closeup";
}

export const VIEW_MODES: ViewModeOption[] = [
	{
		// Icon Gallery (id stays "droste" for settings compatibility): one icon per
		// note, tiled. Each icon nests the note's tag-intersection groups (②③) and
		// its link/backlink relations (⑤). Pan/zoom to browse; mini-menu to jump.
		id: "droste",
		label: "Icon Gallery",
		description: "Per-note icon: nested groups of notes sharing its tags, plus its links and backlinks",
		perspective: "closeup",
	},
	{
		// `id` stays "euler" for settings / preset compatibility; the label
		// reflects the actual model — per-tag boxes with duplicated nodes and
		// intersection sub-boxes, NOT true overlapping-region Euler curves.
		id: "euler",
		label: "Nested set diagram",
		description: "Per-tag boxes; shared nodes duplicated into a*b*c intersection sub-boxes",
		// Duplicating shared nodes into intersection sub-boxes explodes the box
		// count on giant tags in a sparse, deeply-multi-membership vault.
		experimental: true,
	},
	{
		// Reuses the Containment-map layout but draws each set as concentric
		// rectangular iso-contours ("bubbles"), evoking BubbleSets while
		// keeping nodes and contours quadrilateral.
		id: "bubblesets",
		label: "BubbleSets",
		description: "Containment layout drawn as rectangular iso-contour bubbles",
		perspective: "closeup",
	},
	{
		// Symmetric tag×tag co-occurrence heatmap: cell shade = how many notes
		// share two tags; diagonal = tag size. Cell click → the intersection's
		// note list. Pairwise only (matrix/UpSet cover 3-way+).
		id: "heatmap",
		label: "Co-occurrence heatmap",
		description: "Tag × tag co-occurrence grid; cell shade = shared note count (Jaccard)",
	},
	{
		// Intersection lattice: degree-tiered Hasse-style layout of exact
		// intersections with subset links between tiers. Each node represents
		// one exact intersection and auto-switches between overview / density /
		// individual rendering by count + zoom, so a single intersection with
		// hundreds of notes doesn't stall the view the way an UpSet stack would.
		id: "lattice",
		label: "Intersection lattice",
		description: "Degree-tiered Hasse layout + subset links; each node auto-switches between overview / density / individual rendering by count",
	},
	{
		id: "upset",
		label: "UpSet plot",
		description: "Stack of cards per intersection + dot matrix (handles ≥4-way intersections)",
		experimental: true,
	},
	{
		// Scatter: one card per note placed on 2D quantitative axes (X/Y bound to
		// note attributes). Promotes the existing axis-encoding overlay into a
		// first-class panorama mode. Experimental until the layout/draw/E2E
		// sub-steps land (F2.3–F2.8); selecting it today renders the fallback.
		id: "scatter",
		label: "Scatter plot",
		description: "One card per note on 2D quantitative axes (X/Y bound to attributes); pan/zoom to browse",
		experimental: true,
	},
];

// Perspective helpers — used by the View-mode picker to group modes into
// Panorama and Close-up sections.
export const isPanorama = (opt: ViewModeOption): boolean =>
	opt.perspective !== "closeup";
export const isCloseup = (opt: ViewModeOption): boolean =>
	opt.perspective === "closeup";

export const DEFAULT_SETTINGS: MiniSettings = {
	autoFollowActiveNote: false,
	maxNeighborhoodSize: 50,
	W_link: 3.0,
	W_tag: 2.0,
	clusterSpacing: 80,
	nodeSpacing: 16,
	cardMaxChars: 160,
	staleDays: 14,
	showMaturity: false,
	anchorPlacement: "concentric",
	showBody: true,
	nodeRows: 1,
	nodeCols: 1,
	showNodes: true,
	showEnclosures: true,
	showEdges: true,
	showGrid: true,
	showLegend: true,
	legendHiddenModes: {},
	legendPos: {},
	hiddenNodes: [],
	aggregatedLayers: [],
	layerInheritFull: [],
	inheritFrom: {},
	nodeDisplayOverrides: {},
	globalAggregationAttribute: "status",
	aggregationSettings: {},
	layerAggregation: {
		tags: false,
		unions: false,
		intersections: false,
	},
	panelVisible: false,
	clusterOffsets: {},
	nodeOffsets: {},
	// Default is a STABLE mode (the Nested-set / Containment-map / タググラフ /
	// 接続行列 experimentals are beta-segregated). Heatmap was picked as the
	// new-user default because its grid of tag × tag co-occurrence cells is
	// the most self-explanatory introduction to what the plugin does — every
	// cell is one fact ("these two tags share N notes"). Existing users keep
	// their saved viewMode — this default only applies on first load / when
	// no viewMode is persisted.
	viewMode: "heatmap",
	panoramaMode: "heatmap",
	closeupMode: "droste",
	perspective: "panorama",
	encoding: [],
	upsetColumnSort: "size",
	upsetMinColumnSize: 1,
	lensPresets: [],
	heatmapMinTagSize: 2,
	heatmapCriterion: "co-occurrence",
	heatmapSortDir: "desc",
	heatmapJaccard: true,
	gapFinder: false,
	showGhostEdges: false,
	ghostEdgeMinJaccard: 0.5,
	latticeNodeLOD: "auto",
	latticeIndividualMax: 60,
	latticeDensityMax: 2000,
	latticeDensityCells: 100,
	latticeMinNodeSize: 1,
	latticeMaxNodesPerTier: 24,
	latticeShowSubsetLinks: true,
	latticeSpecificTop: true,
	latticeNamedMax: 12,
	minFontPx: 8,
	drosteFocus: "",
	// Show the floating note navigator by default. Existing vaults missing this
	// key inherit `true` via the settings merge. (noteMenuMinimized is
	// intentionally absent here — it's optional so old vaults load unchanged.)
	noteMenuVisible: true,
	// Bases integration — inert by default (empty selection ⇒ classic pipeline).
	selectedBases: [],
	basesLinkEdges: true,
	basesSharedTagEdges: false,
	basesSharedPropEdges: false,
	basesClusterByView: false,
	basesShowPrefix: false,
};

export const NONE_BUCKET = "(none)";

// Heatmap ORDER_BY criteria — added to the standard criterion dropdown in

// Card text geometry. Title and body lines use different sizes/weights.
export const CARD_RADIUS_PX = 4;
export const CARD_TITLE_FONT_PX = 12;
export const CARD_BODY_FONT_PX = 10;
export const CARD_LINE_HEIGHT_PX = 14;
export const CARD_BODY_LINE_HEIGHT_PX = 12;
export const CARD_PAD_X = 8;
export const CARD_PAD_Y = 6;
export const CARD_TITLE_BODY_GAP = 4;

// Single-cell pixel dimensions for the global grid. A card with nodeRows = 1
// and nodeCols = 1 occupies exactly one cell at this size; multi-cell cards
// scale these uniformly by (rows, cols).
// Enlarged 2.25× from the original 120×32 (same 15:4 aspect ratio) so a card's
// title (filename) is legible at the whole-diagram fit zoom: the inter-card
// channel has a FIXED 24px floor (computeChannelDims), so growing the card
// raises the card-to-gap ratio, which means each card occupies more screen
// pixels at fit zoom rather than being cancelled out by a proportional gap.
export const CARD_CELL_W = 270;
export const CARD_CELL_H = 72;
