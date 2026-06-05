import type { LaidOut, ClusterRect } from "./layout";
import { clusterHue, roundedRectPath, truncateToWidth } from "./canvas-utils";
import {
	CARD_TITLE_FONT_PX,
	CARD_BODY_FONT_PX,
	CARD_LINE_HEIGHT_PX,
	CARD_PAD_X,
	CARD_PAD_Y,
	CARD_TITLE_BODY_GAP,
	CARD_RADIUS_PX,
} from "./types";

// Number of extra cells drawn beyond the actual content extent (cards +
// cluster bboxes). Visible breathing room on the right / bottom + an
// extra header strip on the left / top so column A / row 1 stay empty
// AND there's a "next blank cell" hint at every edge.


// Excel-style cell grid drawn across the entire VISIBLE viewport
// (= not just the content footprint). Combined with the wrap-aware
// lat/lon labels, the grid reads like a digital world map that
// continues seamlessly as the user pans — past "180°E" it shows
// "180°", "179°W", "178°W", ... rather than fading into a void.
//
// Drawn before any other body content so cards / enclosures sit on top.
export function drawCardGrid(
	ctx: CanvasRenderingContext2D,
	laid: LaidOut,
	canvas: HTMLCanvasElement,
	zoom: number,
	panX: number,
	panY: number,
): void {
	const W = laid.slotW;
	const H = laid.slotH;
	const channelW = laid.channelW;
	const channelH = laid.channelH;
	if (W <= 0 || H <= 0) return;
	const padX = channelW / 2;
	const padY = channelH / 2;

	// Visible world rect: invert the (pan, zoom) screen transform.
	// In CSS pixels: world.x = (screen_x − panX) / zoom.
	const dpr = window.devicePixelRatio || 1;
	const visW = canvas.width / dpr;
	const visH = canvas.height / dpr;
	const leftWorld = -panX / zoom;
	const rightWorld = (visW - panX) / zoom;
	const topWorld = -panY / zoom;
	const bottomWorld = (visH - panY) / zoom;

	const minCol = Math.floor(leftWorld / W) - 1;
	const maxCol = Math.ceil(rightWorld / W) + 1;
	const minRow = Math.floor(topWorld / H) - 1;
	const maxRow = Math.ceil(bottomWorld / H) + 1;

	// Safety: cap cell count per draw so an extreme zoom-out doesn't
	// trigger millions of segments.
	const maxCells = 8000;
	const cellCount = (maxCol - minCol + 1) * (maxRow - minRow + 1);
	if (cellCount > maxCells) return;

	ctx.strokeStyle = "rgba(120, 140, 160, 0.22)";
	ctx.lineWidth = 1 / zoom;
	ctx.beginPath();
	for (let r = minRow; r <= maxRow; r++) {
		const top = r * H + padY;
		const bottom = (r + 1) * H - padY;
		for (let c = minCol; c <= maxCol; c++) {
			const left = c * W + padX;
			const right = (c + 1) * W - padX;
			ctx.moveTo(left, top);
			ctx.lineTo(right, top);
			ctx.moveTo(left, bottom);
			ctx.lineTo(right, bottom);
			ctx.moveTo(left, top);
			ctx.lineTo(left, bottom);
			ctx.moveTo(right, top);
			ctx.lineTo(right, bottom);
		}
	}
	ctx.stroke();
}

// Frozen-pane row/column headers drawn in SCREEN space (identity
// transform) so they stay glued to the canvas edges regardless of
// pan/zoom — like Excel's frozen header rows / columns.
export function drawGridHeaders(
	ctx: CanvasRenderingContext2D,
	laid: LaidOut,
	canvas: HTMLCanvasElement,
	zoom: number,
	panX: number,
	panY: number,
	minFontPx: number = 0,
): void {
	const W = laid.slotW;
	const H = laid.slotH;
	if (W <= 0 || H <= 0) return;

	const dpr = window.devicePixelRatio || 1;
	const visW = canvas.width / dpr;
	const visH = canvas.height / dpr;
	const cellScreenW = W * zoom;
	const cellScreenH = H * zoom;
	// Header labels span the ENTIRE viewport (= the grid below them is
	// continuous like a world map, so the labels must follow). Range
	// derived from inverse pan/zoom — same math as drawCardGrid.
	const leftWorld = -panX / zoom;
	const rightWorld = (visW - panX) / zoom;
	const topWorld = -panY / zoom;
	const bottomWorld = (visH - panY) / zoom;
	const minCol = Math.floor(leftWorld / W) - 1;
	const maxCol = Math.ceil(rightWorld / W) + 1;
	const minRow = Math.floor(topWorld / H) - 1;
	const maxRow = Math.ceil(bottomWorld / H) + 1;
	const headerH = Math.max(22, Math.min(36, cellScreenH * 0.9));
	const headerW = Math.max(32, Math.min(56, cellScreenW * 0.7));
	// Safety cap: at extreme zoom-out the visible cell count explodes.
	// Skip per-cell tick rendering when it would generate too many
	// segments; the corner / band overlays still draw below.
	const headerCellCount = (maxCol - minCol) + (maxRow - minRow);
	const skipTicks = headerCellCount > 4000;

	ctx.fillStyle = "rgba(58, 78, 108, 0.98)";
	ctx.fillRect(0, 0, visW, headerH);
	ctx.fillRect(0, 0, headerW, visH);

	if (!skipTicks) {
		ctx.strokeStyle = "rgba(120, 140, 160, 0.45)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let c = minCol; c <= maxCol + 1; c++) {
			const x = c * W * zoom + panX;
			if (x < headerW - 0.5 || x > visW + 0.5) continue;
			ctx.moveTo(x, 0);
			ctx.lineTo(x, headerH);
		}
		for (let r = minRow; r <= maxRow + 1; r++) {
			const y = r * H * zoom + panY;
			if (y < headerH - 0.5 || y > visH + 0.5) continue;
			ctx.moveTo(0, y);
			ctx.lineTo(headerW, y);
		}
		ctx.stroke();
	}

	ctx.strokeStyle = "rgba(180, 200, 230, 0.9)";
	ctx.lineWidth = 1.6;
	ctx.beginPath();
	ctx.moveTo(0, headerH);
	ctx.lineTo(visW, headerH);
	ctx.moveTo(headerW, 0);
	ctx.lineTo(headerW, visH);
	ctx.stroke();

	// Labels with stride so they don't overlap at low zoom.
	// Stride bumped a bit because lat/lon labels are wider than the old
	// "A" / "1" forms.
	const colStride = Math.max(1, Math.ceil(36 / Math.max(1, cellScreenW)));
	const rowStride = Math.max(1, Math.ceil(28 / Math.max(1, cellScreenH)));
	const fontPx = Math.max(
		minFontPx,
		Math.min(headerH * 0.62, headerW * 0.4, 14),
	);
	ctx.font = `700 ${fontPx}px sans-serif`;
	ctx.fillStyle = "rgba(245, 250, 255, 1)";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	if (!skipTicks) {
		for (let c = minCol; c <= maxCol; c += colStride) {
			const xC = c * W * zoom + panX + cellScreenW / 2;
			if (xC < headerW || xC > visW) continue;
			ctx.fillText(longitudeLabel(c), xC, headerH / 2);
		}
		for (let r = minRow; r <= maxRow; r += rowStride) {
			const yC = r * H * zoom + panY + cellScreenH / 2;
			if (yC < headerH || yC > visH) continue;
			ctx.fillText(latitudeLabel(r), headerW / 2, yC);
		}
	}
	ctx.textAlign = "start";
	ctx.textBaseline = "alphabetic";

	// Corner block — slightly darker to anchor the header origin.
	ctx.fillStyle = "rgba(40, 55, 80, 1)";
	ctx.fillRect(0, 0, headerW, headerH);
	ctx.strokeStyle = "rgba(180, 200, 230, 0.9)";
	ctx.lineWidth = 1.6;
	ctx.beginPath();
	ctx.moveTo(0, headerH);
	ctx.lineTo(headerW, headerH);
	ctx.moveTo(headerW, 0);
	ctx.lineTo(headerW, headerH);
	ctx.stroke();
}

// Map a column index to a longitude label, wrapped to (−180°, 180°].
// The cell at col 0 (= the column containing world x = 0) is the prime
// meridian ("0°"). Cells east of it get "${n}°E", west cells get
// "${n}°W". The label wraps modulo 360 so col 200 → "160°W" (=
// equivalent meridian on the other side of the date line), reflecting
// the "両端が構造上で繋がる" (toroidal longitude) topology — even
// though rendering stays on a flat plane.
function longitudeLabel(col: number): string {
	const n = wrapTo(col, 360, -180);
	if (n === 0) return "0°";
	if (n === 180 || n === -180) return "180°";
	return `${Math.abs(n)}°${n > 0 ? "E" : "W"}`;
}

// Map a row index to a latitude label, wrapped to (−90°, 90°]. Rows
// count DOWN in screen coords, so row r > 0 (= below origin) = south.
// Row 0 (= the row containing world y = 0) is the equator ("0°"). The
// label wraps modulo 180 so row 100 → "80°N" (= equivalent latitude
// on the antipodal side, as if you continued past the south pole and
// came up the other side of the globe).
function latitudeLabel(row: number): string {
	const n = wrapTo(row, 180, -90);
	if (n === 0) return "0°";
	if (n === 90 || n === -90) return "90°";
	return `${Math.abs(n)}°${n > 0 ? "S" : "N"}`;
}

// Wrap an integer cell index into the half-open interval
// [min, min + period). Used so column/row indices map back into the
// canonical latitude/longitude range regardless of how far the grid
// extends. JS `%` returns negative remainders for negative dividends;
// the double-mod idiom normalises that.
function wrapTo(v: number, period: number, min: number): number {
	const max = min + period;
	const m = (((v - min) % period) + period) % period;
	const out = m + min;
	// Snap the +max boundary back to min so e.g. col 180 → 180 (not −180);
	// but col 540 (= 3 × 180 wraps) lands on -180 / +180 depending on phase.
	// For our labels we want either "180°" or "0°" at the antimeridian
	// rather than a flipped sign, so leave the value as-is here and let
	// the caller render it.
	if (out === max) return min;
	return out;
}

// Shared footprint extent: cell range encompassing every node's full
// (multi-cell) footprint AND every cluster bbox. Used by both the grid +
// header drawers.
//
// Cluster bboxes are included because their padding (= clusterSpacing
// + nesting depth) can extend the visible outline 1–3 cells beyond the
// rightmost / bottom-most card. Without that, a cluster border would
// stroke OUTSIDE the lattice — visually "outside the grid".
function footprintExtent(
	laid: LaidOut,
	W: number,
	H: number,
): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
	let minCol = Infinity,
		maxCol = -Infinity,
		minRow = Infinity,
		maxRow = -Infinity;
	for (const n of laid.nodes) {
		const colSpan = Math.max(1, Math.ceil(n.width / W));
		const rowSpan = Math.max(1, Math.ceil(n.height / H));
		const startCol = Math.round(n.x / W - colSpan / 2);
		const startRow = Math.round(n.y / H - rowSpan / 2);
		const endCol = startCol + colSpan - 1;
		const endRow = startRow + rowSpan - 1;
		if (startCol < minCol) minCol = startCol;
		if (endCol > maxCol) maxCol = endCol;
		if (startRow < minRow) minRow = startRow;
		if (endRow > maxRow) maxRow = endRow;
	}
	// Cluster bboxes — their padding can extend beyond the card footprint.
	// Floor / ceil convert the pixel rect back into the cell range it
	// overlaps. (`c.x + c.width` is the bbox right edge; subtract 1 to
	// get the LAST cell it intersects, since cell c spans [c*W, (c+1)*W).)
	for (const c of laid.clusters) {
		const cStartCol = Math.floor(c.x / W);
		const cEndCol = Math.ceil((c.x + c.width) / W) - 1;
		const cStartRow = Math.floor(c.y / H);
		const cEndRow = Math.ceil((c.y + c.height) / H) - 1;
		if (cStartCol < minCol) minCol = cStartCol;
		if (cEndCol > maxCol) maxCol = cEndCol;
		if (cStartRow < minRow) minRow = cStartRow;
		if (cEndRow > maxRow) maxRow = cEndRow;
	}
	return { minCol, maxCol, minRow, maxRow };
}

// Map-style top-left cluster labels with collision avoidance.
// Smaller clusters yield to larger ones (= the larger label keeps its
// natural anchor position). A leader line links a label back to its
// anchor when displacement pushes it more than one line up.
// A placed label's final world-space box (after merge + de-confliction).
// Returned so the caller can debug overlaps against nodes / each other.
export interface PlacedLabelBox {
	key: string;
	x1: number;
	x2: number;
	top: number;
	bot: number;
	text: string;
	anchorX: number;
	anchorY: number;
}

// Overview-only auxiliary labels: one BIG cluster name centred in each
// enclosure, fitted to the enclosure box. Drawn in world space on top of
// everything when the whole diagram is in view, independent of the
// Graph-display toggles and SEPARATE from `drawClusterLabels` (the small
// on-grid title bars). Not used in UpSet mode. Largest clusters paint first
// so smaller (often nested) names land on top.
export function drawOverviewLabels(
	ctx: CanvasRenderingContext2D,
	laid: LaidOut,
	zoom: number,
): void {
	const cl = [...laid.clusters]
		.filter(
			(c) =>
				!c.ghostSingle && c.memberCount >= 2 && c.width > 0 && c.height > 0,
		)
		.sort((a, b) => b.width * b.height - a.width * a.height);
	// Greedy, largest-first. Each label tries: centred full size, then
	// progressively smaller, then nudged up / down — taking the first spot
	// that doesn't collide with an already-placed label. Labels that can't
	// find a clear spot are skipped (a bigger name already covers that area).
	const cand: Array<[number, number]> = [
		[0.5, 1.0],
		[0.5, 0.72],
		[0.5, 0.52],
		[0.3, 0.52],
		[0.7, 0.52],
		[0.5, 0.38],
		[0.3, 0.38],
		[0.7, 0.38],
	];
	const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
	for (const c of cl) {
		const text = c.label;
		if (!text) continue;
		const cx = c.x + c.width / 2;
		ctx.font = "800 100px sans-serif";
		const m = ctx.measureText(text);
		const w100 = m.width || 1;
		const h100 =
			(m.actualBoundingBoxAscent || 74) + (m.actualBoundingBoxDescent || 20);
		const baseFont = Math.min(
			(c.width * 0.88 * 100) / w100,
			(c.height * 0.6 * 100) / h100,
		);
		if (!(baseFont > 0)) continue;
		let chosen: { font: number; cy: number } | null = null;
		for (const [af, sc] of cand) {
			const font = baseFont * sc;
			const tw = (w100 / 100) * font;
			const th = font;
			const cy = c.y + c.height * af;
			const pad = font * 0.12;
			const box = {
				x1: cx - tw / 2 - pad,
				y1: cy - th / 2 - pad,
				x2: cx + tw / 2 + pad,
				y2: cy + th / 2 + pad,
			};
			let hit = false;
			for (const p of placed) {
				if (box.x1 < p.x2 && box.x2 > p.x1 && box.y1 < p.y2 && box.y2 > p.y1) {
					hit = true;
					break;
				}
			}
			if (!hit) {
				chosen = { font, cy };
				placed.push(box);
				break;
			}
		}
		if (!chosen) continue; // no clear spot — skip to avoid overlap
		ctx.font = `800 ${chosen.font}px sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		const hue = clusterHue(c.groupKey);
		ctx.lineJoin = "round";
		ctx.lineWidth = Math.max(chosen.font * 0.08, 2 / zoom);
		ctx.strokeStyle = "rgba(8, 10, 14, 0.9)";
		ctx.strokeText(text, cx, chosen.cy);
		ctx.fillStyle = `hsla(${hue}, 75%, 82%, 0.96)`;
		ctx.fillText(text, cx, chosen.cy);
	}
	ctx.textAlign = "start";
	ctx.textBaseline = "alphabetic";
}

export function drawClusterLabels(
	ctx: CanvasRenderingContext2D,
	laid: LaidOut,
	zoom: number,
	minFontPx: number = 0,
): PlacedLabelBox[] {
	// Labels live in the grid cells the LAYOUT reserved for them
	// (`laid.labelCells` — one empty cell per cluster, kept clear of nodes
	// and inside the cluster's enclosure). We just draw each cluster's name
	// in its reserved cell: it is already on a grid cell, clear of nodes and
	// of every other label's cell, so no search / de-confliction is needed.
	const cells = laid.labelCells ?? [];
	if (cells.length === 0) return [];
	const byKey = new Map<string, ClusterRect>();
	for (const c of laid.clusters) byKey.set(c.groupKey, c);

	const screenPx = Math.max(12, minFontPx);
	const labelBg = "rgba(13, 15, 20, 0.9)";
	const boxes: PlacedLabelBox[] = [];
	for (const cell of cells) {
		const c = byKey.get(cell.key);
		// `cell.text` overrides (intersection sub-box labels "a*b*c"); otherwise
		// fall back to the owning cluster's "name (count)". A cell with neither
		// is skipped.
		const text = cell.text ?? (c ? `${c.label} (${c.memberCount})` : "");
		if (!text) continue;
		// Clamp the label to the cluster's FINAL bbox (it may have been
		// post-processed after layout, e.g. inheritance expansion). Shrink
		// to fit + clamp centre so the label is never drawn outside its own
		// enclosure — for normal clusters the bbox is larger than the label,
		// so this is a no-op; only stranded labels of territory-less
		// clusters get pulled back in.
		let cw = cell.w;
		let ch = cell.h;
		let cx = cell.x;
		let cy = cell.y;
		if (c && c.width > 0 && c.height > 0) {
			cw = Math.min(cw, c.width);
			ch = Math.min(ch, c.height);
			cx = Math.min(Math.max(cx, c.x + cw / 2), c.x + c.width - cw / 2);
			cy = Math.min(Math.max(cy, c.y + ch / 2), c.y + c.height - ch / 2);
		}
		// Size the font to FILL the reserved ~4×4 cell box: take the largest
		// font that fits both the box width and height. A readability floor
		// (capped by the box height) keeps it legible when zoomed far out.
		const padX = 4 / zoom;
		const maxByH = ch * 0.7;
		ctx.font = "100px sans-serif";
		const w100 = ctx.measureText(text).width || 1;
		const maxByW = ((cw - 2 * padX) * 100) / w100;
		let fontPx = Math.min(maxByH, maxByW);
		fontPx = Math.max(fontPx, Math.min(maxByH, screenPx / zoom));
		ctx.font = `700 ${fontPx}px sans-serif`;
		ctx.textAlign = "start";
		ctx.textBaseline = "middle";
		const fitted = truncateToWidth(ctx, text, cw - 2 * padX);
		const x1 = cx - cw / 2;
		const x2 = cx + cw / 2;
		const top = cy - ch / 2;
		const bot = cy + ch / 2;
		// Opaque tab inside the cell so the label reads cleanly over the grid.
		ctx.fillStyle = labelBg;
		ctx.fillRect(x1, cy - fontPx * 0.62, cw, fontPx * 1.24);
		// Centred coloured label.
		ctx.fillStyle = `hsla(${clusterHue(cell.key)}, 65%, 74%, 1)`;
		ctx.textAlign = "center";
		ctx.fillText(fitted, cx, cy);
		boxes.push({ key: cell.key, x1, x2, top, bot, text, anchorX: cx, anchorY: cy });
	}
	ctx.textAlign = "start";
	ctx.textBaseline = "alphabetic";
	return boxes;
}

// 3-card diagonal stack confined to a SINGLE cell with a small inset
// so the stack never touches the cell boundary, the cluster enclosure,
// or neighbouring cards' strokes.
export function drawAggregateStack(
	ctx: CanvasRenderingContext2D,
	cluster: ClusterRect,
	cardW: number,
	cardH: number,
	count: number,
	zoom: number,
	highlighted = false,
	minFontPx: number = 0,
): void {
	const cx = cluster.x + cluster.width / 2;
	const cy = cluster.y + cluster.height / 2;
	const STACK_INSET = 0.07;
	const SUB_SCALE = 0.78;
	const innerW = cardW * (1 - 2 * STACK_INSET);
	const innerH = cardH * (1 - 2 * STACK_INSET);
	const subW = innerW * SUB_SCALE;
	const subH = innerH * SUB_SCALE;
	const stepX = (innerW - subW) / 2;
	const stepY = (innerH - subH) / 2;
	const r = Math.min(CARD_RADIUS_PX, subW / 2, subH / 2);
	for (let i = 0; i <= 2; i++) {
		const isFront = i === 2;
		const centerX = cx + (1 - i) * stepX;
		const centerY = cy + (1 - i) * stepY;
		const x = centerX - subW / 2;
		const y = centerY - subH / 2;
		ctx.beginPath();
		roundedRectPath(ctx, x, y, subW, subH, r);
		ctx.fillStyle = highlighted
			? isFront
				? "#ffe7a8"
				: "#f0d188"
			: isFront
				? "#1d2230"
				: "#1a1f2a";
		ctx.fill();
		ctx.lineWidth = (isFront ? (highlighted ? 1.8 : 1.2) : 0.8) / zoom;
		ctx.strokeStyle = highlighted
			? isFront
				? "#ff9d3f"
				: "#c97e2c"
			: isFront
				? "#5a7ba8"
				: "#3e567a";
		ctx.beginPath();
		roundedRectPath(ctx, x, y, subW, subH, r);
		ctx.stroke();
		if (isFront) {
			ctx.textAlign = "start";
			ctx.textBaseline = "top";
			const titleFontPx = Math.max(CARD_TITLE_FONT_PX, minFontPx / Math.max(0.01, zoom));
			const bodyFontPx = Math.max(CARD_BODY_FONT_PX, minFontPx / Math.max(0.01, zoom));
			ctx.font = `600 ${titleFontPx}px sans-serif`;
			ctx.fillStyle = highlighted ? "#1d1100" : "#e6edf3";
			const title = truncateToWidth(
				ctx,
				cluster.label,
				subW - 2 * CARD_PAD_X,
			);
			ctx.fillText(title, x + CARD_PAD_X, y + CARD_PAD_Y);
			ctx.font = `${bodyFontPx}px sans-serif`;
			ctx.fillStyle = highlighted ? "#3a2400" : "#9eb0c4";
			ctx.fillText(
				`${count} cards`,
				x + CARD_PAD_X,
				y + CARD_PAD_Y + CARD_LINE_HEIGHT_PX + CARD_TITLE_BODY_GAP,
			);
		}
	}
}
