// Intersection-lattice renderer. World-space layout with pan/zoom; each node
// is drawn with a count + zoom-driven LOD so a 500-note intersection costs the
// same to draw as a 5-note one (cell count is bounded by latticeDensityCells).
//
// REWRITE (2026-05-28): explicit constants for all geometry, NO `drawCard`
// reuse, `truncateToWidth` confined to the HEADER BAND ONLY so a tiny node
// can never collapse into a lone "…". Each LOD has its own body painter
// (bar / waffle / cells), and subset links use cubic-bezier S-curves with
// hover-only emphasis instead of dim straight lines.
import type { LatticeMeta, LatticeNodeMeta } from "./layout";
import {
	clusterHue,
	truncateToWidth,
	roundedRectPath,
	floorWorldFontPx,
} from "./canvas-utils";
import {
	densityBins,
	lodFor,
	latticeBodyMetrics,
	BODY_PAD,
	TIER_PAD_Y,
	TITLE_PX,
	TITLE_LINE_H,
	TITLE_PAD,
	HEADER_PAD_X as LAYOUT_HEADER_PAD_X,
	HEADER_COUNT_GAP,
	HEADER_CB_SIZE,
	HEADER_CB_GAP,
	NAMED_ROW_H,
	NAME_FONT_PX,
	NAMED_BODY_PAD_X,
} from "./lattice-layout";
import { theme } from "./theme";

interface DrawLatticeOpts {
	zoom: number;
	panX: number;
	panY: number;
	canvas: HTMLCanvasElement;
	dpr: number;
	minFontPx: number;
	settings: {
		latticeNodeLOD: "auto" | "overview" | "density" | "individual";
		latticeIndividualMax: number;
		latticeDensityMax: number;
		latticeDensityCells: number;
		latticeShowSubsetLinks: boolean;
	};
	selectedKey: string | null;
	hoverKey: string | null;
	// Keys of nodes whose body shows note NAMES (header checkbox checked).
	namedKeys: Set<string>;
	// Max names shown before "+N" (mirrors settings.latticeNamedMax). The
	// layout uses the same bound to enlarge each named node's H.
	namedMax: number;
	// Optional id → display name resolver. Renderer has no access to the
	// vault, so view.ts passes a closure that returns the file basename;
	// when missing we fall back to a path-tail basename extraction.
	nameOf?: (id: string) => string;
}

// === World-space drawing constants ======================================
// All numbers below are nominal screen-pixel intents that get divided by
// `zoom` before drawing, so strokes / radii / paddings stay visually
// constant regardless of pan-zoom.
const NODE_RADIUS = 6; // rounded-corner radius (screen px)
const TIER_LABEL_FONT_PX = 13;
const TIER_LABEL_FONT_SMALL_PX = 11;
// Header count font — smaller than the title so the (now leading) checkbox
// + tag rows dominate the band. The right-aligned count remains, just less
// loud.
const COUNT_FONT_PX = 9;
const FOOTER_FONT_PX = 9;
const OVERVIEW_BAR_H = 12;
// Header LOD floor — when the title font would render below this many
// screen pixels, the renderer falls back to "count only" instead of
// truncated tag rows (no bare "…" labels). Header band + colour stay so
// nodes remain visually identifiable.

// Screen-fixed left gutter that holds the tier labels. Drawn TOPMOST after
// every world-space pass so nodes can pan freely beneath it (the gutter is
// opaque — labels stay legible even when nodes scroll under it). Wide
// enough to fit "次数 N" + the "M交差 / K件" subtitle without truncation.
export const TIER_GUTTER = 168;
const TIER_GUTTER_PAD_X = 10;
const TIER_GUTTER_LINE_GAP = 2;

// Subset-link styling.
const linkDimRgba = () => theme().overlay(0.18);
const LINK_DIM_LINE_W = 1;
const LINK_HOVER_LINE_W = 2;

export function drawLattice(
	ctx: CanvasRenderingContext2D,
	meta: LatticeMeta,
	o: DrawLatticeOpts,
): void {
	const dpr = o.dpr;
	const visW = o.canvas.width / dpr;
	const visH = o.canvas.height / dpr;

	// 1. Background (screen-space).
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.fillStyle = theme().canvasBg;
	ctx.fillRect(0, 0, visW, visH);
	if (meta.nodes.length === 0) {
		drawEmptyState(ctx, visW, visH);
		return;
	}

	// 2. World transform — every subsequent draw uses world coords. Strokes /
	//    fonts inside the transform are divided by zoom so they keep their
	//    intended screen-pixel size.
	ctx.setTransform(
		dpr * o.zoom,
		0,
		0,
		dpr * o.zoom,
		dpr * o.panX,
		dpr * o.panY,
	);
	const z = o.zoom;
	const wLeft = -o.panX / z;
	const wTop = -o.panY / z;
	const wRight = (visW - o.panX) / z;
	const wBottom = (visH - o.panY) / z;
	const minFont = o.minFontPx;

	// 3. Tier band backgrounds + hairlines (world space). The TEXT labels are
	//    rendered AFTER the world-space pass in screen space (sticky-left), so
	//    horizontal pan never carries them off-screen.
	drawTierBands(ctx, meta, z, wLeft, wRight);

	// 4. Subset links (BEHIND nodes, dim by default).
	if (o.settings.latticeShowSubsetLinks && meta.links.length) {
		drawSubsetLinks(ctx, meta, z, o.hoverKey, wLeft, wTop, wRight, wBottom);
	}

	// 5. Nodes — frustum-culled.
	const maxCount = Math.max(1, meta.maxCount);
	for (const node of meta.nodes) {
		if (
			node.x + node.w < wLeft ||
			node.x > wRight ||
			node.y + node.h < wTop ||
			node.y > wBottom
		)
			continue;
		drawNode(ctx, node, o, z, minFont, maxCount, wLeft, wTop, wRight, wBottom);
	}

	// 6. Restore identity and draw the screen-fixed left gutter + tier labels
	//    on top of every world-space pass. Gutter is opaque so any node that
	//    pans into x ∈ [0, TIER_GUTTER) stays hidden behind it.
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	drawTierLabels(ctx, meta, z, o.panY, visH, minFont);
}

// ---------------------------------------------------------------------------
// Tier bands + labels
// ---------------------------------------------------------------------------

function drawTierBands(
	ctx: CanvasRenderingContext2D,
	meta: LatticeMeta,
	z: number,
	wLeft: number,
	wRight: number,
): void {
	if (meta.tiers.length === 0) return;
	const tierBands = computeTierBands(meta);
	for (const band of tierBands) {
		// Subtle band background spanning the whole world width so the tier
		// reads as one horizontal strip.
		ctx.fillStyle = band.degree % 2 === 0
			? theme().overlay(0.025)
			: theme().overlay(0.04);
		ctx.fillRect(0, band.y, meta.worldWidth, band.h);
		// Hairlines top + bottom (1 screen px regardless of zoom).
		ctx.strokeStyle = theme().overlay(0.10);
		ctx.lineWidth = 1 / z;
		ctx.beginPath();
		ctx.moveTo(wLeft, band.y);
		ctx.lineTo(wRight, band.y);
		ctx.moveTo(wLeft, band.y + band.h);
		ctx.lineTo(wRight, band.y + band.h);
		ctx.stroke();
	}
}

// Screen-fixed left GUTTER + tier labels — drawn TOPMOST after the world
// transform is reset, so nodes can pan freely underneath without the labels
// ever being occluded. Gutter is fully opaque (no alpha) so even a node
// scrolled to the canvas-left stays hidden behind it. Each label is a 2-line
// block:  L1 "次数 {degree}"  /  L2 "{交差数}交差 / {件数}件".
//
// Wide enough that the L2 string with both numbers ALWAYS fits (no trailing
// "…"). If a freakishly large vault still overflows the L2, we drop the
// units before allowing truncate so the digits stay visible.
function drawTierLabels(
	ctx: CanvasRenderingContext2D,
	meta: LatticeMeta,
	zoom: number,
	panY: number,
	visH: number,
	minFont: number,
): void {
	// 1. Opaque gutter background — covers the full canvas height so the
	//    labels never sit on a transparent strip showing nodes underneath.
	ctx.fillStyle = theme().canvasBg;
	ctx.fillRect(0, 0, TIER_GUTTER, visH);
	// Subtle right-edge hairline so the gutter reads as a separate column.
	ctx.fillStyle = theme().overlay(0.06);
	ctx.fillRect(TIER_GUTTER - 1, 0, 1, visH);
	if (meta.tiers.length === 0) return;

	const tierBands = computeTierBands(meta);
	const l1Font = Math.max(minFont, TIER_LABEL_FONT_PX);
	const l2Font = Math.max(minFont, TIER_LABEL_FONT_SMALL_PX);
	const labelMaxW = TIER_GUTTER - TIER_GUTTER_PAD_X * 2;

	ctx.textBaseline = "middle";
	ctx.textAlign = "start";
	for (const band of tierBands) {
		const yMid = panY + (band.y + band.h / 2) * zoom;
		// Skip if the tier is offscreen — quick cull.
		if (yMid < -50 || yMid > visH + 50) continue;

		// Line 1 — "Degree N". Always fits (very short).
		ctx.font = `700 ${l1Font}px sans-serif`;
		ctx.fillStyle = theme().textNormal;
		const l1Y = yMid - (l1Font + l2Font + TIER_GUTTER_LINE_GAP) / 2 + l1Font / 2;
		ctx.fillText(`Degree ${band.degree}`, TIER_GUTTER_PAD_X, l1Y);

		// Line 2 — "{M} intersections / {S} notes". If it doesn't fit, drop
		// the unit words before letting truncateToWidth introduce a "…" —
		// the digits matter more than the suffix.
		ctx.font = `${l2Font}px sans-serif`;
		ctx.fillStyle = theme().textMuted;
		const full = `${band.intersectionCount} intersections / ${band.noteSum} notes`;
		const numeric = `${band.intersectionCount} / ${band.noteSum}`;
		let l2 = full;
		if (ctx.measureText(full).width > labelMaxW) {
			l2 = ctx.measureText(numeric).width <= labelMaxW
				? numeric
				: truncateToWidth(ctx, numeric, labelMaxW);
		}
		const l2Y = l1Y + l1Font / 2 + TIER_GUTTER_LINE_GAP + l2Font / 2;
		ctx.fillText(l2, TIER_GUTTER_PAD_X, l2Y);
	}
}

function computeTierBands(meta: LatticeMeta): Array<{
	degree: number;
	y: number;
	h: number;
	intersectionCount: number;
	noteSum: number;
}> {
	// One band per non-empty tier. y/h derived from the actual node y/h plus
	// TIER_PAD_Y on each side, so a mixed-LOD tier still reads as one row.
	const bands: Array<{
		degree: number;
		y: number;
		h: number;
		intersectionCount: number;
		noteSum: number;
	}> = [];
	for (const tierIdxs of meta.tiers) {
		if (!tierIdxs.length) continue;
		let yMin = Infinity;
		let yMax = -Infinity;
		let noteSum = 0;
		const first = meta.nodes[tierIdxs[0]];
		for (const i of tierIdxs) {
			const n = meta.nodes[i];
			if (n.y < yMin) yMin = n.y;
			if (n.y + n.h > yMax) yMax = n.y + n.h;
			noteSum += n.count;
		}
		bands.push({
			degree: first.degree,
			y: yMin - TIER_PAD_Y,
			h: yMax - yMin + TIER_PAD_Y * 2,
			intersectionCount: tierIdxs.length,
			noteSum,
		});
	}
	return bands;
}

// ---------------------------------------------------------------------------
// Subset links — cubic-bezier S-curve, dim default, hover-emphasised
// ---------------------------------------------------------------------------

function drawSubsetLinks(
	ctx: CanvasRenderingContext2D,
	meta: LatticeMeta,
	z: number,
	hoverKey: string | null,
	wLeft: number,
	wTop: number,
	wRight: number,
	wBottom: number,
): void {
	const indexByKey = new Map<string, number>();
	meta.nodes.forEach((n, i) => indexByKey.set(n.key, i));

	// 1. Dim back layer — every link, low alpha, thin.
	ctx.strokeStyle = linkDimRgba();
	ctx.lineWidth = LINK_DIM_LINE_W / z;
	ctx.beginPath();
	for (const lk of meta.links) {
		const fi = indexByKey.get(lk.from);
		const ti = indexByKey.get(lk.to);
		if (fi === undefined || ti === undefined) continue;
		const a = meta.nodes[fi];
		const b = meta.nodes[ti];
		if (
			Math.max(a.x + a.w, b.x + b.w) < wLeft ||
			Math.min(a.x, b.x) > wRight ||
			Math.max(a.y + a.h, b.y + b.h) < wTop ||
			Math.min(a.y, b.y) > wBottom
		)
			continue;
		appendBezierLink(ctx, a, b);
	}
	ctx.stroke();

	// 2. Hover emphasis — only links touching the hovered node, in the seed's
	//    clusterHue and thicker.
	if (hoverKey) {
		const hoverIdx = indexByKey.get(hoverKey);
		if (hoverIdx !== undefined) {
			const hoverNode = meta.nodes[hoverIdx];
			const seed = nodeSeed(hoverNode);
			const hue = clusterHue(seed);
			ctx.strokeStyle = theme().swatch(hue, "stroke", 0.95);
			ctx.lineWidth = LINK_HOVER_LINE_W / z;
			ctx.beginPath();
			for (const lk of meta.links) {
				if (lk.from !== hoverKey && lk.to !== hoverKey) continue;
				const fi = indexByKey.get(lk.from);
				const ti = indexByKey.get(lk.to);
				if (fi === undefined || ti === undefined) continue;
				appendBezierLink(ctx, meta.nodes[fi], meta.nodes[ti]);
			}
			ctx.stroke();
		}
	}
}

// Append one cubic-bezier from `a.bottom-center` to `b.top-center` to the
// CURRENT path. Caller wraps in beginPath / stroke. `a` is the higher-degree
// node, `b` the lower (per layout link orientation), regardless of visual
// orientation (specificTop flips that, but the bezier handles both directions).
function appendBezierLink(
	ctx: CanvasRenderingContext2D,
	a: LatticeNodeMeta,
	b: LatticeNodeMeta,
): void {
	const ax = a.x + a.w / 2;
	const ay = a.y + a.h;
	const bx = b.x + b.w / 2;
	const by = b.y;
	const midY = (ay + by) / 2;
	ctx.moveTo(ax, ay);
	ctx.bezierCurveTo(ax, midY, bx, midY, bx, by);
}

// ---------------------------------------------------------------------------
// Per-node rendering — common frame + LOD-dispatched body
// ---------------------------------------------------------------------------

function nodeSeed(node: LatticeNodeMeta): string {
	if (node.isOther) return `__other__@${node.degree}`;
	if (node.signature.length === 0) return node.key || "?";
	return node.signature[0];
}

function drawNode(
	ctx: CanvasRenderingContext2D,
	node: LatticeNodeMeta,
	o: DrawLatticeOpts,
	z: number,
	minFont: number,
	maxCount: number,
	wLeft: number,
	wTop: number,
	wRight: number,
	wBottom: number,
): void {
	const seed = nodeSeed(node);
	const hue = clusterHue(seed);
	const isSelected = o.selectedKey === node.key;
	const isHover = o.hoverKey === node.key;

	// 1. Body fill — calm dark base; hover/selection gets a tinted underlay.
	ctx.beginPath();
	roundedRectPath(ctx, node.x, node.y, node.w, node.h, NODE_RADIUS / z);
	ctx.fillStyle = theme().canvasBgAlt;
	ctx.fill();
	if (isSelected || isHover) {
		ctx.fillStyle = isSelected
			? theme().swatch(hue, "tint", 0.30)
			: theme().swatch(hue, "tint", 0.18);
		ctx.beginPath();
		roundedRectPath(ctx, node.x, node.y, node.w, node.h, NODE_RADIUS / z);
		ctx.fill();
	}

	// 2. Border — hue-tinted; selection/hover emphasised.
	ctx.lineWidth = (isSelected ? 2 : isHover ? 1.5 : 1) / z;
	ctx.strokeStyle = isSelected
		? theme().swatch(hue, "fillStrong")
		: isHover
			? theme().swatch(hue, "fill")
			: theme().swatch(hue, "fill", 0.6);
	ctx.beginPath();
	roundedRectPath(ctx, node.x, node.y, node.w, node.h, NODE_RADIUS / z);
	ctx.stroke();

	// 3. Header band — coloured strip with checkbox + signature + count.
	const named = o.namedKeys.has(node.key);
	drawHeader(ctx, node, hue, z, minFont, named);

	// 4. Body — checkbox-checked nodes show a vertical list of file names
	//    (basenames) instead of the auto-LOD bar/waffle/cells. Layout sized
	//    the node to fit `namedMax` rows; the renderer prints them.
	if (named) {
		const bodyTop = node.y + node.headerH + BODY_PAD;
		const bodyLeft = node.x + BODY_PAD;
		const bodyW = node.w - BODY_PAD * 2;
		const bodyMaxH = node.h - node.headerH - BODY_PAD * 2;
		if (bodyMaxH > 0) {
			drawNamedList(
				ctx,
				node,
				bodyLeft,
				bodyTop,
				bodyW,
				bodyMaxH,
				hue,
				z,
				minFont,
				o.namedMax,
				o.nameOf ?? fallbackBasename,
			);
		}
		return;
	}

	// 4-LOD. Use CURRENT zoom (semantic zoom), not the layout-time default,
	// so an `auto` node promotes/demotes as the user zooms in / out. Reuse
	// `latticeBodyMetrics` so layout and renderer agree on the grid shape.
	const eff = lodFor(node.count, z, o.settings);
	// Density-degrade for individual when the cells would render below the
	// font floor (cells become specks → ワッフルとして読ませる).
	const effClamped =
		eff === "individual" && INDIVIDUAL_CELL_SCREEN(z) < minFont * 0.5
			? "density"
			: eff;
	const bodyTop = node.y + node.headerH + BODY_PAD;
	const bodyLeft = node.x + BODY_PAD;
	const bodyW = node.w - BODY_PAD * 2;
	const bodyMaxH = node.h - node.headerH - BODY_PAD * 2;
	if (bodyMaxH <= 0) return;
	if (effClamped === "overview") {
		drawOverview(
			ctx,
			node,
			bodyLeft,
			bodyTop,
			bodyW,
			bodyMaxH,
			hue,
			z,
			minFont,
			maxCount,
		);
	} else if (effClamped === "density") {
		drawDensity(
			ctx,
			node,
			bodyLeft,
			bodyTop,
			bodyW,
			bodyMaxH,
			hue,
			z,
			minFont,
			o.settings.latticeDensityCells,
		);
	} else {
		drawIndividual(
			ctx,
			node,
			bodyLeft,
			bodyTop,
			bodyW,
			bodyMaxH,
			hue,
			z,
			minFont,
			o.settings.latticeDensityCells,
			wLeft,
			wTop,
			wRight,
			wBottom,
		);
	}
}

// On-screen pixel size of an INDIVIDUAL cell. Used to demote to density when
// the cells get too tiny to read.
function INDIVIDUAL_CELL_SCREEN(zoom: number): number {
	return 12 * zoom;
}

// ---------------------------------------------------------------------------
// Header band — signature ∩ joined + right-aligned count
// ---------------------------------------------------------------------------

function drawHeader(
	ctx: CanvasRenderingContext2D,
	node: LatticeNodeMeta,
	hue: number,
	z: number,
	minFont: number,
	named: boolean,
): void {
	const headerH = node.headerH;
	// Coloured tinted strip behind the title + count so each node's tag
	// identity reads at a glance even when the LOD body is a generic bar
	// or waffle. We clip ALL header text to this rect so a floored font
	// (large at low zoom) doesn't spill onto the node body below.
	ctx.save();
	ctx.beginPath();
	ctx.rect(node.x, node.y, node.w, headerH);
	ctx.clip();
	ctx.fillStyle = theme().swatch(hue, "fill", 0.85);
	ctx.fillRect(node.x, node.y, node.w, headerH);

	// Title font intent → world units after the min-font floor. We use the
	// raw intended px (before the floor) to decide whether to draw the tag
	// rows at all: once the floor would push the font far beyond the cell
	// pitch, the rows become unreadable and we fall back to "count only"
	// instead of a bare "…".
	const titleFontWorld = floorWorldFontPx(TITLE_PX, minFont, z);
	const countFontPx = floorWorldFontPx(COUNT_FONT_PX, minFont, z);

	// Right-aligned count — always drawn (it's the smallest atom of identity
	// after colour). Smaller font so the leading checkbox + tag rows
	// dominate. Position vertically on line 1's centre. Header internals
	// run in WORLD units (padX, cb size, gap) so the renderer's geometry
	// matches the layout's `cbSlotW` reservation exactly.
	const countText = `${node.count}`;
	ctx.font = `600 ${countFontPx}px sans-serif`;
	const countW = ctx.measureText(countText).width;
	const padX = LAYOUT_HEADER_PAD_X;
	const countX = node.x + node.w - padX - countW;
	// Line-1 centre y matches the layout: TITLE_PAD + TITLE_LINE_H/2.
	const line1Y = node.y + TITLE_PAD + TITLE_LINE_H / 2;
	ctx.fillStyle = theme().warn;
	ctx.textAlign = "start";
	ctx.textBaseline = "middle";
	ctx.fillText(countText, countX, line1Y);

	// Header checkbox — drawn on line 1, LEFT of the tag rows. Sized in WORLD
	// units (no /z) so the box never overflows the header band vertically,
	// regardless of zoom. The visual scales DOWN with zoom-out (small but
	// still visible at fit-to-view ≈ 7 screen px); the matching hit test in
	// `latticeHeaderCheckboxHit` widens to the entire header-left gutter so
	// the click target stays comfortably large for a mouse.
	const cbSize = HEADER_CB_SIZE;
	const cbX = node.x + LAYOUT_HEADER_PAD_X;
	const cbY = line1Y - cbSize / 2;
	ctx.beginPath();
	roundedRectPath(ctx, cbX, cbY, cbSize, cbSize, 2);
	ctx.fillStyle = named ? theme().overlay(0.22) : "rgba(0,0,0,0.45)";
	ctx.fill();
	ctx.lineWidth = 1 / z;
	ctx.strokeStyle = named ? theme().accent : theme().overlay(0.85);
	ctx.stroke();
	if (named) {
		// ✓ check mark.
		ctx.strokeStyle = theme().textNormal;
		ctx.lineWidth = 1.8 / z;
		ctx.beginPath();
		ctx.moveTo(cbX + cbSize * 0.18, cbY + cbSize * 0.55);
		ctx.lineTo(cbX + cbSize * 0.42, cbY + cbSize * 0.80);
		ctx.lineTo(cbX + cbSize * 0.85, cbY + cbSize * 0.22);
		ctx.stroke();
	}

	// LOD: We no longer skip tag rows. The minFont floor guarantees they remain
	// visible at the configured minimum screen size, even when heavily zoomed out.

	// Tag rows — one display line per LatticeNodeMeta.displayLines entry.
	// Layout sized the node to fit each line PLUS the checkbox column, so
	// `truncateToWidth` here is a safety net for the rare overflow case.
	ctx.font = `600 ${titleFontWorld}px sans-serif`;
	ctx.fillStyle = theme().textNormal;
	const titleX = cbX + cbSize + HEADER_CB_GAP;
	for (let i = 0; i < node.displayLines.length; i++) {
		const lineY = node.y + TITLE_PAD + (i + 0.5) * TITLE_LINE_H;
		// Line 1 must leave room for the count on its right.
		const reservedRight = i === 0 ? countW + HEADER_COUNT_GAP : 0;
		const maxW = node.x + node.w - padX - reservedRight - titleX;
		if (maxW <= 0) continue;
		const text = node.displayLines[i];
		const fitted = ctx.measureText(text).width <= maxW
			? text
			: truncateToWidth(ctx, text, maxW);
		ctx.fillText(fitted, titleX, lineY);
	}
	ctx.restore();
}

// ---------------------------------------------------------------------------
// LOD: overview — single horizontal bar
// ---------------------------------------------------------------------------

function drawOverview(
	ctx: CanvasRenderingContext2D,
	node: LatticeNodeMeta,
	bodyLeft: number,
	bodyTop: number,
	bodyW: number,
	bodyMaxH: number,
	hue: number,
	z: number,
	minFont: number,
	maxCount: number,
): void {
	// Bar length = count / maxCount * bodyW (per spec). maxCount is the largest
	// `count` across the whole lattice, so the longest bar uses the full width
	// and every other node reads as a proportion of it at a glance.
	const frac = Math.min(1, node.count / Math.max(1, maxCount));
	const barH = Math.min(OVERVIEW_BAR_H, bodyMaxH);
	const barY = bodyTop + Math.floor((bodyMaxH - barH) / 2);
	// Background track.
	ctx.fillStyle = theme().overlay(0.06);
	ctx.fillRect(bodyLeft, barY, bodyW, barH);
	// Filled portion.
	ctx.fillStyle = theme().swatch(hue, "fill", 0.95);
	ctx.fillRect(bodyLeft, barY, Math.max(2, bodyW * frac), barH);
	// Right-anchored "N 件" badge for redundancy with the header count — kept
	// small (FOOTER font) so it disappears gracefully when font floors hit it.
	const labelFont = floorWorldFontPx(FOOTER_FONT_PX, minFont, z);
	ctx.font = `${labelFont}px sans-serif`;
	ctx.fillStyle = theme().textMuted;
	ctx.textAlign = "end";
	ctx.textBaseline = "middle";
	ctx.fillText(`${node.count} notes`, bodyLeft + bodyW, barY + barH / 2);
	ctx.textAlign = "start";
}

// ---------------------------------------------------------------------------
// LOD: density — fixed waffle (cells ≤ latticeDensityCells)
// ---------------------------------------------------------------------------

function drawDensity(
	ctx: CanvasRenderingContext2D,
	node: LatticeNodeMeta,
	bodyLeft: number,
	bodyTop: number,
	bodyW: number,
	bodyMaxH: number,
	hue: number,
	z: number,
	minFont: number,
	densityCells: number,
): void {
	const m = latticeBodyMetrics(
		"density",
		node.count,
		densityCells,
		node.w,
		node.headerH,
	);
	const cellSize = m.cellSize;
	const cellGap = m.cellGap;
	// Centre the waffle horizontally within the body box (the metrics body
	// may be narrower than the body box because cell pitch is integer).
	const xOffset = Math.max(0, Math.floor((bodyW - m.bodyW) / 2));
	const yOffset = 0;
	const { perCell, filled } = densityBins(node.count, densityCells);
	const lit = theme().swatch(hue, "fill", 0.92);
	const dim = theme().swatch(hue, "dim", 0.32);
	for (let r = 0, drawn = 0; r < m.rows && drawn < densityCells; r++) {
		for (let c = 0; c < m.cols && drawn < densityCells; c++, drawn++) {
			const cx = bodyLeft + xOffset + c * (cellSize + cellGap);
			const cy = bodyTop + yOffset + r * (cellSize + cellGap);
			ctx.fillStyle = drawn < filled ? lit : dim;
			ctx.fillRect(cx, cy, cellSize, cellSize);
		}
	}
	// Footer: "1 cell ≈ M notes" when perCell > 1 (otherwise redundant).
	if (perCell > 1) {
		const footFont = floorWorldFontPx(FOOTER_FONT_PX, minFont, z);
		const footY = bodyTop + yOffset + m.bodyH + 3;
		if (footY + footFont <= bodyTop + bodyMaxH) {
			ctx.font = `${footFont}px sans-serif`;
			ctx.fillStyle = theme().textMuted;
			ctx.textBaseline = "top";
			ctx.fillText(`1 cell ≈ ${perCell} notes`, bodyLeft, footY);
		}
	}
}

// ---------------------------------------------------------------------------
// LOD: individual — 1 note = 1 cell, viewport-culled, hard-capped + "+N"
// ---------------------------------------------------------------------------

function drawIndividual(
	ctx: CanvasRenderingContext2D,
	node: LatticeNodeMeta,
	bodyLeft: number,
	bodyTop: number,
	bodyW: number,
	bodyMaxH: number,
	hue: number,
	z: number,
	minFont: number,
	densityCells: number,
	wLeft: number,
	wTop: number,
	wRight: number,
	wBottom: number,
): void {
	const m = latticeBodyMetrics(
		"individual",
		node.count,
		densityCells,
		node.w,
		node.headerH,
	);
	const cellSize = m.cellSize;
	const cellGap = m.cellGap;
	const fits = m.rows * m.cols;
	const drawnMax = Math.min(node.count, fits);
	const xOffset = Math.max(0, Math.floor((bodyW - m.bodyW) / 2));
	ctx.fillStyle = theme().swatch(hue, "fill", 0.90);
	for (let r = 0, drawn = 0; r < m.rows && drawn < drawnMax; r++) {
		for (let c = 0; c < m.cols && drawn < drawnMax; c++, drawn++) {
			const cx = bodyLeft + xOffset + c * (cellSize + cellGap);
			const cy = bodyTop + r * (cellSize + cellGap);
			// Viewport-cull individual cells. Cheap rejection — within a node
			// only the cells that overlap the screen matter.
			if (cx + cellSize < wLeft || cx > wRight || cy + cellSize < wTop || cy > wBottom)
				continue;
			ctx.fillRect(cx, cy, cellSize, cellSize);
		}
	}
	// "+N" chip when the body grid couldn't hold every note (residual is
	// reachable by clicking the header → note-list overlay).
	if (node.count > drawnMax) {
		const more = node.count - drawnMax;
		const chipFont = floorWorldFontPx(FOOTER_FONT_PX, minFont, z);
		const chipText = `+${more}`;
		ctx.font = `700 ${chipFont}px sans-serif`;
		const chipW = ctx.measureText(chipText).width;
		const chipPad = 4 / z;
		const chipX = bodyLeft + bodyW - chipW - chipPad * 2;
		const chipY = bodyTop + bodyMaxH - chipFont - chipPad;
		ctx.fillStyle = "rgba(0,0,0,0.65)";
		ctx.fillRect(chipX - chipPad, chipY - chipPad, chipW + chipPad * 2, chipFont + chipPad * 2);
		ctx.fillStyle = theme().warn;
		ctx.textBaseline = "top";
		ctx.textAlign = "start";
		ctx.fillText(chipText, chipX, chipY);
	}
}

// ---------------------------------------------------------------------------
// Empty-state placeholder — drawn in screen space when the lattice has zero
// surviving intersections (typically because every signature was culled by
// Min intersection size).
// ---------------------------------------------------------------------------

function drawEmptyState(
	ctx: CanvasRenderingContext2D,
	visW: number,
	visH: number,
): void {
	ctx.fillStyle = theme().textMuted;
	ctx.font = "14px sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(
		"No intersections at the current Min intersection size.",
		visW / 2,
		visH / 2,
	);
	ctx.textAlign = "start";
}

// ---------------------------------------------------------------------------
// Hit-test for an individual cell within a node — caller passes the
// world-space click and we return the cell index, or -1 (header / outside).
// ---------------------------------------------------------------------------

export function latticeCellAt(
	node: LatticeNodeMeta,
	wx: number,
	wy: number,
	minFontPx: number,
	zoom: number,
	settings: {
		latticeNodeLOD: "auto" | "overview" | "density" | "individual";
		latticeIndividualMax: number;
		latticeDensityMax: number;
		latticeDensityCells: number;
	},
): number {
	void minFontPx;
	if (wx < node.x || wx > node.x + node.w) return -1;
	if (wy < node.y || wy > node.y + node.h) return -1;
	const eff = lodFor(node.count, zoom, settings);
	if (eff !== "individual") return -1;
	const m = latticeBodyMetrics(
		"individual",
		node.count,
		settings.latticeDensityCells,
		node.w,
		node.headerH,
	);
	const bodyLeft = node.x + BODY_PAD;
	const bodyTop = node.y + node.headerH + BODY_PAD;
	const bodyW = node.w - BODY_PAD * 2;
	const xOffset = Math.max(0, Math.floor((bodyW - m.bodyW) / 2));
	const localX = wx - bodyLeft - xOffset;
	const localY = wy - bodyTop;
	if (localX < 0 || localY < 0) return -1;
	const col = Math.floor(localX / (m.cellSize + m.cellGap));
	const row = Math.floor(localY / (m.cellSize + m.cellGap));
	if (col < 0 || col >= m.cols || row < 0 || row >= m.rows) return -1;
	const idx = row * m.cols + col;
	const drawnMax = Math.min(node.count, m.rows * m.cols);
	if (idx >= drawnMax) return -1;
	return idx;
}

// ---------------------------------------------------------------------------
// LOD override: named — one file basename per row, "+N" residual.
// ---------------------------------------------------------------------------

function drawNamedList(
	ctx: CanvasRenderingContext2D,
	node: LatticeNodeMeta,
	bodyLeft: number,
	bodyTop: number,
	bodyW: number,
	bodyMaxH: number,
	hue: number,
	z: number,
	minFont: number,
	namedMax: number,
	nameOf: (id: string) => string,
): void {
	const fontPx = floorWorldFontPx(NAME_FONT_PX, minFont, z);
	ctx.font = `${fontPx}px sans-serif`;
	ctx.textBaseline = "middle";
	ctx.textAlign = "start";
	const shown = Math.min(node.count, namedMax);
	const rowH = NAMED_ROW_H;
	const maxRowsFit = Math.max(1, Math.floor(bodyMaxH / rowH));
	const drawn = Math.min(shown, maxRowsFit);
	// WORLD-unit padding (matches the layout's reservation:
	// nodeW = maxLabelW + NAMED_BODY_PAD_X*2 + BODY_PAD*2). Using /z here
	// would shrink the usable width at zoom-in and force unnecessary
	// truncation of labels the layout already sized to fit.
	const padX = NAMED_BODY_PAD_X;
	const baseFill = theme().swatch(hue, "tint", 0.5);
	const altFill = theme().swatch(hue, "tint", 0.35);
	for (let i = 0; i < drawn; i++) {
		const rowY = bodyTop + i * rowH;
		// Faint zebra stripe so rows read as discrete entries.
		ctx.fillStyle = i % 2 === 0 ? baseFill : altFill;
		ctx.fillRect(bodyLeft, rowY, bodyW, rowH);
		const id = node.nodeIds[i];
		const label = nameOf(id);
		// Layout sized the node to fit the longest label; truncateToWidth is
		// only a safety net for the rare case where vault basenames slip past
		// the measured width (e.g. font fallback).
		const maxW = bodyW - padX * 2;
		const text = ctx.measureText(label).width <= maxW
			? label
			: truncateToWidth(ctx, label, maxW);
		ctx.fillStyle = theme().textNormal;
		ctx.fillText(text, bodyLeft + padX, rowY + rowH / 2);
	}
	// "+N" residual row when more names exist than fit/are allowed.
	if (node.count > drawn && drawn < maxRowsFit) {
		const rowY = bodyTop + drawn * rowH;
		ctx.fillStyle = "rgba(0,0,0,0.55)";
		ctx.fillRect(bodyLeft, rowY, bodyW, rowH);
		ctx.fillStyle = theme().warn;
		ctx.fillText(
			`+${node.count - drawn}`,
			bodyLeft + padX,
			rowY + rowH / 2,
		);
	}
}

// Default basename extractor — used when view.ts doesn't pass `nameOf`.
// Strips any "<sourceTab>\t" prefix, takes the path tail, drops a trailing
// ".md". Pure string ops, no vault access.
function fallbackBasename(id: string): string {
	const sep = id.indexOf("\t");
	const path = sep >= 0 ? id.slice(sep + 1) : id;
	const tail = path.slice(path.lastIndexOf("/") + 1);
	return tail.endsWith(".md") ? tail.slice(0, -3) : tail;
}

// ---------------------------------------------------------------------------
// Hit tests for the new header checkbox + named row clicks.
// ---------------------------------------------------------------------------

// Returns true if the world-space (wx, wy) is inside this node's header
// checkbox click region. Geometry mirrors `drawHeader` (visual centred on
// line 1's centre, at x = node.x + padX), with a generous SLOP added so a
// near-miss at fit-to-view zoom still registers as a checkbox click — at
// zoom ≈ 0.45 the 16-world-px visual is only ~7 screen px wide, so we
// widen the hit area to the FULL leftmost header column (padX × headerH)
// plus a row of slop below the line. Falling through to the per-node
// note-list overlay only happens for clicks clearly to the right of the
// checkbox or below the header band.
export function latticeHeaderCheckboxHit(
	node: LatticeNodeMeta,
	wx: number,
	wy: number,
): boolean {
	// Hit area: the ENTIRE left gutter of the header — from the node's left
	// edge through to just before the tag rows start (cbX + cbSize +
	// HEADER_CB_GAP), and the FULL header band vertically. Generous on
	// purpose so a near-miss at fit-to-view zoom still toggles instead of
	// falling through to the per-node note-list overlay.
	const cbX0 = node.x + LAYOUT_HEADER_PAD_X;
	const cbRight = cbX0 + HEADER_CB_SIZE + HEADER_CB_GAP;
	if (wx < node.x || wx > cbRight) return false;
	if (wy < node.y || wy > node.y + node.headerH) return false;
	return true;
}

// World-space hit-test for a NAMED node's body row. Returns the row index
// (== nodeIds index) the point falls on, or -1 if outside / on header /
// past the drawn rows / on the "+N" residual row.
export function latticeNamedRowAt(
	node: LatticeNodeMeta,
	wx: number,
	wy: number,
	namedMax: number,
): number {
	if (!node.named) return -1;
	if (wx < node.x || wx > node.x + node.w) return -1;
	const bodyTop = node.y + node.headerH + BODY_PAD;
	const bodyMaxH = node.h - node.headerH - BODY_PAD * 2;
	if (wy < bodyTop || wy > bodyTop + bodyMaxH) return -1;
	const localY = wy - bodyTop;
	const rowIdx = Math.floor(localY / NAMED_ROW_H);
	const shown = Math.min(node.count, namedMax);
	if (rowIdx < 0 || rowIdx >= shown) return -1;
	return rowIdx;
}

