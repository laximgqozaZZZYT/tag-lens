// UpSet renderer — cards on top (world space, full canvas width),
// matrix + row labels in a SCREEN-fixed footer at the BOTTOM.
//
// Layout (per 2026-05-26 latest spec):
//   - Cards: world coords, occupy the full canvas width above the
//     footer. No left band — every horizontal pixel is for cards.
//   - Footer: screen-fixed band at the bottom of the canvas.
//     - Inside the footer, the LEFT sub-band shows set names + size
//       bars; the RIGHT sub-band shows the dot matrix.
//     - Matrix column screen X = `xWorld * zoom + panX` so a column
//       stays directly under the matching card stack as the user
//       pans / zooms.
//
// Row filter (unchanged): only sets whose member cards are currently
// visible in the canvas keep a row. Falls back to full set list when
// nothing is visible.
import type { LaidOut } from "./layout";
import { clusterHue } from "./canvas-utils";

const FONT_PX = 12;
const SMALL_FONT_PX = 10;
const ROW_H = 22;
const COUNT_ROW_H = 20; // top sub-band of the footer for column counts
const DOT_R_MIN = 3;
const DOT_R_MAX = 9;
const COUNT_FONT_MIN = 9;
const COUNT_FONT_MAX = 16;
const SET_LABEL_BAND_PX = 100;
const SIZE_BAR_BAND_PX = 56;
export const LEFT_BAND_PX = SET_LABEL_BAND_PX + SIZE_BAR_BAND_PX + 16; // = 172
const HIGHLIGHT = "rgba(255, 157, 63, 0.9)";
const ROW_LABEL_PAD = 6;

// Footer height calculation — clamped between a sane min (so labels
// + 4 rows always fit) and `canvasH / 3` (the user wants cards to
// "dominate", so the footer never exceeds 1/3 of the canvas).
export function upsetFooterHeight(canvasH: number, activeRowCount: number): number {
	const padTop = 8;
	const padBottom = 8;
	const need = padTop + COUNT_ROW_H + activeRowCount * ROW_H + padBottom;
	const cap = Math.floor(canvasH / 3);
	const min = 120;
	return Math.max(min, Math.min(cap, need));
}

export interface UpsetWorldLayout {
	activeSets: Array<{ key: string; label: string; size: number }>;
}

// Determine which sets are "active" — i.e. have at least one member
// card currently inside the canvas viewport (X AND Y).
export function computeUpsetActiveSets(
	laid: LaidOut,
	canvasW: number,
	canvasH: number,
	footerTopY: number,
	zoom: number,
	panX: number,
	panY: number,
): UpsetWorldLayout | null {
	const u = laid.upset;
	if (!u) return null;
	const activeKeys = new Set<string>();
	let anyVisible = false;
	for (const n of laid.nodes) {
		const sx = n.x * zoom + panX;
		const sy = n.y * zoom + panY;
		const hx = n.width * 0.5 * zoom;
		const hy = n.height * 0.5 * zoom;
		// Cards live ABOVE the footer; we only count them as visible
		// when they fit inside [0, canvasW] × [0, footerTopY].
		const inX = sx + hx >= 0 && sx - hx <= canvasW;
		const inY = sy + hy >= 0 && sy - hy <= footerTopY;
		if (!inX || !inY) continue;
		anyVisible = true;
		for (const m of n.memberships) activeKeys.add(m);
	}
	const activeSets = anyVisible
		? u.sets.filter((s) => activeKeys.has(s.key))
		: u.sets.slice();
	return { activeSets };
}

export function drawUpsetFooter(
	ctx: CanvasRenderingContext2D,
	laid: LaidOut,
	canvasW: number,
	canvasH: number,
	dpr: number,
	zoom: number,
	panX: number,
	panY: number,
	selectedSignatureKey: string | null,
	minFontPx: number = 0,
): void {
	const u = laid.upset;
	if (!u) return;
	// First pass uses an estimated footer height to compute active
	// sets — the band size depends on the active count, which depends
	// on footerTopY. Use full set count for the initial estimate, then
	// recompute once we know the real active count.
	const estFooter = upsetFooterHeight(canvasH, u.sets.length);
	const estFooterTopY = canvasH - estFooter;
	const L0 = computeUpsetActiveSets(
		laid,
		canvasW,
		canvasH,
		estFooterTopY,
		zoom,
		panX,
		panY,
	);
	if (!L0) return;
	const footerH = upsetFooterHeight(canvasH, L0.activeSets.length);
	const footerTopY = canvasH - footerH;
	const L = computeUpsetActiveSets(
		laid,
		canvasW,
		canvasH,
		footerTopY,
		zoom,
		panX,
		panY,
	);
	if (!L) return;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	// Opaque footer background.
	ctx.fillStyle = "#0f1116";
	ctx.fillRect(0, footerTopY, canvasW, footerH);
	ctx.strokeStyle = "rgba(120, 130, 150, 0.35)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(0, footerTopY + 0.5);
	ctx.lineTo(canvasW, footerTopY + 0.5);
	ctx.stroke();
	// Vertical separator between left band and matrix area.
	ctx.beginPath();
	ctx.moveTo(LEFT_BAND_PX + 0.5, footerTopY);
	ctx.lineTo(LEFT_BAND_PX + 0.5, canvasH);
	ctx.stroke();
	const padTop = 8;
	const countRowY = footerTopY + padTop + COUNT_ROW_H * 0.5;
	const rowsTop = footerTopY + padTop + COUNT_ROW_H;
	const setRows = L.activeSets.map((s, idx) => ({
		key: s.key,
		label: s.label,
		size: s.size,
		y: rowsTop + (idx + 0.5) * ROW_H,
	}));
	// Row tracks (start below the count row).
	ctx.fillStyle = "rgba(120, 130, 150, 0.06)";
	for (const set of setRows) {
		ctx.fillRect(0, set.y - ROW_H * 0.45, canvasW, ROW_H * 0.9);
	}
	// Largest column count for normalising dot radius / count font.
	const maxColSize = Math.max(1, ...u.columns.map((c) => c.size));
	drawSetLabelsAndBars(ctx, setRows, u, minFontPx);
	drawColumnCounts(
		ctx,
		u,
		zoom,
		panX,
		canvasW,
		countRowY,
		maxColSize,
		minFontPx,
	);
	drawMatrixDots(
		ctx,
		setRows,
		u,
		zoom,
		panX,
		canvasW,
		selectedSignatureKey,
		maxColSize,
	);
}

// Per-column count numerals in the top sub-band of the footer,
// directly above the matrix. Font size grows with the count (sqrt
// scale) so the visual weight of each numeral reflects how many
// cards that intersection holds.
function drawColumnCounts(
	ctx: CanvasRenderingContext2D,
	u: LaidOut["upset"],
	zoom: number,
	panX: number,
	canvasW: number,
	y: number,
	maxColSize: number,
	minFontPx: number,
): void {
	if (!u) return;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	for (const col of u.columns) {
		const x = col.xWorld * zoom + panX;
		if (x < LEFT_BAND_PX || x > canvasW) continue;
		const fontPx = Math.max(
			minFontPx,
			sqrtScale(col.size, maxColSize, COUNT_FONT_MIN, COUNT_FONT_MAX),
		);
		ctx.font = `${fontPx}px sans-serif`;
		ctx.fillStyle = "rgba(220, 225, 235, 0.92)";
		ctx.fillText(String(col.size), x, y);
	}
}

function sqrtScale(
	value: number,
	maxValue: number,
	minOut: number,
	maxOut: number,
): number {
	if (maxValue <= 0) return minOut;
	const t = Math.sqrt(Math.max(0, value) / maxValue);
	return minOut + (maxOut - minOut) * t;
}

function drawSetLabelsAndBars(
	ctx: CanvasRenderingContext2D,
	setRows: Array<{ key: string; label: string; size: number; y: number }>,
	u: LaidOut["upset"],
	minFontPx: number,
): void {
	if (!u || setRows.length === 0) return;
	const maxSize = Math.max(1, ...u.sets.map((s) => s.size));
	const barH = ROW_H * 0.5;
	const sizeBarRightX = LEFT_BAND_PX - 8;
	const labelRightX = SET_LABEL_BAND_PX;
	const labelFontPx = Math.max(FONT_PX, minFontPx);
	const smallFontPx = Math.max(SMALL_FONT_PX, minFontPx);
	for (const set of setRows) {
		// Set name (right-aligned in its sub-band).
		ctx.font = `${labelFontPx}px sans-serif`;
		ctx.textAlign = "end";
		ctx.textBaseline = "middle";
		ctx.fillStyle = `hsla(${clusterHue(set.key)}, 65%, 80%, 1)`;
		ctx.fillText(
			ellipsise(ctx, set.label, SET_LABEL_BAND_PX - ROW_LABEL_PAD),
			labelRightX - ROW_LABEL_PAD,
			set.y,
		);
		// Size bar.
		const w = (set.size / maxSize) * (SIZE_BAR_BAND_PX - 8);
		const x = sizeBarRightX - w;
		ctx.fillStyle = `hsla(${clusterHue(set.key)}, 65%, 55%, 0.65)`;
		ctx.fillRect(x, set.y - barH / 2, w, barH);
		ctx.font = `${smallFontPx}px sans-serif`;
		ctx.fillStyle = "rgba(220, 225, 235, 0.85)";
		ctx.fillText(String(set.size), x - 2, set.y);
	}
}

function drawMatrixDots(
	ctx: CanvasRenderingContext2D,
	setRows: Array<{ key: string; label: string; size: number; y: number }>,
	u: LaidOut["upset"],
	zoom: number,
	panX: number,
	canvasW: number,
	selectedSignatureKey: string | null,
	maxColSize: number,
): void {
	if (!u) return;
	const setIdx = new Map<string, number>();
	setRows.forEach((s, i) => setIdx.set(s.key, i));
	for (let i = 0; i < u.columns.length; i++) {
		const col = u.columns[i];
		const x = col.xWorld * zoom + panX;
		// Skip columns whose screen X is outside the matrix area or
		// behind the left band.
		if (x < LEFT_BAND_PX || x > canvasW) continue;
		// Dot radius scales with count (sqrt to keep mega-columns
		// from dwarfing everything; min radius keeps small ones
		// clickable).
		const dotR = sqrtScale(col.size, maxColSize, DOT_R_MIN, DOT_R_MAX);
		const inCol = new Set(col.signature);
		const key = col.signature.join("|");
		const highlighted = key === selectedSignatureKey;
		let topY = Infinity;
		let botY = -Infinity;
		for (const k of col.signature) {
			const ridx = setIdx.get(k);
			if (ridx == null) continue;
			const y = setRows[ridx].y;
			if (y < topY) topY = y;
			if (y > botY) botY = y;
		}
		if (isFinite(topY) && botY > topY) {
			ctx.strokeStyle = highlighted
				? HIGHLIGHT
				: "rgba(180, 195, 220, 0.85)";
			ctx.lineWidth = highlighted ? 2.4 : 1.8;
			ctx.beginPath();
			ctx.moveTo(x, topY);
			ctx.lineTo(x, botY);
			ctx.stroke();
		}
		for (const set of setRows) {
			if (inCol.has(set.key)) {
				ctx.fillStyle = highlighted
					? HIGHLIGHT
					: `hsla(${clusterHue(set.key)}, 65%, 65%, 1)`;
				ctx.beginPath();
				ctx.arc(x, set.y, dotR, 0, Math.PI * 2);
				ctx.fill();
			} else {
				ctx.fillStyle = "rgba(70, 80, 95, 0.55)";
				ctx.beginPath();
				ctx.arc(x, set.y, Math.max(1.5, dotR * 0.45), 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}
}

function ellipsise(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxW: number,
): string {
	if (ctx.measureText(text).width <= maxW) return text;
	const ell = "…";
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		const s = text.slice(0, mid) + ell;
		if (ctx.measureText(s).width <= maxW) lo = mid;
		else hi = mid - 1;
	}
	return text.slice(0, lo) + ell;
}
