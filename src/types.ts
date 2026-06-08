export interface GraphNode {
	id: string;
	label: string;
	// Cluster keys this node belongs to. Single-cluster files have one entry;
	// multi-tag files (when GROUP_BY uses `tag:?`) have one entry per tag.
	memberships: string[];
	score?: number;
	filtered?: boolean;
}

export interface GraphEdge {
	source: string;
	target: string;
}

export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export interface Offset {
	dx: number;
	dy: number;
}

export interface MiniSettings {
	autoFollowActiveNote: boolean;
	maxNeighborhoodSize: number;
	W_link: number;
	W_tag: number;
	clusterSpacing: number;
	nodeSpacing: number;
	cardMaxChars: number;
	// Each entry is one query row in the panel. Empty rows are ignored; all
	// non-empty rows are AND-combined for evaluation.
	where: string[];
	groupBy: string[];
	// SQL-like aggregate post-filter. Each row is "count <op> <number>"; rows
	// are AND-combined. Failing clusters keep their nodes visible but their
	// enclosure (outline + label) is suppressed.
	having: string[];
	// Per-cluster node display tiers: `limit N` (top N shown full) and
	// `brief N` (next batch shown title-only). Anything beyond the highest
	// tier is hidden. The sort order used to compute "top N" comes from
	// orderField/orderDir below.
	limit: string[];
	// Sort criterion shared by LIMIT tiers. `orderField` accepts built-ins
	// (name/mtime/ctime/size) plus any frontmatter field name.
	orderField: string;
	orderDir: "asc" | "desc";
	// When `*Auto` is true, the system AND-augments the corresponding section
	// with auto-computed conditions so the default view stays readable. Manual
	// rows are always respected and combine multiplicatively with the auto
	// additions.
	whereAuto: boolean;
	groupByAuto: boolean;
	havingAuto: boolean;
	limitAuto: boolean;
	// "concentric": focus at centre, others fill expanding rings around it.
	// "flow": focus at top-left, others fill columns to the right (main flow
	// direction = toward the focus / "stage").
	anchorPlacement: "concentric" | "flow";
	// Per-view display toggles.
	showBody: boolean;
	// Card span in grid units. nodeRows = m (height in cells), nodeCols = n
	// (width in cells). Default 1 × 1 (= a single cell). When nodeSizeMode
	// != "fixed" the (m, n) pair is multiplied by a shared scale factor so
	// the m : n aspect ratio survives.
	nodeRows: number;
	nodeCols: number;
	nodeSizeMode: "fixed" | "indegree" | "outdegree";
	// Draw the node cards. When false, only enclosures / edges / grid show.
	showNodes: boolean;
	showEnclosures: boolean;
	showEdges: boolean;
	// Excel-style row/column lattice underlay. Cell size = unified card W × H;
	// rows/columns are inferred from actual card centres, not from cluster
	// bounding boxes (so clusters can overlap the grid freely).
	showGrid: boolean;
	// Per-card visibility. List of node IDs explicitly hidden globally.
	// Managed via per-layer card toggles in the settings panel.
	hiddenNodes: string[];
	// Cluster keys whose members are replaced on the canvas by a single
	// 3-card diagonal stack (aggregate display).
	aggregatedLayers: string[];
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
			nodeSizeMode?: "fixed" | "indegree" | "outdegree";
		}
	>;
	panelVisible: boolean;
	clusterOffsets: Record<string, Offset>;
	nodeOffsets: Record<string, Offset>;
	// View mode for the [全体] tab. "euler" = the current Euler-diagram
	// rectangle layout. Future modes will be appended here.
	viewMode: ViewMode;
	// UpSet plot column ordering. "size" = intersection size desc;
	// "degree" = signature length asc (= "1-way sets first, then
	// 2-way, then 3-way ..."), size desc within each degree.
	upsetColumnSort: "size" | "degree";
	// UpSet plot minimum column size — intersections with fewer nodes
	// are culled from the matrix. Default 1 = keep everything.
	upsetMinColumnSize: number;
	// Connection-matrix row/column ordering. "original" = pipeline order;
	// "cooccurrence" = barycenter seriation to surface co-occurrence blocks.
	matrixSort: "original" | "cooccurrence";
	// Connection-matrix minimum column size — tags with fewer member notes
	// are dropped from the columns. Default 1 = keep everything.
	matrixMinColumnSize: number;
	// Connection-matrix row-order direction (ORDER_BY asc/desc). For
	// "block-priority": desc = biggest blocks first (default), asc = smallest
	// first. For "co-occurrence": desc reverses the seriation order.
	matrixSortDir: "asc" | "desc";
	// Connection-matrix: bundle consecutive same-signature rows into a block
	// (count badge + divider) without collapsing them. Default true.
	matrixGroupBySignature: boolean;
	// Connection-matrix: collapse each signature block to a "×N" summary row
	// (click a block to expand). Default false.
	matrixCollapseGroups: boolean;
	// Connection-matrix: order whole signature blocks by size desc (big blocks
	// to the top) instead of pure per-row Jaccard. Within a block, Jaccard
	// order is kept; the same-signature grouping is preserved either way.
	// Default true — restores the "count overview" lost when singletons scatter.
	matrixBlockPriority: boolean;
	// Heatmap: minimum tag size to appear on an axis (default 2 = drop
	// singletons), the seriation criterion + direction, and whether cell shade
	// uses Jaccard (default) vs raw (log/clamped) co-occurrence count.
	heatmapMinTagSize: number;
	heatmapCriterion: "co-occurrence" | "size";
	heatmapSortDir: "asc" | "desc";
	heatmapJaccard: boolean;
	// Bipartite tag graph: maximum number of tag (set) nodes shown. The layout
	// first drops singleton + giant (>40% of notes) tags, then keeps the
	// top-N by size. Caps hub fan-out so a sparse vault stays operable.
	bipartiteMaxTags: number;
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
	// Bipartite node placement: "force" (spring embedder, default) or
	// "concentric" (tags inner ring, notes outer ring(s), Jaccard-seriated).
	// Topology is identical — only positions change.
	bipartiteLayout: "force" | "concentric" | "clustered";
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
}

export type ViewMode =
	| "euler"
	| "euler-true"
	| "euler-venn"
	| "bubblesets"
	| "matrix"
	| "bipartite"
	| "heatmap"
	| "lattice"
	| "upset"
	| "droste";

export interface ViewModeOption {
	id: ViewMode;
	label: string;
	description?: string;
	// Experimental (beta) modes are segregated below the stable list in the
	// View-mode picker. They still render normally when selected — this flag
	// only affects how the picker groups/labels them.
	experimental?: boolean;
}

export const VIEW_MODES: ViewModeOption[] = [
	{
		// Icon Gallery (id stays "droste" for settings compatibility): one icon per
		// note, tiled. Each icon nests the note's tag-intersection groups (②③) and
		// its link/backlink relations (⑤). Pan/zoom to browse; mini-menu to jump.
		id: "droste",
		label: "Icon Gallery",
		description: "Per-note icon: nested groups of notes sharing its tags, plus its links and backlinks",
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
		// `id` stays "euler-true" for settings/preset compatibility. NOT a
		// strict Euler diagram: subset → nested rectangles, partial overlaps →
		// exclave pieces (not contiguous lens regions). Each node shown once.
		id: "euler-true",
		label: "Containment map",
		description: "Subset → nested rectangles; partial overlaps as exclaves (each node once)",
		// Without a clear tag containment hierarchy, partial overlaps fragment
		// into exclaves everywhere and the map becomes hard to read.
		experimental: true,
	},
	{
		// Simplified Euler: same grid/box drawing as the nested-set mode, but
		// each node placed ONCE and each tag drawn as ONE overlapping rectangle
		// (= bbox of its members). Containment → nested bbox, partial overlap →
		// overlapping bbox, disjoint → separate bbox. The bbox approximation is
		// the deliberate simplification of Euler's hard drawing cases.
		id: "euler-venn",
		label: "Euler diagram",
		description: "Overlapping tag rectangles (each node once; bbox-simplified)",
		// Same region/containment family as Nested set / Containment — overlapping
		// bbox rectangles hairball on a giant-tag, hierarchy-less vault.
		experimental: true,
	},
	{
		// Bipartite tag graph: note nodes + set (tag) nodes, joined by an edge
		// per membership. Closest to Obsidian's native tag graph. Note click
		// → open file; set click → highlight neighbours.
		//
		// Demoted to Experimental in v0.2.x: the "clustered" layout pins
		// multi-membership notes to a single tag island instead of placing
		// them BETWEEN tags (the Obsidian Graph experience the mode is named
		// for), and the giant-tag / max-tag heuristics are still unvalidated
		// on real vaults. Will return to GA once placement + thresholds are
		// settled. Existing users keep their saved `viewMode: "bipartite"`.
		id: "bipartite",
		label: "Tag graph",
		description: "Notes + tag nodes joined by membership edges (native-style graph)",
		experimental: true,
	},
	{
		// Connection matrix: rows = notes, columns = unique membership values,
		// a dot marks membership. One row holds all of a note's tags.
		//
		// Demoted to Experimental in v0.2.x: the row-per-note model scales
		// poorly on vaults with thousands of files (long vertical scroll,
		// hard to grasp at a glance), and its analytical role overlaps with
		// the heatmap / UpSet / lattice family. Will return to GA once row
		// summarisation / collapsed signature blocks settle the readability
		// gap. Existing users keep their saved `viewMode: "matrix"`.
		id: "matrix",
		label: "Connection matrix",
		description: "Rows = notes, columns = tags; a dot marks membership",
		experimental: true,
	},
	{
		// Reuses the Containment-map layout but draws each set as concentric
		// rectangular iso-contours ("bubbles"), evoking BubbleSets while
		// keeping nodes and contours quadrilateral.
		id: "bubblesets",
		label: "BubbleSets",
		description: "Containment layout drawn as rectangular iso-contour bubbles",
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
	},
];

export const DEFAULT_SETTINGS: MiniSettings = {
	autoFollowActiveNote: false,
	maxNeighborhoodSize: 50,
	W_link: 3.0,
	W_tag: 2.0,
	clusterSpacing: 80,
	nodeSpacing: 16,
	cardMaxChars: 160,
	where: [],
	groupBy: ["tag:*"],
	having: [],
	limit: [],
	orderField: "name",
	orderDir: "asc",
	whereAuto: true,
	groupByAuto: true,
	havingAuto: true,
	limitAuto: true,
	anchorPlacement: "concentric",
	showBody: true,
	nodeRows: 1,
	nodeCols: 1,
	nodeSizeMode: "fixed",
	showNodes: true,
	showEnclosures: true,
	showEdges: true,
	showGrid: true,
	hiddenNodes: [],
	aggregatedLayers: [],
	inheritFrom: {},
	nodeDisplayOverrides: {},
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
	upsetColumnSort: "size",
	upsetMinColumnSize: 1,
	matrixSort: "cooccurrence",
	matrixMinColumnSize: 1,
	matrixSortDir: "desc",
	matrixGroupBySignature: true,
	matrixCollapseGroups: false,
	matrixBlockPriority: true,
	heatmapMinTagSize: 2,
	heatmapCriterion: "co-occurrence",
	heatmapSortDir: "desc",
	heatmapJaccard: true,
	bipartiteMaxTags: 80,
	bipartiteLayout: "force",
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
};

export const NONE_BUCKET = "(none)";

// Matrix row-order criteria — the matrix-only entries added to the standard
// ORDER_BY criterion dropdown (alongside the asc/desc direction). They map to
// the stored matrix layout flags (see view.ts): "block-priority" ⇒
// matrixBlockPriority = true; "co-occurrence" ⇒ false. matrixSort is always
// "cooccurrence" (the seriation underlies both).
export const MATRIX_ORDER_CRITERIA: Array<{ value: string; text: string }> = [
	{ value: "co-occurrence", text: "co-occurrence" },
	{ value: "block-priority", text: "block-priority" },
];

// Heatmap ORDER_BY criteria — added to the standard criterion dropdown in
// heatmap mode only. "co-occurrence" = Jaccard seriation (related tags cluster
// on the diagonal); "size" = by tag size. Maps to heatmapCriterion.
export const HEATMAP_ORDER_CRITERIA: Array<{ value: string; text: string }> = [
	{ value: "co-occurrence", text: "co-occurrence" },
	{ value: "size", text: "size" },
];

// Id prefix for bipartite SET nodes (one per tag). NUL bytes guarantee it can
// never collide with a real vault file path; the authoritative kind check is
// `LaidOut.setNodeIds.has(id)`, not parsing this prefix.
export const SET_PREFIX = "\u0000tag\u0000";

// Card text geometry. Title and body lines use different sizes/weights.
export const CARD_RADIUS_PX = 4;
export const CARD_TITLE_FONT_PX = 12;
export const CARD_BODY_FONT_PX = 10;
export const CARD_LINE_HEIGHT_PX = 14;
export const CARD_BODY_LINE_HEIGHT_PX = 12;
export const CARD_PAD_X = 8;
export const CARD_PAD_Y = 6;
export const CARD_TITLE_BODY_GAP = 4;
export const CARD_MIN_W = 80;
export const CARD_MAX_W = 240;
export const CARD_BODY_CHARS_MIN = 0;
export const CARD_BODY_CHARS_MAX = 400;

// Single-cell pixel dimensions for the global grid. A card with nodeRows = 1
// and nodeCols = 1 occupies exactly one cell at this size; multi-cell cards
// scale these uniformly by (rows, cols).
export const CARD_CELL_W = 120;
export const CARD_CELL_H = 32;
