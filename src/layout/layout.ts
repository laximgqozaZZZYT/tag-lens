import { type GraphData, type GraphNode, NONE_BUCKET } from "../types";

import {
	LaneRegistry,
	routeZ,
	type RouteRect,
} from "./edge-routing";
import { shelfPack } from "./subgroup-packing";
import { placeClusterLabels } from "./label-collision";
import { componentEulerLayout } from "./block-table-venn";

import { layoutUpset } from "./upset-layout";
import type { AxisSpec } from "./axis-layout";
import { layoutHeatmap } from "./heatmap-layout";
import { layoutLattice } from "./lattice-layout";
import { layoutScatter } from "./scatter-layout";
import { buildGallery, type DrosteGallery } from "./droste-layout";
import { buildRouteObstacles } from "./layout-shared";
import { computeChannelDims, minFontScale } from "./card-sizing";
import type { BridgeCandidate } from "../query/bridge-finder";


export interface SizedNode extends GraphNode {
	width: number;
	height: number;
}

export interface PositionedNode {
	id: string;
	label: string;
	memberships: string[];
	x: number;
	y: number;
	width: number;
	height: number;
	// Optional colour key (a tag) for tinting — bipartite "clustered" sets each
	// note's main-tag here so the renderer can colour the island. Absent → default.
	hueKey?: string;
	mtime?: number;
	fmStatus?: string;
	fmMaturity?: string;
	ageDays?: number;
	isPeripheral?: boolean;
}

export interface PositionedEdge {
	source: string;
	target: string;
	weight: number;
	path: { x: number; y: number }[];
	// True when this edge represents many individual file-to-file links bundled
	// into a single line between two clusters. The renderer uses this to draw
	// bundled edges with a heavier, brighter stroke than ordinary 1:1 edges.
	bundled: boolean;
	// For bundled edges, the number of underlying file pairs aggregated.
	bundleCount: number;
	// Bipartite "clustered" layout: a SECONDARY (non-main) membership edge,
	// drawn only on hover (accent) and skipped in the base layer so the default
	// view shows just the one main edge per note. Undefined everywhere else.
	secondary?: boolean;
}

export interface ClusterRect {
	groupKey: string;
	label: string;
	// Overall bbox = bounding box of every piece combined.
	// Used for label placement + hit-test fallback.
	x: number;
	y: number;
	width: number;
	height: number;
	memberCount: number;
	// True for a "ghost" enclosure: the cluster's ONLY member is a
	// multi-tag card whose main cluster is elsewhere, so this box is just a
	// stray 1-cell rectangle around a card that lives in another cluster.
	// The renderer hides these (they read as scattered noise); enclosures
	// that contain a single-TAG card are kept.
	ghostSingle?: boolean;
	// PIECES = the cluster's enclosure is the UNION of these
	// rectangles. Each piece is a tight AABB around some 4-connected
	// component of the cluster's owned cells, possibly subdivided
	// further to exclude foreign-cluster cards. Multiple pieces (=
	// 離れ島 / exclaves) are permitted; the constraint is that NO
	// piece contains a cell with a card from another cluster the
	// member doesn't belong to.
	// `kind`: "main" = the cluster's own AABB (filled + outlined).
	//         "sub"  = 外局 — a co-located node group whose `mainOf` is
	//                  another cluster (outlined only, no fill).
	// `hueKey` (optional) overrides the colour key for THIS piece — used so an
	// intersection (積集合) sub-box is drawn in a different colour from the
	// single-set box that contains it.
	// `contour` (optional) marks a BubbleSets iso-contour ring: drawn as a
	// thin, faded, unfilled line so it reads as a contour inside the bubble.
	pieces?: Array<{
		x: number;
		y: number;
		w: number;
		h: number;
		kind: "main" | "sub";
		hueKey?: string;
		// Constituent tag keys of an INTERSECTION (積集合) sub-box, in stable
		// order. When ≥2 the renderer stripes the sub-box with one equal band
		// per tag (∩ → vertical) instead of a single blended hue.
		hueKeys?: string[];
		contour?: boolean;
	}>;
	// Legacy outline (segment list) — kept while older code paths
	// still depend on it. Renderer prefers `pieces` when present.
	outline?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
	cells?: Array<{ x: number; y: number; w: number; h: number }>;
}

// Trunks have been retired — every wire is a thin single line routed via
// the channel lattice. The TrunkLine interface and the laid.trunks array
// stay (empty / unused) only to keep the rendered code paths in view.ts
// from blowing up while the refactor settles; callers should not depend
// on them.
interface TrunkLine {
	srcCluster: string;
	tgtCluster: string;
	count: number;
	path: { x: number; y: number }[];
}

export interface LaidOut {
	nodes: PositionedNode[];
	edges: PositionedEdge[];
	ghostEdges?: PositionedEdge[];
	clusters: ClusterRect[];
	trunks: TrunkLine[]; // always empty — see note above
	// Slot pitch = card area + channel. Exposed so the view can render the
	// grid, headers, pan clamp and aggregation snap on the same lattice the
	// layout uses internally.
	slotW: number;
	slotH: number;
	channelW: number;
	channelH: number;
	// One reserved grid cell per cluster for its label. Created as a
	// phantom layout member so the packing / snap pass keeps it EMPTY and
	// INSIDE the cluster's enclosure; `drawClusterLabels` anchors the label
	// here (on a real cell, never a node cell or an aisle).
	// `text` (optional) overrides the rendered label — used for intersection
	// (積集合) sub-boxes whose label is the tag list joined with "*" rather
	// than a single cluster's "name (count)".
	labelCells?: Array<{
		key: string;
		x: number;
		y: number;
		w: number;
		h: number;
		text?: string;
	}>;
	// Set when the layout pass produced an UpSet plot. Renderer keys off
	// `upset != null` to swap the enclosure/edge pipeline for the matrix
	// + dot-row pipeline.
	upset?: UpsetMeta;
	// Set when the layout pass produced a tag co-occurrence heatmap. Renderer
	// keys off `heatmap != null` to draw the symmetric tag×tag cell grid.
	heatmap?: HeatmapMeta;
	// Set when the layout pass produced an intersection lattice. Renderer
	// keys off `lattice != null` to draw the tier grid + subset links instead
	// of any node/edge content (laid.nodes / laid.edges stay empty).
	lattice?: LatticeMeta;
	// Set for the Containment-lens view (Icon Gallery): the gallery index over the full
	// vault. Per-node icon diagrams are built on demand by the renderer.
	drosteGallery?: DrosteGallery;
	// Set when custom-axis layout (Encode → Position X/Y) overrode placement:
	// drives the variable-width gridlines + attribute labels (replaces lat/lon).
	axes?: { x?: AxisSpec; y?: AxisSpec };
}

export interface HeatmapMeta {
	// Tags in SERIATED order; the SAME order indexes both rows and columns, so
	// the matrix is symmetric and the diagonal is always |Ti| (= size).
	tags: Array<{ key: string; label: string; size: number }>;
	// Flat n×n symmetric intersection counts: counts[i*n+j] = |Ti ∩ Tj|;
	// the diagonal counts[i*n+i] = |Ti| (tag size).
	counts: Uint32Array;
	n: number;
	// Node ids per display index (tag) — intersected on cell click to list the
	// notes shared by a tag pair (or all notes of a tag on the diagonal).
	nodeIds: string[][];
	maxOff: number; // max off-diagonal count
	p95: number; // 95th percentile of off-diagonal nonzero counts (raw-scale clamp)
	cell: number; // world units per square cell
	totalNotes: number; // total number of notes in the graph
}

export type LatticeLod = "overview" | "density" | "individual";

export interface LatticeNodeMeta {
	// Signature key = members of this exact intersection joined by "|"
	// (matching the UpSet bucket key — same "|" rule, same collision-free join).
	key: string;
	signature: string[]; // sorted member tag list (raw cluster keys)
	// Same order as `signature`, but each tag resolved through clusterLabels
	// for display — the renderer joins these with " ∩ " in the header. Keys
	// stay raw so subset-link matching across tiers still works.
	displayTags: string[];
	// Pre-computed header lines (one tag per line, "#tag" / "∩ #tag" / "∩
	// …(+N)" for overflow). Layout sizes the node from these and the draw
	// step renders them verbatim — guaranteeing layout / render agree.
	displayLines: string[];
	// Header band height in world units, derived from `displayLines.length`.
	// Replaces the old fixed HEADER_H so a degree-4 node grows tall enough
	// to hold all four tag rows.
	headerH: number;
	degree: number; // signature.length
	nodeIds: string[]; // notes in this exact intersection, stable-sorted
	count: number; // == nodeIds.length
	// World-space rectangle (top-left x, y, width, height).
	x: number;
	y: number;
	w: number;
	h: number;
	tier: number; // == degree (tier row index)
	lod: LatticeLod; // default LOD at zoom=1; draw re-evaluates per zoom
	isOther?: boolean; // aggregated "Other (×M)" bundle node
	// True when this node's body should render as a vertical list of note
	// basenames instead of the LOD bar/waffle/cells. Driven by view-state
	// (`latticeNamedKeys`); the layout passes the flag through so the
	// renderer can dispatch without re-checking the key set.
	named?: boolean;
	parents: string[]; // keys of degree+1 nodes that contain this one
	children: string[]; // keys of degree-1 nodes that this one contains
}

export interface LatticeMeta {
	nodes: LatticeNodeMeta[];
	tiers: number[][]; // tiers[d] = indices into `nodes` for degree d
	links: Array<{ from: string; to: string }>; // from = higher-degree, to = lower
	setSizes: Array<{ key: string; label: string; size: number }>;
	maxCount: number;
	worldWidth: number;
	worldHeight: number;
	slotW: number;
	slotH: number;
}

export interface UpsetMeta {
	// One row per set (= cluster). Sorted by total node count desc.
	sets: Array<{ key: string; label: string; size: number }>;
	// One column per non-empty intersection signature. `xWorld` is the
	// column-centre x in WORLD coords — cards stack vertically at this
	// x, and the matrix footer transforms it through the current
	// pan/zoom so the dot column stays under its card stack.
	columns: Array<{
		signature: string[];
		nodeIds: string[];
		size: number;
		xWorld: number;
	}>;
	// World-space dimensions of the card area so view-side fit-to-view
	// can position the cards above the screen-space footer without
	// hard-coding magic numbers.
	cardsWorldWidth: number;
	cardsWorldHeight: number;
	cardSlotW: number; // = cardW + channel
	cardSlotH: number; // = cardH + channel
}

export interface LayoutOptions {
	clusterSpacing: number;
	nodeSpacing: number;
	// Canonical card dimensions for the W × H lattice. Individual cards in
	// `sized` may be larger or smaller (when nodeSizeMode varies size by
	// degree), but the cell pitch always derives from these base values so
	// the grid stays uniform.
	cellW: number;
	cellH: number;
	// Min font size (px). Drives `minFontScale`, which scales the 隘路
	// (channels) in step with the already-scaled `cellW/cellH` so the
	// entire grid stays proportional to the font floor. Defaults to no
	// scaling (scale = 1) when omitted.
	minFontPx?: number;
	clusterOffsets?: Record<string, { dx: number; dy: number }>;
	nodeOffsets?: Record<string, { dx: number; dy: number }>;
	clusterLabels?: Map<string, string>;
	// "concentric" places the focus cluster at origin and fills expanding
	// square rings outward. "flow" places focus top-left and fills columns
	// rightward (main flow direction = toward the focus). Default: concentric.
	anchorPlacement?: "concentric" | "flow";
	// "euler" (default) = the rectangle-enclosure pipeline below. "upset"
	// short-circuits into `layoutUpset()` for the matrix-style display.
	viewMode?: import("../types").ViewMode;
	upsetColumnSort?: "size" | "degree";
	upsetMinColumnSize?: number;
	// Heatmap: min tag size to appear on an axis; "co-occurrence"/"size"
	// criterion + asc/desc direction (raw-vs-Jaccard colour is a draw-time flag).
	heatmapMinTagSize?: number;
	heatmapCriterion?: "co-occurrence" | "size";
	heatmapSortDir?: "asc" | "desc";
	// Intersection lattice settings forwarded to layoutLattice.
	latticeNodeLOD?: "auto" | "overview" | "density" | "individual";
	latticeIndividualMax?: number;
	latticeDensityMax?: number;
	latticeDensityCells?: number;
	latticeMinNodeSize?: number;
	latticeMaxNodesPerTier?: number;
	latticeShowSubsetLinks?: boolean;
	latticeSpecificTop?: boolean;
	// Lattice: keys of nodes whose body should render as a list of note
	// basenames (the per-node "show names" checkbox is checked). The layout
	// uses this to enlarge the node bounds; the renderer paints the rows.
	latticeNamedKeys?: string[];
	// Lattice: max names per checked node before the residual "+N" row.
	latticeNamedMax?: number;
	// Lattice: per-named-node basename list (≤ latticeNamedMax entries each,
	// keyed by node.key). view.ts resolves basenames from the vault before
	// rebuilding so the layout can measure each label and grow the node
	// width / height to fit without per-row truncation.
	latticeNamedLabels?: Record<string, string[]>;
	// Lattice: text-width measurer. The lattice header now lays out one tag
	// per line and the layout step sizes each node to the LONGEST line, so it
	// needs accurate ctx.measureText. view.ts supplies one bound to a hidden
	// canvas with the header font selected; layout falls back to a crude
	// character-count estimate when none is provided.
	latticeMeasureText?: (text: string, fontPx: number) => number;
	// Droste-effect view: focus note id (the containment centre).
	drosteFocus?: string;
	// Droste-effect view: the FULL (pre-LIMIT) graph, so the containment map and
	// especially ⑤ (unrelated notes) cover the whole vault, not the limited set.
	drosteAllData?: GraphData;
	ghostBridges?: BridgeCandidate[];
}

// Local alias so existing internal references continue to compile —
// RouteRect lives in edge-routing.ts so both modules can share the
// shape without a circular import.
type Rect = RouteRect;

// Euler-diagram-style layout:
//  1. Place every distinct cluster on an anchor grid.
//  2. Group nodes by their exact membership set; each sub-group's position is
//     the centroid of its clusters' anchors.
//  3. Cluster rectangles are computed as the bbox of member nodes — clusters
//     whose memberships overlap end up with overlapping rectangles, and
//     multi-tag files land in the overlap regions.
export function layout(data: GraphData, sized: SizedNode[], opts: LayoutOptions): LaidOut {
	if (opts.viewMode === "upset") {
		return layoutUpset(data, sized, {
			cellW: opts.cellW,
			cellH: opts.cellH,
			nodeSpacing: opts.nodeSpacing,
			minFontPx: opts.minFontPx,
			clusterLabels: opts.clusterLabels ?? new Map<string, string>(),
			columnSort: opts.upsetColumnSort,
			minColumnSize: opts.upsetMinColumnSize,
		});
	}
	if (opts.viewMode === "heatmap") return layoutHeatmap(data, opts);
	if (opts.viewMode === "lattice") return layoutLattice(data, sized, opts);
	if (opts.viewMode === "droste") {
		// Containment lens = Icon Gallery (spec 2026-06-01): build the gallery index over
		// the FULL (pre-LIMIT) vault. Per-node icon diagrams are built on demand by the
		// renderer for visible cells only.
		const allData = opts.drosteAllData ?? data;
		const drosteGallery = buildGallery(allData, opts.clusterLabels);
		return {
			nodes: [], edges: [], clusters: [], trunks: [],
			slotW: opts.cellW, slotH: opts.cellH,
			channelW: 0, channelH: 0,
			drosteGallery,
		};
	}
	if (opts.viewMode === "bubblesets") {
		// Reuse the Containment-map layout verbatim; the BubbleSets look comes
		// purely from the renderer (each set's boundary drawn as a glowing
		// rectangular iso-contour).
		return layoutEulerTrue(data, sized, opts);
	}
	if (opts.viewMode === "scatter") return layoutScatter(data, sized, opts);
	return layoutEulerNested(data, sized, opts);
}

// Nested-Euler layout (user spec 2026-05-26): every TAG is a self-contained
// SINGLE-SET box, sized to hold its members + a label. Inside a tag box the
// members are grouped by their full membership SIGNATURE, and each signature
// shared with other tags is drawn as an intersection (積集合) SUB-box — the
// SAME intersection appears inside every related tag box, so a node shows up
// in several boxes (duplication is explicitly allowed by the spec). Tag boxes
// are shelf-packed on the canvas so they never overlap, which keeps every
// label / node / border clear of every other element by construction.
function layoutEulerNested(
	data: GraphData,
	sized: SizedNode[],
	opts: LayoutOptions,
): LaidOut {
	const labels = opts.clusterLabels ?? new Map<string, string>();
	const sizedById = new Map<string, SizedNode>();
	for (const s of sized) sizedById.set(s.id, s);
	const cardW = opts.cellW > 0 ? opts.cellW : sized[0]?.width ?? 80;
	const cardH = opts.cellH > 0 ? opts.cellH : sized[0]?.height ?? 24;
	const { channelW, channelH } = computeChannelDims(
		opts.nodeSpacing,
		minFontScale(opts.minFontPx ?? 0),
	);
	const slotW = cardW + channelW;
	const slotH = cardH + channelH;
	const gap = Math.max(channelW, channelH);
	const SEP = "\t";

	// Group every node by its exact membership signature.
	const sigMembers = new Map<string, { tags: string[]; nodes: GraphNode[] }>();
	for (const n of data.nodes) {
		const tags =
			n.memberships.length > 0 ? [...n.memberships].sort() : [NONE_BUCKET];
		const key = tags.join("");
		let e = sigMembers.get(key);
		if (!e) {
			e = { tags, nodes: [] };
			sigMembers.set(key, e);
		}
		e.nodes.push(n);
	}

	// tag → signatures that contain it, and tag → total member count.
	const tagSigs = new Map<string, string[]>();
	const tagCount = new Map<string, number>();
	for (const [key, e] of sigMembers) {
		for (const t of e.tags) {
			let arr = tagSigs.get(t);
			if (!arr) {
				arr = [];
				tagSigs.set(t, arr);
			}
			arr.push(key);
			tagCount.set(t, (tagCount.get(t) ?? 0) + e.nodes.length);
		}
	}

	// Pre-pack each signature's nodes into a sub-box (positions + size).
	const sigPack = new Map<
		string,
		{ positions: { x: number; y: number }[]; w: number; h: number }
	>();
	for (const [key, e] of sigMembers) {
		const sizes: SizedNode[] = e.nodes.map(
			(n) =>
				sizedById.get(n.id) ?? {
					id: n.id,
					label: n.label,
					memberships: n.memberships,
					width: cardW,
					height: cardH,
				},
		);
		const p = shelfPack(sizes, gap);
		sigPack.set(key, { positions: p.positions, w: p.width, h: p.height });
	}

	// Label box geometry (≈4 cells tall, wide enough for the WHOLE title).
	const labelH = 4 * slotH - channelH;
	const labelFontH = labelH * 0.7;
	const glyphW = labelFontH * 0.62;
	const labelWidth = (t: string): number => {
		const txt = `${labels.get(t) ?? t} (${tagCount.get(t) ?? 0})`;
		return Math.min(40 * slotW, txt.length * glyphW + slotW * 0.4);
	};
	// Intersection (積集合) sub-box label: the tag list joined with "*"
	// (e.g. "a*b*c"), drawn on a shorter (≈2-cell) bar at the sub-box top.
	const subLabelH = 2 * slotH - channelH;
	const subFontH = subLabelH * 0.7;
	const subGlyphW = subFontH * 0.62;
	const subLabelText = (sigTags: string[]): string =>
		sigTags.map((t) => labels.get(t) ?? t).join("*");
	const subLabelWidth = (txt: string): number =>
		Math.min(40 * slotW, txt.length * subGlyphW + slotW * 0.4);

	// Lay out each tag box: label bar on top, signature sub-boxes packed below.
	interface SubPlaced {
		sig: string;
		x: number;
		y: number;
		w: number;
		h: number;
		labText: string; // "" for non-intersection sigs
		labH: number;
		labW: number;
		nodeOffY: number; // node area top, relative to sub-box top
	}
	interface TagBox {
		tag: string;
		w: number;
		h: number;
		lblW: number;
		subs: SubPlaced[];
	}
	const tagBoxes: TagBox[] = [];
	const tags = [...tagSigs.keys()]
		.filter((t) => (tagCount.get(t) ?? 0) >= 2)
		.sort((a, b) => (tagCount.get(b) ?? 0) - (tagCount.get(a) ?? 0));
	for (const t of tags) {
		const sigs = (tagSigs.get(t) ?? [])
			.slice()
			.sort(
				(a, b) =>
					sigPack.get(b)!.w * sigPack.get(b)!.h -
					sigPack.get(a)!.w * sigPack.get(a)!.h,
			);
		// Per-signature sub-box geometry: an intersection (≥2 tags) reserves a
		// label bar on top; the nodes sit below it.
		const geom = sigs.map((k) => {
			const pk = sigPack.get(k)!;
			const inter = (sigMembers.get(k)?.tags.length ?? 0) >= 2;
			const labText = inter ? subLabelText(sigMembers.get(k)!.tags) : "";
			const labW = inter ? subLabelWidth(labText) : 0;
			const labH = inter ? subLabelH : 0;
			const contentW = Math.max(pk.w, labW);
			const nodeOffY = gap + (inter ? labH + gap : 0);
			return {
				sig: k,
				labText,
				labW,
				labH,
				nodeOffY,
				w: contentW + 2 * gap,
				h: nodeOffY + pk.h + gap,
			};
		});
		const subSizes: SizedNode[] = geom.map((g) => ({
			id: g.sig,
			label: "",
			memberships: [],
			width: g.w,
			height: g.h,
		}));
		const sp = shelfPack(subSizes, gap);
		const lblW = labelWidth(t);
		const innerW = Math.max(lblW, sp.width);
		const subTop = labelH + gap;
		// shelfPack returns CENTRE coords → convert to top-left.
		const subs: SubPlaced[] = geom.map((g, i) => ({
			sig: g.sig,
			x: gap + sp.positions[i].x - g.w / 2,
			y: subTop + sp.positions[i].y - g.h / 2,
			w: g.w,
			h: g.h,
			labText: g.labText,
			labH: g.labH,
			labW: g.labW,
			nodeOffY: g.nodeOffY,
		}));
		tagBoxes.push({
			tag: t,
			w: innerW + 2 * gap,
			h: subTop + sp.height + gap,
			lblW,
			subs,
		});
	}

	// Shelf-pack the tag boxes onto the canvas (non-overlapping).
	const boxSizes: SizedNode[] = tagBoxes.map((b) => ({
		id: b.tag,
		label: "",
		memberships: [],
		width: b.w + 2 * gap,
		height: b.h + 2 * gap,
	}));
	const canvas = shelfPack(boxSizes, 2 * gap);

	// Emit positioned nodes, clusters (main + intersection sub pieces), labels.
	const nodes: PositionedNode[] = [];
	const clusters: ClusterRect[] = [];
	const labelCells: NonNullable<LaidOut["labelCells"]> = [];
	tagBoxes.forEach((b, bi) => {
		// shelfPack positions are CENTRES → main-piece top-left = centre − size/2.
		const ox = canvas.positions[bi].x - b.w / 2;
		const oy = canvas.positions[bi].y - b.h / 2;
		const pieces: NonNullable<ClusterRect["pieces"]> = [
			{ x: ox, y: oy, w: b.w, h: b.h, kind: "main" },
		];
		labelCells.push({
			key: b.tag,
			x: ox + b.w / 2,
			y: oy + labelH / 2,
			w: Math.min(b.lblW, b.w),
			h: labelH,
		});
		for (const sub of b.subs) {
			const sx = ox + sub.x;
			const sy = oy + sub.y;
			const e = sigMembers.get(sub.sig)!;
			const pk = sigPack.get(sub.sig)!;
			if (e.tags.length >= 2) {
				pieces.push({
					x: sx,
					y: sy,
					w: sub.w,
					h: sub.h,
					kind: "sub",
					hueKey: sub.sig, // distinct colour per intersection
					hueKeys: e.tags.slice(), // ∩ → striped by constituent tags
				});
				// Intersection label ("a*b*c") on the sub-box's top bar.
				labelCells.push({
					key: sub.sig,
					text: sub.labText,
					x: sx + sub.w / 2,
					y: sy + gap + sub.labH / 2,
					w: Math.min(sub.labW, sub.w),
					h: sub.labH,
				});
			}
			e.nodes.forEach((n, ni) => {
				const sz = sizedById.get(n.id);
				const w = sz?.width ?? cardW;
				const h = sz?.height ?? cardH;
				const id = b.tag + SEP + n.id;
				const x = sx + gap + pk.positions[ni].x;
				const y = sy + sub.nodeOffY + pk.positions[ni].y;
				nodes.push({
					id,
					label: n.label,
					memberships: [b.tag],
					x,
					y,
					width: w,
					height: h,
					mtime: n.mtime,
					fmMaturity: n.fmMaturity,
					ageDays: n.ageDays,
					isPeripheral: n.isPeripheral,
				});
			});
		}
		clusters.push({
			groupKey: b.tag,
			label: labels.get(b.tag) ?? b.tag,
			x: ox,
			y: oy,
			width: b.w,
			height: b.h,
			memberCount: tagCount.get(b.tag) ?? 0,
			pieces,
		});
	});

	// Wire up INTRA-set edges: an original edge whose endpoints share a tag is
	// drawn (as a straight line) between the two copies that live in that
	// shared tag's box. A multi-tag pair therefore shows its connection inside
	// every box that contains both — consistent with the duplication model.
	// Route every intra-set edge through the 隘路 (channel) lattice with the
	// same orthogonal Z-router the rest of the diagram uses, so wires follow
	// the channel centre-lines between cards instead of cutting diagonally.
	const idToRect = new Map<string, Rect>();
	for (const n of nodes)
		idToRect.set(n.id, { x: n.x, y: n.y, w: n.width, h: n.height });
	const routeObstacles = buildRouteObstacles(nodes, slotW, slotH);
	const lanes = new LaneRegistry();
	const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
	// A node's MAIN group = the largest box-tag it belongs to. Used to wire
	// up cross-group edges (endpoints with no shared box) between the copies
	// living in each endpoint's main group.
	const mainTag = (n: GraphNode): string | null => {
		let best: string | null = null;
		let bestC = -1;
		for (const t of n.memberships) {
			const c = tagCount.get(t) ?? 0;
			if (c >= 2 && c > bestC) {
				bestC = c;
				best = t;
			}
		}
		return best;
	};
	const edges: PositionedEdge[] = [];
	const route = (sId: string, tId: string): void => {
		const a = idToRect.get(sId);
		const b = idToRect.get(tId);
		if (!a || !b) return;
		let path = routeZ(
			a,
			b,
			lanes,
			slotW,
			slotH,
			channelW,
			channelH,
			routeObstacles,
			sId,
			tId,
		);
		// routeZ collapses to a single point when it can't lay a channel route
		// (e.g. endpoints not on the global lattice); the renderer drops any
		// path shorter than 2 points, so fall back to a straight segment to
		// guarantee the wire is never silently omitted.
		if (!path || path.length < 2) path = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
		edges.push({
			source: sId,
			target: tId,
			weight: 1,
			path,
			bundled: false,
			bundleCount: 1,
		});
	};
	for (const e of data.edges) {
		const sn = nodeById.get(e.source);
		const tn = nodeById.get(e.target);
		if (!sn || !tn) continue;
		const sTags = new Set(sn.memberships);
		let wired = false;
		for (const t of tn.memberships) {
			if (!sTags.has(t)) continue;
			if (idToRect.has(t + SEP + e.source) && idToRect.has(t + SEP + e.target)) {
				route(t + SEP + e.source, t + SEP + e.target); // intra-set edge
				wired = true;
			}
		}
		// Cross-group edge: endpoints share no box → connect their main groups.
		if (!wired) {
			const sm = mainTag(sn);
			const tm = mainTag(tn);
			if (sm && tm) route(sm + SEP + e.source, tm + SEP + e.target);
		}
	}

	const ghostEdges: PositionedEdge[] = [];
	if (opts.ghostBridges) {
		const ghostRoute = (sId: string, tId: string, bridge: BridgeCandidate): void => {
			const a = idToRect.get(sId);
			const b = idToRect.get(tId);
			if (!a || !b) return;
			let path = routeZ(
				a,
				b,
				lanes,
				slotW,
				slotH,
				channelW,
				channelH,
				routeObstacles,
				sId,
				tId,
			);
			if (!path || path.length < 2) path = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
			ghostEdges.push({
				source: sId,
				target: tId,
				weight: 1,
				path,
				bundled: false,
				bundleCount: 1,
				bridge: bridge, // For hit testing
			} as unknown as PositionedEdge);
		};

		for (const bridge of opts.ghostBridges) {
			const sn = nodeById.get(bridge.a);
			const tn = nodeById.get(bridge.b);
			if (!sn || !tn) continue;
			
			// Just like normal cross-group edges, connect their main groups
			const sm = mainTag(sn);
			const tm = mainTag(tn);
			if (sm && tm) ghostRoute(sm + SEP + bridge.a, tm + SEP + bridge.b, bridge);
		}
	}

	return {
		nodes,
		edges,
		ghostEdges,
		clusters,
		trunks: [],
		slotW,
		slotH,
		channelW,
		channelH,
		labelCells,
	};
}

// TRUE Euler diagram via CONTAINMENT NESTING. A tag whose members are a
// SUBSET of another tag's members is nested INSIDE it (nesting = subset, a
// core Euler relation), so a hierarchical tag set (act ⊂ scene ⊂ beat ⊂
// timeline) renders as clean concentric rectangles. Each node is placed ONCE
// in its most specific (smallest) tag and is therefore geometrically inside
// every ancestor tag's rectangle → correct membership for the whole chain.
// Genuinely cross-cutting tags (neither a subset of the other) become
// separate roots laid side by side. Same grid / card / rectangle drawing as
// the other modes.
function layoutEulerTrue(
	data: GraphData,
	sized: SizedNode[],
	opts: LayoutOptions,
): LaidOut {
	const labels = opts.clusterLabels ?? new Map<string, string>();
	const sizedById = new Map<string, SizedNode>();
	for (const s of sized) sizedById.set(s.id, s);
	const cardW = opts.cellW > 0 ? opts.cellW : sized[0]?.width ?? 80;
	const cardH = opts.cellH > 0 ? opts.cellH : sized[0]?.height ?? 24;
	const { channelW, channelH } = computeChannelDims(
		opts.nodeSpacing,
		minFontScale(opts.minFontPx ?? 0),
	);
	const slotW = cardW + channelW;
	const slotH = cardH + channelH;
	const gap = Math.max(channelW, channelH);
	const labelH = 2 * slotH - channelH; // enclosure title bar (≈2 cells)
	const labelFontH = labelH * 0.7;
	// BubbleSets-only title bar, used by the post-placement box-follow pass
	// (NOT by the nested measure()/place() geometry the degree-cascade depends
	// on — changing labelH there shifts every box and breaks triple-overlap
	// resolution). Once the base card cell was enlarged (CARD_CELL_H 32→72),
	// the 2-cell labelH made the title font BIGGER than the cards it labels
	// (~117px on a 72px card) and, via labelWidthOf, forced every box at least
	// one giant label wide — a narrow single-column region (e.g. `scene`, 6
	// cards stacked) ballooned to ~3× its content width, all empty. Cap the
	// bubblesets bar at the card height so a label never outgrows its cards.
	const bubbleLabelH = Math.min(labelH, cardH);
	const bubbleGlyphW = bubbleLabelH * 0.7 * 0.62;
	const bubbleLabelWidthOf = (tag: string, n: number): number => {
		const txt = `${labels.get(tag) ?? tag} (${n})`;
		return Math.min(40 * slotW, txt.length * bubbleGlyphW + slotW * 0.3);
	};
	const glyphW = labelFontH * 0.62;
	const labelWidthOf = (tag: string, n: number): number => {
		const txt = `${labels.get(tag) ?? tag} (${n})`;
		return Math.min(40 * slotW, txt.length * glyphW + slotW * 0.4);
	};

	// Per-tag member sets.
	const tagMembers = new Map<string, Set<string>>();
	for (const node of data.nodes) {
		const tags = node.memberships.length > 0 ? node.memberships : [NONE_BUCKET];
		for (const t of tags) {
			let s = tagMembers.get(t);
			if (!s) {
				s = new Set();
				tagMembers.set(t, s);
			}
			s.add(node.id);
		}
	}
	const allTags = [...tagMembers.keys()];
	const count = (t: string): number => tagMembers.get(t)?.size ?? 0;
	// projectBaseIndexToGraph's injectBaseEnclosures (src/bases/project.ts)
	// gives every base-enclosure wrapper key the form "base=<name>" and every
	// per-view key under it "base=<name>::<view>" — a parent/child relation
	// the key FORMAT already encodes exactly, independent of member-count
	// containment. When every note under a multi-view base also shares an
	// identical view-level signature (zero exclusive members across views),
	// raw member-count ties the wrapper with its own views and a naive
	// alphabetical or count-based tie-break can let the wrapper "win" home /
	// the degree-cascade signature — starving the real (view-level)
	// intersection of any content before it's ever drawn. Recognize the
	// format directly so the wrapper is never treated as a peer of its own
	// views.
	const isEnclosureOf = (wrapper: string, view: string): boolean =>
		view.startsWith(wrapper + "::");

	// In bubblesets mode every node coordinate produced here is later
	// overwritten by componentEulerLayout + the box-follow (fitSubtree)
	// pass below, so the node placement just needs a deterministic
	// non-overlapping seed: plain shelfPack, same as every other mode.
	const pack = shelfPack;

	// b ⊊ a ? (proper subset; equal sets resolved by alphabetical order).
	const isSubset = (b: string, a: string): boolean => {
		if (b === a) return false;
		const sb = tagMembers.get(b)!;
		const sa = tagMembers.get(a)!;
		if (sb.size > sa.size) return false;
		if (sb.size === sa.size && b < a) return false; // identical sets → one parent
		for (const id of sb) if (!sa.has(id)) return false;
		return true;
	};
	// parent = tightest (smallest) strict superset → containment forest.
	const parent = new Map<string, string | null>();
	for (const b of allTags) {
		let best: string | null = null;
		let bestC = Infinity;
		for (const a of allTags) {
			if (!isSubset(b, a)) continue;
			const c = count(a);
			if (c < bestC || (c === bestC && (best === null || a < best))) {
				bestC = c;
				best = a;
			}
		}
		parent.set(b, best);
	}
	const children = new Map<string, string[]>();
	const roots: string[] = [];
	for (const t of allTags) {
		const p = parent.get(t) ?? null;
		if (p) {
			let arr = children.get(p);
			if (!arr) {
				arr = [];
				children.set(p, arr);
			}
			arr.push(t);
		} else roots.push(t);
	}

	// Home each node in its most specific (smallest-count) membership tag.
	// A base-enclosure wrapper tag (see isEnclosureOf above) is never
	// eligible: it is always the outer container of one of the node's OTHER
	// tags, so it can never be the most specific choice even when their
	// counts tie.
	const homeNodes = new Map<string, GraphNode[]>();
	for (const node of data.nodes) {
		const tags = node.memberships.length > 0 ? node.memberships : [NONE_BUCKET];
		const candidates = tags.filter(
			(t) => !tags.some((t2) => t2 !== t && isEnclosureOf(t, t2)),
		);
		const pool = candidates.length > 0 ? candidates : tags;
		let home = pool[0];
		let hc = count(home);
		for (const t of pool) {
			const c = count(t);
			if (c < hc || (c === hc && t < home)) {
				hc = c;
				home = t;
			}
		}
		let arr = homeNodes.get(home);
		if (!arr) {
			arr = [];
			homeNodes.set(home, arr);
		}
		arr.push(node);
	}

	// Bottom-up measure: a tag box = label strip + a shelf-pack of its own-node
	// block and its child boxes (so the rect always fits its content).
	interface Measured {
		tag: string;
		w: number;
		h: number;
		own: GraphNode[];
		ownPos: { x: number; y: number }[];
		boxes: SizedNode[];
		innerPos: { x: number; y: number }[];
		childMeasured: Measured[];
		labelStrip: number;
	}
	const OWN = " own";
	const measure = (tag: string): Measured => {
		const own = homeNodes.get(tag) ?? [];
		const ownSizes: SizedNode[] = own.map(
			(n) =>
				sizedById.get(n.id) ?? {
					id: n.id,
					label: n.label,
					memberships: n.memberships,
					width: cardW,
					height: cardH,
				},
		);
		const ownPack =
			own.length > 0
				? shelfPack(ownSizes, gap)
				: { positions: [], width: 0, height: 0 };
		const childMeasured = (children.get(tag) ?? []).map(measure);
		const boxes: SizedNode[] = [];
		if (own.length > 0)
			boxes.push({
				id: OWN,
				label: "",
				memberships: [],
				width: ownPack.width + 2 * gap,
				height: ownPack.height + 2 * gap,
			});
		for (const cm of childMeasured)
			boxes.push({
				id: cm.tag,
				label: "",
				memberships: [],
				width: cm.w,
				height: cm.h,
			});
		const inner =
			boxes.length > 0
				? pack(boxes, gap)
				: { positions: [], width: slotW, height: slotH };
		const labelStrip = count(tag) >= 2 ? labelH : 0;
		const lblW = count(tag) >= 2 ? labelWidthOf(tag, count(tag)) : 0;
		const w = Math.max(inner.width, lblW) + 2 * gap;
		const h = labelStrip + (labelStrip > 0 ? gap : 0) + inner.height + 2 * gap;
		return {
			tag,
			w,
			h,
			own,
			ownPos: ownPack.positions,
			boxes,
			innerPos: inner.positions,
			childMeasured,
			labelStrip,
		};
	};

	const nodes: PositionedNode[] = [];
	const idToRect = new Map<string, Rect>();
	const clusters: ClusterRect[] = [];
	const labelCells: NonNullable<LaidOut["labelCells"]> = [];

	const place = (m: Measured, x: number, y: number): void => {
		if (count(m.tag) >= 2) {
			clusters.push({
				groupKey: m.tag,
				label: labels.get(m.tag) ?? m.tag,
				x,
				y,
				width: m.w,
				height: m.h,
				memberCount: count(m.tag),
				pieces: [{ x, y, w: m.w, h: m.h, kind: "main" }],
			});
			const lblW = labelWidthOf(m.tag, count(m.tag));
			labelCells.push({
				key: m.tag,
				x: x + gap + Math.min(lblW, m.w - 2 * gap) / 2,
				y: y + m.labelStrip / 2,
				w: Math.min(lblW, m.w - 2 * gap),
				h: m.labelStrip,
			});
		}
		const cOx = x + gap;
		const cOy = y + m.labelStrip + (m.labelStrip > 0 ? gap : 0) + gap;
		m.boxes.forEach((b, i) => {
			const bx = cOx + m.innerPos[i].x - b.width / 2;
			const by = cOy + m.innerPos[i].y - b.height / 2;
			if (b.id === OWN) {
				m.own.forEach((n, ni) => {
					const sz = sizedById.get(n.id);
					const w = sz?.width ?? cardW;
					const h = sz?.height ?? cardH;
					const nx = bx + gap + m.ownPos[ni].x;
					const ny = by + gap + m.ownPos[ni].y;
					nodes.push({
						id: n.id,
						label: n.label,
						memberships: n.memberships,
						x: nx,
						y: ny,
						width: w,
						height: h,
						mtime: n.mtime,
						fmMaturity: n.fmMaturity,
						ageDays: n.ageDays,
					});
					idToRect.set(n.id, { x: nx, y: ny, w, h });
				});
			} else {
				const cm = m.childMeasured.find((c) => c.tag === b.id)!;
				place(cm, bx, by);
			}
		});
	};

	// Measure + shelf-pack the roots, then place each.
	const rootMeasured = roots.map(measure);
	const rootSizes: SizedNode[] = rootMeasured.map((rm) => ({
		id: rm.tag,
		label: "",
		memberships: [],
		width: rm.w + 2 * gap,
		height: rm.h + 2 * gap,
	}));
	const canvas =
		rootSizes.length > 0
			? pack(rootSizes, 2 * gap)
			: { positions: [], width: 0, height: 0 };
	rootMeasured.forEach((rm, i) => {
		place(rm, canvas.positions[i].x - rm.w / 2, canvas.positions[i].y - rm.h / 2);
	});

	// PARTIAL-OVERLAP exclaves (combines overlap with the clean nesting). A
	// member of tag T that ended up OUTSIDE T's nested rectangle — because it is
	// homed in a CROSS-CUTTING tag (one neither containing nor contained by T) —
	// gets a small piece at its actual position. T's region therefore reaches
	// into the other tag, so the partial intersection is shown, without
	// duplicating the node or breaking the nesting. (Laminar tags produce no
	// exclaves → they stay clean concentric rectangles.)
	if (opts.viewMode !== "bubblesets") {
		const nodeByIdForExclave = new Map(data.nodes.map((n) => [n.id, n]));
		for (const c of clusters) {
			const members = tagMembers.get(c.groupKey);
			if (!members || !c.pieces) continue;
			const rr = c.x + c.width;
			const rb = c.y + c.height;
			for (const id of members) {
				const nr = idToRect.get(id);
				if (!nr) continue;
				if (nr.x >= c.x && nr.x <= rr && nr.y >= c.y && nr.y <= rb) continue;
				// This exclave IS the intersection of c.groupKey with the node's other
				// membership(s) — stripe it by ALL of the node's tags (≥2) so it reads
				// as ∩, matching layoutEulerNested's sub-box treatment.
				const node = nodeByIdForExclave.get(id);
				const tags = node && node.memberships.length > 0 ? node.memberships : [c.groupKey];
				c.pieces.push({
					x: nr.x - nr.w / 2 - gap / 2,
					y: nr.y - nr.h / 2 - gap / 2,
					w: nr.w + gap,
					h: nr.h + gap,
					kind: "sub",
					hueKey: c.groupKey,
					hueKeys: tags.length > 1 ? tags.slice() : undefined,
				});
			}
		}
	} else {
		// Bubblesets (bubble mode) node placement is produced entirely by
		// componentEulerLayout (+ the box-follow fitSubtree pass) below, which
		// overwrites every node coordinate. The earlier degree-cascade region
		// placement / shared-occupancy packing / integrity force-push that lived
		// here was therefore dead and has been removed.

		// Re-lay every card onto the slot grid (方眼) GROUPED BY MEMBERSHIP, so
		// each tag's box ends up containing ONLY its own members. The previous
		// continuous-coordinate placement (siblingOverlapPack + force-push)
		// scattered same-membership cards across the figure, so a tag's
		// axis-aligned bbox swallowed unrelated cards sitting in its gaps.
		// Instead: bucket cards by their exact (enclosure-wrapper-stripped)
		// membership signature, sort the buckets, and lay each bucket as one
		// CONTIGUOUS rectangular block of cells, blocks left-to-right with a
		// one-column gap. Because the buckets are sorted, every tag's blocks
		// stay adjacent, so its bbox is a clean rectangle over its members only
		// (and where two tags share members the shared bucket sits between
		// them, so their boxes still overlap exactly there — the Euler effect,
		// now grid-aligned). One card per cell ⇒ zero overlap by construction.
		//
		// Component-Based Euler Layout: groups tags into connected components.
		// For EVERY component, forces a strict 3x3 Venn grid layout for its top 3 tags,
		// preventing the 1-D strip fallback from swallowing unrelated nodes via alphabetical
		// sorting. Outer nodes and minor tags are packed to the right of each grid.
		{
			const placed = componentEulerLayout(nodes, {
				slotW,
				slotH,
				isEnclosureOf,
				tagMembers,
				totalNodes: data.nodes.length,
				noneBucket: NONE_BUCKET,
			});
			for (const n of nodes) {
				const p = placed.positions.get(n.id);
				if (!p) continue;
				n.x = p.x;
				n.y = p.y;
				const r = idToRect.get(n.id);
				if (r) {
					r.x = n.x;
					r.y = n.y;
				}
			}
		}

		// Make every cluster's MAIN box FOLLOW its content, propagated BOTTOM-UP
		// through the containment forest. The measure()/place() recursion sized
		// and positioned each box from the NESTING layout, before the
		// degree-cascade above relocated every degree>=2 node into its
		// intersection region — leaving the boxes floating away from the cards
		// they enclose. Recompute here, post-order:
		//   • a LEAF tag's box hugs its own member cards (+ gap margin, + a
		//     title-bar strip above), so the enclosure tracks its cards and
		//     sibling boxes overlap exactly where their members coincide (the
		//     Euler effect);
		//   • a PARENT tag's box additionally CONTAINS all of its child boxes
		//     plus the same margin, so a base-file wrapper like `_all` (the
		//     forest root holding every view) reads as the OUTER enclosure
		//     visibly wrapping beat/scene/sequence/… instead of collapsing to
		//     the same size as the node cloud it shares with them.
		// Label chips are re-seated onto each new title strip.
		const labelCellByKey = new Map(labelCells.map((lc) => [lc.key, lc]));
		const clusterByKeyFit = new Map(clusters.map((c) => [c.groupKey, c]));
		interface FitBox { minX: number; minY: number; maxX: number; maxY: number; }
		const nodeBboxOf = (tag: string): FitBox | null => {
			const members = tagMembers.get(tag);
			if (!members) return null;
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (const id of members) {
				const r = idToRect.get(id);
				if (!r) continue;
				minX = Math.min(minX, r.x - r.w / 2);
				minY = Math.min(minY, r.y - r.h / 2);
				maxX = Math.max(maxX, r.x + r.w / 2);
				maxY = Math.max(maxY, r.y + r.h / 2);
			}
			return minX > maxX ? null : { minX, minY, maxX, maxY };
		};
		const fitSubtree = (tag: string): FitBox | null => {
			// Post-order: fit children first, then this box must contain them.
			let inner = nodeBboxOf(tag);
			for (const ch of children.get(tag) ?? []) {
				const cb = fitSubtree(ch);
				if (!cb) continue;
				inner = inner
					? {
							minX: Math.min(inner.minX, cb.minX),
							minY: Math.min(inner.minY, cb.minY),
							maxX: Math.max(inner.maxX, cb.maxX),
							maxY: Math.max(inner.maxY, cb.maxY),
						}
					: { ...cb };
			}
			if (!inner) return null;
			const c = clusterByKeyFit.get(tag);
			if (!c) return inner; // count-1 tag: no cluster — just propagate bbox
			const main = c.pieces?.find((p) => p.kind === "main" && !p.contour);
			const lblW = bubbleLabelWidthOf(tag, c.memberCount);
			// Box edges SNAP to the slot grid (方眼), same as the cards. A full
			// CELL of margin on every side (vs. the old sub-cell `gap`) makes the
			// boxes noticeably wider and — because `inner` already includes each
			// child's box — guarantees a parent is at least one whole cell bigger
			// than its children on every side, so the nesting reads cleanly on
			// the grid. The title bar is reserved as whole cell rows at the top.
			const labelRows = Math.max(1, Math.ceil(bubbleLabelH / slotH));
			let boxLeft = inner.minX - slotW;
			let boxRight = Math.max(inner.maxX + slotW, boxLeft + lblW + 2 * gap);
			const boxTop = inner.minY - slotH - labelRows * slotH;
			const boxBottom = inner.maxY + slotH;
			// Snap every edge OUTWARD to the nearest grid line.
			boxLeft = Math.floor(boxLeft / slotW) * slotW;
			boxRight = Math.ceil(boxRight / slotW) * slotW;
			const snapTop = Math.floor(boxTop / slotH) * slotH;
			const snapBottom = Math.ceil(boxBottom / slotH) * slotH;
			
			// Grid-aligned box edges (no sub-cell pseudo-random offsets — those
			// broke the 罫線 alignment). Coincident edges between identical-member
			// boxes are separated by the whole-cell post-pass after fitSubtree.
			const boxX = boxLeft;
			const boxY = snapTop;
			const boxW = boxRight - boxLeft;
			const boxH = snapBottom - snapTop;
			if (main) {
				main.x = boxX;
				main.y = boxY;
				main.w = boxW;
				main.h = boxH;
			}
			c.x = boxX;
			c.y = boxY;
			c.width = boxW;
			c.height = boxH;
			const lc = labelCellByKey.get(tag);
			if (lc) {
				// Label sits at the box's INNER TOP-RIGHT, aligned to grid cells
				// (罫線に沿って): occupy whole cells in the title-bar rows at the
				// right edge.
				const lwCells = Math.max(1, Math.ceil(Math.min(lblW, boxW - 2 * slotW) / slotW));
				const rightCol = Math.round((boxX + boxW) / slotW);
				const topRow = Math.round(boxY / slotH);
				const lblCol = rightCol - lwCells;
				lc.x = (lblCol + lwCells / 2) * slotW;
				lc.y = (topRow + labelRows / 2) * slotH;
				lc.w = lwCells * slotW;
				lc.h = labelRows * slotH;
			}
			return { minX: boxX, minY: boxY, maxX: boxX + boxW, maxY: boxY + boxH };
		};
		for (const r of roots) fitSubtree(r);

		// Whole-cell edge-separation pass. Tags with identical (or near-identical)
		// member sets — e.g. `_all`/`timeline`/`act` all covering every node — get
		// the SAME bbox from fitSubtree, so their outlines draw on top of each
		// other (the blue/orange overlap the user reported). Separate them on the
		// GRID: process boxes small→large; if a box still shares an edge line with
		// an already-placed box it OVERLAPS, grow it one whole cell outward on all
		// sides and re-check — coincident boxes fan out into concentric 1-cell
		// rings, and any new coincidence this causes cascades the same way.
		{
			const mainOfCluster = (c: ClusterRect) =>
				c.pieces?.find((p) => p.kind === "main" && !p.contour) ?? null;
			const entries = clusters
				.map((c) => ({ c, m: mainOfCluster(c) }))
				.filter((e): e is { c: ClusterRect; m: NonNullable<ReturnType<typeof mainOfCluster>> } => !!e.m)
				.sort((a, b) => a.m.w * a.m.h - b.m.w * b.m.h || (a.c.groupKey < b.c.groupKey ? -1 : 1));
			const eps = 1;
			const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
				a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
			const sharesEdge = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
				Math.abs(a.x - b.x) < eps ||
				Math.abs(a.x + a.w - (b.x + b.w)) < eps ||
				Math.abs(a.y - b.y) < eps ||
				Math.abs(a.y + a.h - (b.y + b.h)) < eps;
			const placed: { x: number; y: number; w: number; h: number }[] = [];
			for (const { c, m } of entries) {
				let guard = 0;
				while (
					guard++ < 128 &&
					placed.some((p) => overlaps(m, p) && sharesEdge(m, p))
				) {
					m.x -= slotW;
					m.y -= slotH;
					m.w += 2 * slotW;
					m.h += 2 * slotH;
				}
				c.x = m.x;
				c.y = m.y;
				c.width = m.w;
				c.height = m.h;
				placed.push({ x: m.x, y: m.y, w: m.w, h: m.h });
				// Re-seat the label at the (possibly grown) box's grid-aligned
				// inner top-right.
				const lc = labelCellByKey.get(c.groupKey);
				if (lc) {
					const lblW = bubbleLabelWidthOf(c.groupKey, c.memberCount);
					const labelRows = Math.max(1, Math.ceil(bubbleLabelH / slotH));
					const lwCells = Math.max(1, Math.ceil(Math.min(lblW, m.w - 2 * slotW) / slotW));
					const rightCol = Math.round((m.x + m.w) / slotW);
					const topRow = Math.round(m.y / slotH);
					const lblCol = rightCol - lwCells;
					lc.x = (lblCol + lwCells / 2) * slotW;
					lc.y = (topRow + labelRows / 2) * slotH;
					lc.w = lwCells * slotW;
					lc.h = labelRows * slotH;
				}
			}
		}
	}

	// VISIBLE BOX-OVERLAP stripes. The exclaves above only stripe the tiny
	// per-NODE sub-box at a cross-cutting member's real position. But what the
	// user reads as "the intersection" is the RECTANGULAR OVERLAP where two
	// set boxes (their `main` pieces) visibly cross on screen — and that region
	// was previously left as two solid `tint` fills additively blended (a single
	// muddied colour, never striped). Here we find every overlapping pair of
	// MAIN pieces from cross-cutting clusters (neither tag a subset/superset of
	// the other — laminar/nested pairs are CONTAINMENT, not intersection, and
	// must stay solid) and push a striped `sub` piece over the exact overlap
	// rect with hueKeys = the two cluster tags, so draw-enclosures' existing
	// hueKeys.length>1 branch paints ∩ → vertical bands there. This is the piece
	// the user actually sees as the crossing, so the stripe finally lands on it.
	const ancestorOf = (a: string, b: string): boolean => {
		// true when `a` is a (transitive) ancestor of `b` in the containment
		// forest — i.e. tags are laminar (nested), not cross-cutting.
		let p = parent.get(b) ?? null;
		while (p) {
			if (p === a) return true;
			p = parent.get(p) ?? null;
		}
		return false;
	};
	const mainOf = (c: ClusterRect): { x: number; y: number; w: number; h: number } | null => {
		const m = c.pieces?.find((p) => p.kind === "main" && !p.contour);
		return m ? { x: m.x, y: m.y, w: m.w, h: m.h } : null;
	};
	for (let i = 0; i < clusters.length; i++) {
		for (let j = i + 1; j < clusters.length; j++) {
			const ca = clusters[i];
			const cb = clusters[j];
			// Skip laminar (nested) pairs — their box overlap is containment.
			if (ancestorOf(ca.groupKey, cb.groupKey) || ancestorOf(cb.groupKey, ca.groupKey))
				continue;
			const ma = mainOf(ca);
			const mb = mainOf(cb);
			if (!ma || !mb) continue;
			const ox = Math.max(ma.x, mb.x);
			const oy = Math.max(ma.y, mb.y);
			const ox2 = Math.min(ma.x + ma.w, mb.x + mb.w);
			const oy2 = Math.min(ma.y + ma.h, mb.y + mb.h);
			const ow = ox2 - ox;
			const oh = oy2 - oy;
			if (ow <= 0 || oh <= 0) continue; // boxes don't visibly cross
			// Attach the overlap stripe to the SMALLER (more specific) box's
			// pieces so it draws on top of the larger box's fill; hueKeys carry
			// both tags in a stable order so the band colours are deterministic.
			const host = ca.width * ca.height <= cb.width * cb.height ? ca : cb;
			const tags = [ca.groupKey, cb.groupKey].sort();
			host.pieces?.push({
				x: ox,
				y: oy,
				w: ow,
				h: oh,
				kind: "sub",
				hueKey: host.groupKey,
				hueKeys: tags,
			});
		}
	}

	// Route edges through the channel lattice (each node exists once).
	const routeObstacles = buildRouteObstacles(nodes, slotW, slotH);
	const lanes = new LaneRegistry();
	const edges: PositionedEdge[] = [];
	for (const e of data.edges) {
		const a = idToRect.get(e.source);
		const b = idToRect.get(e.target);
		if (!a || !b) continue;
		let path = routeZ(
			a,
			b,
			lanes,
			slotW,
			slotH,
			channelW,
			channelH,
			routeObstacles,
			e.source,
			e.target,
		);
		if (!path || path.length < 2)
			path = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
		edges.push({
			source: e.source,
			target: e.target,
			weight: 1,
			path,
			bundled: false,
			bundleCount: 1,
		});
	}

	// bubblesets only: cross-cutting tag enclosures intentionally overlap, so
	// their independently-computed label cells (each the box's top-left strip)
	// can land on top of each other. De-conflict them here, in place, using each
	// label's owning cluster's MAIN piece as the box candidates fan out within.
	// euler-true (and every other mode) never reaches this branch, so its
	// labelCells stay byte-identical.
	if (opts.viewMode === "bubblesets" && labelCells.length > 0) {
		const clusterByKey = new Map(clusters.map((c) => [c.groupKey, c]));
		const inputs = labelCells.map((cell) => {
			const c = clusterByKey.get(cell.key);
			const main = c?.pieces?.find((p) => p.kind === "main" && !p.contour);
			const box = main
				? { x: main.x, y: main.y, w: main.w, h: main.h }
				: { x: cell.x - cell.w / 2, y: cell.y - cell.h / 2, w: cell.w, h: cell.h };
			return { key: cell.key, x: cell.x, y: cell.y, w: cell.w, h: cell.h, box };
		});
		// Seed the de-confliction with every placed card as an obstacle so a
		// cluster label never renders on top of a node card. The reserved title
		// strip above each box's cards is card-free, so labels that don't
		// collide with each other stay there; the rest fall through to the
		// card-free top-edge anchors or the above/below-box escapes.
		const nodeObstacles = nodes.map((nd) => ({
			x1: nd.x - nd.width / 2,
			y1: nd.y - nd.height / 2,
			x2: nd.x + nd.width / 2,
			y2: nd.y + nd.height / 2,
		}));
		const placed = placeClusterLabels(inputs, nodeObstacles);
		labelCells.forEach((cell, i) => {
			cell.x = placed[i].x;
			cell.y = placed[i].y;
		});
		// The de-confliction pins each label to its box's TOP-LEFT and, when
		// labels would collide, STACKS the loser straight up just above the box
		// top. We deliberately do NOT grow the boxes to swallow the lifted
		// labels: growing a small inner box up far enough to contain its lifted
		// label would push its top ABOVE its parent (e.g. `scene` rising over
		// `_all`), breaking the containment nesting. Leaving the box geometry
		// from fitSubtree intact keeps `_all` the outermost box; the lifted
		// label simply floats in the clear band just above its own box's
		// top-left corner (clampToBox=false in drawClusterLabels lets it).
	}

	return {
		nodes,
		edges,
		clusters,
		trunks: [],
		slotW,
		slotH,
		channelW,
		channelH,
		labelCells,
	};
}


