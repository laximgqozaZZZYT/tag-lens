import { drosteForward, type DrosteParams } from "./conformal";
import { drosteUV, type DrosteMeta, type DrosteShape, type DrosteBBox } from "./droste-layout";
import { clusterHue, truncateToWidth } from "./canvas-utils";

export interface DrawDrosteOpts {
	zoom: number;
	panX: number;
	panY: number;
	canvas: HTMLCanvasElement;
	dpr: number;
	k: number;
	twistDir: "ccw" | "cw";
	copies: number;
	subdiv: number;
	minFontPx: number;
	hoverId: string | null;
	focusId: string;
	gridV?: number; // red-grid vertical line count (default 16)
	gridH?: number; // red-grid horizontal line count (default 8)
}

// TEMPORARY: when true, skip the conformal warp / red grid / self-similar nesting
// and draw the source plane (reordered BubbleSets shapes) in plain orthogonal
// coordinates (linear x,y → screen). Flip back to false to re-enable exp(γζ).
const DROSTE_ORTHO = true;

type Pt = { x: number; y: number };

// Plain orthogonal render of the source plane: fit the bbox to the canvas and draw
// each shape rect (card filled / frame stroked) + label, no warp/grid/nesting.
function drawOrtho(ctx: CanvasRenderingContext2D, meta: DrosteMeta, o: DrawDrosteOpts): void {
	const b = meta.bbox;
	const W = b.maxX - b.minX || 1;
	const H = b.maxY - b.minY || 1;
	const cw = o.canvas.width, ch = o.canvas.height, pad = 0.06;
	const s = Math.min((cw * (1 - pad)) / W, (ch * (1 - pad)) / H);
	const ox = (cw - W * s) / 2, oy = (ch - H * s) / 2;
	const X = (x: number) => ox + (x - b.minX) * s;
	const Y = (y: number) => oy + (y - b.minY) * s;
	for (const e of meta.shapes) {
		const hue = clusterHue(e.hueKey);
		const x = X(e.x0), y = Y(e.y0), w = (e.x1 - e.x0) * s, h = (e.y1 - e.y0) * s;
		if (e.kind === "card") {
			ctx.fillStyle = `hsla(${hue}, 60%, 55%, 0.32)`;
			ctx.fillRect(x, y, w, h);
			ctx.lineWidth = (e.id === o.hoverId ? 2.4 : 1.2) * o.dpr;
			ctx.strokeStyle = `hsla(${hue}, 70%, 72%, 0.9)`;
			ctx.strokeRect(x, y, w, h);
		} else {
			ctx.fillStyle = `hsla(${hue}, 55%, 50%, 0.12)`;
			ctx.fillRect(x, y, w, h);
			ctx.lineWidth = (e.id === o.hoverId ? 3 : 2) * o.dpr;
			ctx.strokeStyle = `hsla(${hue}, 65%, 65%, 0.85)`;
			ctx.strokeRect(x, y, w, h);
		}
		ctx.fillStyle = "#e6ecf5";
		ctx.font = `${Math.min(h * 0.32, 13 * o.dpr)}px sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(truncateToWidth(ctx, e.label, w * 0.92), x + w / 2, y + h / 2);
		if (e.id === o.focusId) {
			ctx.beginPath();
			ctx.arc(x + w / 2, y + h / 2, Math.max(3 * o.dpr, Math.min(w, h) * 0.18), 0, 2 * Math.PI);
			ctx.fillStyle = "#ffd35c";
			ctx.fill();
			ctx.lineWidth = 1.5 * o.dpr;
			ctx.strokeStyle = "#1a1c22";
			ctx.stroke();
		}
	}
}

// source(x,y) → strip ζ (drosteUV) → plane z=R₀·exp(γ(ζ + i·2π·m)) → device px.
function project(b: DrosteBBox, x: number, y: number, m: number, p: DrosteParams, o: DrawDrosteOpts): Pt {
	const { u, v } = drosteUV(b, x, y);
	const z = drosteForward(u, v + 2 * Math.PI * m, p);
	const cx = o.canvas.width / 2;
	const cy = o.canvas.height / 2;
	return { x: cx + (z.re * o.zoom + o.panX) * o.dpr, y: cy + (z.im * o.zoom + o.panY) * o.dpr };
}

// Map a straight source segment to a subdivided warped polyline (append to path).
function seg(ctx: CanvasRenderingContext2D, b: DrosteBBox, a: Pt, c: Pt, m: number, p: DrosteParams, o: DrawDrosteOpts, first: boolean): void {
	const n = Math.max(1, o.subdiv);
	for (let i = first ? 0 : 1; i <= n; i++) {
		const t = i / n;
		const d = project(b, a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t, m, p, o);
		if (i === 0) ctx.moveTo(d.x, d.y);
		else ctx.lineTo(d.x, d.y);
	}
}

function shapePath(ctx: CanvasRenderingContext2D, b: DrosteBBox, e: DrosteShape, m: number, p: DrosteParams, o: DrawDrosteOpts): void {
	const tl = { x: e.x0, y: e.y0 }, tr = { x: e.x1, y: e.y0 }, br = { x: e.x1, y: e.y1 }, bl = { x: e.x0, y: e.y1 };
	ctx.beginPath();
	seg(ctx, b, tl, tr, m, p, o, true);
	seg(ctx, b, tr, br, m, p, o, false);
	seg(ctx, b, br, bl, m, p, o, false);
	seg(ctx, b, bl, tl, m, p, o, false);
	ctx.closePath();
}

function drawShape(ctx: CanvasRenderingContext2D, b: DrosteBBox, e: DrosteShape, m: number, p: DrosteParams, o: DrawDrosteOpts): void {
	const hue = clusterHue(e.hueKey);
	shapePath(ctx, b, e, m, p, o);
	if (e.kind === "card") {
		ctx.fillStyle = `hsla(${hue}, 60%, 55%, 0.32)`;
		ctx.fill();
		ctx.lineWidth = (e.id === o.hoverId ? 2.4 : 1.2) * o.dpr;
		ctx.strokeStyle = `hsla(${hue}, 70%, 72%, 0.9)`;
		ctx.stroke();
	} else {
		// Group enclosure frame (BubbleSets style): faint fill + bold contour.
		ctx.fillStyle = `hsla(${hue}, 55%, 50%, 0.12)`;
		ctx.fill();
		ctx.lineWidth = (e.id === o.hoverId ? 3 : 2) * o.dpr;
		ctx.strokeStyle = `hsla(${hue}, 65%, 65%, 0.85)`;
		ctx.stroke();
	}
	// Upright label at the warped centroid, clamped to the cell's angular width.
	const c = project(b, (e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2, m, p, o);
	const a0 = project(b, (e.x0 + e.x1) / 2, e.y0, m, p, o);
	const a1 = project(b, (e.x0 + e.x1) / 2, e.y1, m, p, o);
	const w0 = project(b, e.x0, (e.y0 + e.y1) / 2, m, p, o);
	const cellW = Math.hypot(a1.x - a0.x, a1.y - a0.y);
	const localPx = Math.hypot(c.x - w0.x, c.y - w0.y);
	if (localPx >= o.minFontPx * o.dpr && cellW >= o.minFontPx * o.dpr) {
		ctx.fillStyle = "#e6ecf5";
		ctx.font = `${Math.min(localPx * 0.5, 16 * o.dpr)}px sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(truncateToWidth(ctx, e.label, cellW * 0.9), c.x, c.y);
	}
	// Focus N marker on its innermost (m=0) card.
	if (e.id === o.focusId && m === 0) {
		const r = Math.max(3 * o.dpr, Math.min(cellW, localPx) * 0.3);
		ctx.beginPath();
		ctx.arc(c.x, c.y, r, 0, 2 * Math.PI);
		ctx.fillStyle = "#ffd35c";
		ctx.fill();
		ctx.lineWidth = 1.5 * o.dpr;
		ctx.strokeStyle = "#1a1c22";
		ctx.stroke();
	}
}

// Red coordinate grid: the source orthogonal grid mapped through the same warp
// (const-X → radial spiral, const-Y → ring) — the Print Gallery red grid.
function drawRedGrid(ctx: CanvasRenderingContext2D, b: DrosteBBox, m: number, p: DrosteParams, o: DrawDrosteOpts): void {
	const nv = Math.max(2, o.gridV ?? 16);
	const nh = Math.max(2, o.gridH ?? 8);
	ctx.strokeStyle = "rgba(220, 60, 60, 0.55)";
	ctx.lineWidth = 1 * o.dpr;
	for (let i = 0; i <= nv; i++) {
		const x = b.minX + (i / nv) * (b.maxX - b.minX);
		ctx.beginPath();
		seg(ctx, b, { x, y: b.minY }, { x, y: b.maxY }, m, p, o, true);
		ctx.stroke();
	}
	for (let j = 0; j <= nh; j++) {
		const y = b.minY + (j / nh) * (b.maxY - b.minY);
		ctx.beginPath();
		seg(ctx, b, { x: b.minX, y }, { x: b.maxX, y }, m, p, o, true);
		ctx.stroke();
	}
}

export function drawDroste(ctx: CanvasRenderingContext2D, meta: DrosteMeta, o: DrawDrosteOpts): void {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = "#0f1116";
	ctx.fillRect(0, 0, o.canvas.width, o.canvas.height);
	if (meta.shapes.length === 0) return;
	if (DROSTE_ORTHO) {
		drawOrtho(ctx, meta, o);
		return;
	}
	const p: DrosteParams = {
		k: o.k,
		twistDir: o.twistDir === "ccw" ? 1 : -1,
		R0: Math.min(o.canvas.width, o.canvas.height) / (4 * o.dpr),
	};
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	const b = meta.bbox;
	// Back-to-front: outer (large) copy first, inner (small) last on top. Each copy
	// is the SAME source plane reduced ×k and nested (self-similar Print Gallery).
	for (let m = o.copies - 1; m >= 0; m--) {
		for (const e of meta.shapes) drawShape(ctx, b, e, m, p, o);
		drawRedGrid(ctx, b, m, p, o);
	}
}
