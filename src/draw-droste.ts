import { drosteForward, type DrosteParams } from "./conformal";
import { drosteUV, type DrosteMeta, type DrosteShape, type DrosteBBox } from "./droste-layout";
import { truncateToWidth } from "./canvas-utils";

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

// Clear per-ROLE palette so ①②③④ are visually distinct at a glance
// (① focus = blue, ② exact-T notes = amber, ③ T-enclosure = purple,
// ④ subset enclosures = green). fillA = stronger fill so roles read clearly.
function roleColor(role: 1 | 2 | 3 | 4): { h: number; s: number; l: number } {
	switch (role) {
		case 1: return { h: 205, s: 90, l: 60 }; // ① blue
		case 2: return { h: 45, s: 95, l: 60 }; // ② amber
		case 3: return { h: 265, s: 80, l: 68 }; // ③ purple
		default: return { h: 130, s: 65, l: 58 }; // ④ green
	}
}

// Orthogonal render (all squares, axis-aligned, no polar/warp):
//   ① N — a square at the centre.
//   ② T-exact notes — small squares arranged AROUND ① on a SQUARE ring (surrounding
//      it, themselves forming a square).
//   ③ T-enclosure, ④ subset enclosures — square frames nested outside.
function drawOrtho(ctx: CanvasRenderingContext2D, meta: DrosteMeta, o: DrawDrosteOpts): void {
	const cx = o.canvas.width / 2, cy = o.canvas.height / 2;
	const maxR = Math.min(cx, cy) * 0.94;
	// Cartesian coordinate grid (background) — straight x/y lines centred on (cx,cy).
	// (Under the warp this is what becomes the red Print-Gallery spiral mesh.)
	const gstep = maxR / 16; // finer grid
	ctx.strokeStyle = "rgba(210, 80, 80, 0.26)";
	ctx.lineWidth = 1 * o.dpr;
	for (let x = cx % gstep; x <= o.canvas.width; x += gstep) {
		ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, o.canvas.height); ctx.stroke();
	}
	for (let y = cy % gstep; y <= o.canvas.height; y += gstep) {
		ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(o.canvas.width, y); ctx.stroke();
	}
	// Snap an edge coord to the nearest grid line so ①②③④ borders align to the grid.
	const snapX = (v: number): number => cx + Math.round((v - cx) / gstep) * gstep;
	const snapY = (v: number): number => cy + Math.round((v - cy) / gstep) * gstep;
	const r1half = 2 * gstep; // ① N = 4×4 grid cells
	const role = (n: number) => meta.shapes.filter((e) => e.role === n);
	const r2 = role(2);
	// ①②: a centred square GRID — ① is the centre cell, ② fill the surrounding
	// cells (ring by ring) so they enclose ① on all sides and the block is a square.
	let g = 1; // odd grid size with g² ≥ 1 + |②|
	while (g * g < 1 + r2.length) g += 2;
	const cardH = maxR * 0.055; // ② card half-size (kept ~ as-is, decoupled from spacing)
	// Grid spacing must be large enough that the nearest ② cell clears the 4×4 ①:
	// (cell − cardH) ≥ r1half + 1-cell gap. Floor at the old default so small graphs
	// don't collapse.
	const cell = Math.max((2 * (maxR * 0.2)) / g, r1half + cardH + gstep);
	const B = (cell * g) / 2; // ①② block half-size derived from the spacing
	const ctr = (g - 1) / 2;
	const cellCenter = (col: number, row: number): Pt => ({ x: cx + (col - ctr) * cell, y: cy + (row - ctr) * cell });
	// surrounding cells ordered by ring distance (Chebyshev) then angle.
	const around: { col: number; row: number }[] = [];
	for (let row = 0; row < g; row++) for (let col = 0; col < g; col++) if (!(col === ctr && row === ctr)) around.push({ col, row });
	around.sort((a, bb) =>
		Math.max(Math.abs(a.col - ctr), Math.abs(a.row - ctr)) - Math.max(Math.abs(bb.col - ctr), Math.abs(bb.row - ctr)) ||
		Math.atan2(a.row - ctr, a.col - ctr) - Math.atan2(bb.row - ctr, bb.col - ctr),
	);
	const R3 = B + cell * 0.45; // ③ frame just outside the block
	// All boxes snap their edges to the grid (≥ 1 cell), so borders land on grid lines.
	const snapBox = (x0: number, y0: number, x1: number, y1: number) => {
		let sx0 = snapX(x0), sx1 = snapX(x1), sy0 = snapY(y0), sy1 = snapY(y1);
		if (sx1 <= sx0) sx1 = sx0 + gstep;
		if (sy1 <= sy0) sy1 = sy0 + gstep;
		return { x: sx0, y: sy0, w: sx1 - sx0, h: sy1 - sy0 };
	};
	const frame = (R: number, rc: { h: number; s: number; l: number }, hover: boolean, label: string): void => {
		const b2 = snapBox(cx - R, cy - R, cx + R, cy + R);
		ctx.fillStyle = `hsla(${rc.h}, ${rc.s}%, ${rc.l}%, 0.10)`;
		ctx.fillRect(b2.x, b2.y, b2.w, b2.h);
		ctx.lineWidth = (hover ? 4 : 3) * o.dpr;
		ctx.strokeStyle = `hsl(${rc.h}, ${rc.s}%, ${Math.min(rc.l + 12, 82)}%)`;
		ctx.strokeRect(b2.x, b2.y, b2.w, b2.h);
		ctx.fillStyle = "#e6ecf5";
		ctx.font = `${12 * o.dpr}px sans-serif`;
		ctx.textAlign = "center"; ctx.textBaseline = "bottom";
		ctx.fillText(truncateToWidth(ctx, label, b2.w * 0.95), b2.x + b2.w / 2, b2.y - 2 * o.dpr);
	};
	const square = (px: number, py: number, h: number, rc: { h: number; s: number; l: number }, hover: boolean, label: string): void => {
		const b2 = snapBox(px - h, py - h, px + h, py + h);
		ctx.fillStyle = `hsla(${rc.h}, ${rc.s}%, ${rc.l}%, 0.4)`;
		ctx.fillRect(b2.x, b2.y, b2.w, b2.h);
		ctx.lineWidth = (hover ? 3.5 : 1.8) * o.dpr;
		ctx.strokeStyle = `hsl(${rc.h}, ${rc.s}%, ${Math.min(rc.l + 14, 85)}%)`;
		ctx.strokeRect(b2.x, b2.y, b2.w, b2.h);
		ctx.fillStyle = "#e6ecf5";
		ctx.font = `${Math.min(b2.h * 0.34, 12 * o.dpr)}px sans-serif`;
		ctx.textAlign = "center"; ctx.textBaseline = "middle";
		ctx.fillText(truncateToWidth(ctx, label, b2.w * 0.92), b2.x + b2.w / 2, b2.y + b2.h / 2);
	};

	// ④ subset enclosures (back): each CONTAINS ③ (act ⊇ act∩drama), drawn as a
	// square frame larger than ③. Independent siblings (act, drama) are STAGGERED
	// (centres offset in different directions) so each encloses ③ but neither is
	// nested inside the other.
	const r4 = role(4);
	const rc4 = roleColor(4);
	// Large offset so independent ④ siblings clearly diverge (Venn overlap sharing
	// the central ③), not near-concentric (which read as nested). The frame is sized
	// R3 + offset + a member band so the group's own notes fit between ③ and the edge.
	const D = r4.length <= 1 ? 0 : maxR * 0.22; // stagger offset
	const memberBand = maxR * 0.16;
	const H4 = Math.min(R3 + D + memberBand, Math.min(cx, cy) - 2 * o.dpr - D); // each still contains ③
	const mh = gstep / 2; // member square = 1×1 grid cell
	r4.forEach((e, i) => {
		const th = (2 * Math.PI * i) / Math.max(1, r4.length); // k=2 → right & left
		const ox = D * Math.cos(th), oy = D * Math.sin(th);
		const bf = snapBox(cx + ox - H4, cy + oy - H4, cx + ox + H4, cy + oy + H4);
		ctx.fillStyle = `hsla(${rc4.h}, ${rc4.s}%, ${rc4.l}%, 0.08)`;
		ctx.fillRect(bf.x, bf.y, bf.w, bf.h);
		ctx.lineWidth = (e.id === o.hoverId ? 4 : 3) * o.dpr;
		ctx.strokeStyle = `hsl(${rc4.h}, ${rc4.s}%, ${Math.min(rc4.l + 12, 82)}%)`;
		ctx.strokeRect(bf.x, bf.y, bf.w, bf.h);
		ctx.fillStyle = "#e6ecf5";
		ctx.font = `${12 * o.dpr}px sans-serif`;
		ctx.textAlign = "center"; ctx.textBaseline = "bottom";
		ctx.fillText(truncateToWidth(ctx, e.label, bf.w * 0.9), bf.x + bf.w / 2, bf.y - 2 * o.dpr);
		// This group's own notes as small GREY squares, pushed into this ④'s
		// EXCLUSIVE outer band (the offset direction) so they don't fall on top of
		// the other ④ siblings' frames (which only share the central ③ region).
		const mem = e.members ?? [];
		if (mem.length) {
			const dx = D > 0 ? ox / D : 0, dy = D > 0 ? oy / D : 1; // unit dir (down if no offset)
			const ccx = cx + dx * (H4 * 0.88), ccy = cy + dy * (H4 * 0.88);
			const gm = Math.ceil(Math.sqrt(mem.length));
			const step = gstep; // 1 cell per member, adjacent
			const grey = { h: 0, s: 0, l: 62 };
			mem.forEach((mn, k) => {
				const col = k % gm, row = Math.floor(k / gm);
				const px = ccx + (col - (gm - 1) / 2) * step;
				const py = ccy + (row - (gm - 1) / 2) * step;
				square(px, py, mh, grey, mn.id === o.hoverId, mn.label);
			});
		}
	});
	// ③ the single T-enclosure frame around the ①② block (inside every ④).
	for (const e of role(3)) frame(R3, roleColor(3), e.id === o.hoverId, e.label);
	// ② T-exact notes fill the cells SURROUNDING ① (ring by ring) → enclose it.
	r2.forEach((e, j) => { const p = cellCenter(around[j].col, around[j].row); square(p.x, p.y, cardH, roleColor(2), e.id === o.hoverId, e.label); });
	// ① N at the centre cell (on top).
	for (const e of role(1)) {
		square(cx, cy, r1half, roleColor(1), e.id === o.hoverId, e.label);
		if (e.id === o.focusId) {
			ctx.beginPath(); ctx.arc(cx, cy, Math.max(3 * o.dpr, r1half * 0.35), 0, 2 * Math.PI);
			ctx.fillStyle = "#ffd35c"; ctx.fill();
			ctx.lineWidth = 1.5 * o.dpr; ctx.strokeStyle = "#1a1c22"; ctx.stroke();
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
	const rc = roleColor(e.role);
	shapePath(ctx, b, e, m, p, o);
	if (e.kind === "card") {
		ctx.fillStyle = `hsla(${rc.h}, ${rc.s}%, ${rc.l}%, 0.42)`;
		ctx.fill();
		ctx.lineWidth = (e.id === o.hoverId ? 3 : 1.6) * o.dpr;
		ctx.strokeStyle = `hsl(${rc.h}, ${rc.s}%, ${Math.min(rc.l + 15, 85)}%)`;
		ctx.stroke();
	} else {
		// Group enclosure frame (BubbleSets style): faint fill + bold contour.
		ctx.fillStyle = `hsla(${rc.h}, ${rc.s}%, ${rc.l}%, 0.22)`;
		ctx.fill();
		ctx.lineWidth = (e.id === o.hoverId ? 4 : 3) * o.dpr;
		ctx.strokeStyle = `hsl(${rc.h}, ${rc.s}%, ${Math.min(rc.l + 12, 82)}%)`;
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
