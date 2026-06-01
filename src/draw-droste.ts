import { buildIcon, type DrosteGallery, type IconDiagram } from "./droste-layout";
import { truncateToWidth } from "./canvas-utils";

// Containment lens = Icon Gallery (spec 2026-06-01). Every node gets an "icon diagram"
// (① N ∈ ② sig(N) ∈ ③ direct-superset sets ∈ …), all tiled in a grid and navigated by
// pan/zoom. Icons are built ON DEMAND for cells in the viewport (culling) and at a
// level-of-detail floor (tiny cells draw a single marker). No recursion, no warp.

export interface DrawDrosteOpts {
	canvas: HTMLCanvasElement;
	dpr: number;
	gallery: DrosteGallery;
	cellSize: number; // world px per gallery cell (square)
	zoom: number; // world→screen scale (CSS px)
	panX: number; // world→screen offset (CSS px)
	panY: number;
	hoverId: string | null;
	focusId: string; // currently focused node (ring-highlighted)
	// Collector: each clickable node's SCREEN rect (device px) for hit-testing.
	hitRegions?: { id: string; x0: number; y0: number; x1: number; y1: number }[];
}

type Pt = { x: number; y: number };

// Even points clockwise around an axis-aligned square (centre c, half R), starting at
// the top-left, so a level's member squares ring the inner figure.
function squarePerimeter(cx: number, cy: number, R: number, k: number): Pt[] {
	if (k <= 0) return [];
	const side = 2 * R, per = 4 * side, out: Pt[] = [];
	for (let i = 0; i < k; i++) {
		let d = ((i + 0.5) / k) * per;
		if (d < side) out.push({ x: cx - R + d, y: cy - R });
		else if (d < 2 * side) { d -= side; out.push({ x: cx + R, y: cy - R + d }); }
		else if (d < 3 * side) { d -= 2 * side; out.push({ x: cx + R - d, y: cy + R }); }
		else { d -= 3 * side; out.push({ x: cx - R, y: cy + R - d }); }
	}
	return out;
}

const FOCUS_RING = "#ffd35c";
const ICON_BG = "rgba(255,255,255,0.02)";
const TWO_HUE = 45; // ② = amber
// Distinct hue per single tag of T (for ③ node colour-coding + the ③ frame label).
const TAG_HUES = [130, 265, 200, 25, 175, 310, 95, 330];

// Draw T's single tags as "a | b | c" centred at (cx,topY), each tag in its own colour
// (the same colour used to fill that tag's ③ member cells). Separators are dim.
function drawTagLabel(ctx: CanvasRenderingContext2D, labels: string[], hues: number[], cx: number, topY: number, dpr: number): void {
	ctx.font = `${10 * dpr}px sans-serif`;
	ctx.textBaseline = "top";
	const segs: { t: string; h: number | null }[] = [];
	labels.forEach((l, i) => { if (i > 0) segs.push({ t: " | ", h: null }); segs.push({ t: l, h: hues[i] }); });
	const w = segs.map((s) => ctx.measureText(s.t).width);
	const total = w.reduce((a, b) => a + b, 0);
	let x = cx - total / 2;
	ctx.textAlign = "left";
	segs.forEach((s, i) => {
		ctx.fillStyle = s.h == null ? "rgba(200,210,225,0.65)" : `hsl(${s.h}, 70%, 74%)`;
		ctx.fillText(s.t, x, topY);
		x += w[i];
	});
}

// Draw one icon diagram centred at (scx,scy) with available half-size `half` (device px).
// Grid-based: ① is 4×4 grid cells, ② members 2×2, ③ members 1×1; concentric square
// enclosures are sized to CONTAIN their members, and nothing overlaps. A faint grid is
// drawn so the cell sizes are legible.
function drawIcon(ctx: CanvasRenderingContext2D, icon: IconDiagram, scx: number, scy: number, half: number, o: DrawDrosteOpts): void {
	const dpr = o.dpr;
	const tags = icon.tKeys;
	const tIdx = new Map(tags.map((t, i) => [t, i]));
	const tagHue = (t: string): number => TAG_HUES[(tIdx.get(t) ?? 0) % TAG_HUES.length];
	const tagLabel = (t: string): string => o.gallery.labels.get(t) ?? t;

	type Item = { id?: string; label: string; hue: number; agg?: boolean; placeholder?: boolean; spacer?: boolean };
	const buildItems = (lvl: IconDiagram["levels"][number]): Item[] => {
		const out: Item[] = [];
		lvl.sets.forEach((set, si) => {
			// colour: ② amber; ③ by the single tag the set shares (its first key).
			const hue = lvl.n === 2 ? TWO_HUE : tagHue(set.keys[0] ?? tags[0] ?? "");
			if (si > 0) out.push({ label: "", hue, spacer: true }); // gap between incomparable sets
			for (const m of set.members) out.push({ id: m.id, label: m.label, hue });
			if (set.overflow > 0) out.push({ label: `+${set.overflow}`, hue, agg: true });
			if (set.members.length === 0 && set.overflow === 0) out.push({ label: set.label, hue, placeholder: true });
		});
		return out;
	};

	// Radius layout in grid-unit (u) space: accumulate outward so rings never overlap and
	// each frame contains its members; the per-ring radius also grows to give every member
	// a non-overlapping slot on the perimeter.
	const gapU = 0.55;
	let rU = 2; // ① half = 2u (⇒ 4×4 cells)
	const rings: { items: Item[]; isTwo: boolean; memHalfU: number; RcU: number; frameU: number }[] = [];
	for (let f = 0; f < icon.levels.length; f++) {
		const lvl = icon.levels[f];
		const items = buildItems(lvl);
		const isTwo = lvl.n === 2;
		const memHalfU = isTwo ? 1 : 0.5; // ② 2×2 ⇒ half 1u, ③ 1×1 ⇒ half 0.5u
		const count = Math.max(1, items.length);
		const pitchU = 2 * memHalfU + 0.4; // member size + gap ⇒ no overlap on the ring
		let RcU = rU + gapU + memHalfU; // clear the previous frame
		RcU = Math.max(RcU, (count * pitchU) / 8); // enough perimeter for `count` members
		const frameU = RcU + memHalfU + gapU; // frame contains the ring
		rings.push({ items, isTwo, memHalfU, RcU, frameU });
		rU = frameU;
	}
	const totalU = Math.max(2.0001, rU);
	const u = half / totalU; // grid pitch in device px
	const s1 = 2 * u; // ① half-size
	const labelOK = u > 4.5 * dpr;
	const push = (id: string, x: number, y: number, h: number): void => {
		if (o.hitRegions) o.hitRegions.push({ id, x0: x - h, y0: y - h, x1: x + h, y1: y + h });
	};

	// faint background grid at pitch u (clipped to the icon box).
	ctx.save();
	ctx.beginPath(); ctx.rect(scx - half, scy - half, 2 * half, 2 * half); ctx.clip();
	ctx.strokeStyle = "rgba(150,165,190,0.10)"; ctx.lineWidth = 1;
	for (let gx = scx - Math.ceil(half / u) * u; gx <= scx + half; gx += u) { ctx.beginPath(); ctx.moveTo(gx, scy - half); ctx.lineTo(gx, scy + half); ctx.stroke(); }
	for (let gy = scy - Math.ceil(half / u) * u; gy <= scy + half; gy += u) { ctx.beginPath(); ctx.moveTo(scx - half, gy); ctx.lineTo(scx + half, gy); ctx.stroke(); }
	ctx.restore();

	// frames + members, outer → inner (inner on top).
	for (let f = rings.length - 1; f >= 0; f--) {
		const R = rings[f];
		const Ro = R.frameU * u, Rc = R.RcU * u, mh = R.memHalfU * u;
		ctx.fillStyle = ICON_BG; ctx.fillRect(scx - Ro, scy - Ro, 2 * Ro, 2 * Ro);
		ctx.lineWidth = 1.4 * dpr;
		ctx.strokeStyle = R.isTwo ? "hsl(45,70%,62%)" : "hsl(150,28%,55%)";
		ctx.strokeRect(scx - Ro, scy - Ro, 2 * Ro, 2 * Ro);
		const pts = squarePerimeter(scx, scy, Rc, R.items.length);
		R.items.forEach((it, i) => {
			if (it.spacer) return;
			const p = pts[i];
			if (it.agg) {
				ctx.fillStyle = "rgba(120,140,165,0.5)"; ctx.fillRect(p.x - mh, p.y - mh, 2 * mh, 2 * mh);
				ctx.strokeStyle = "rgba(190,205,225,0.7)"; ctx.lineWidth = 1 * dpr; ctx.strokeRect(p.x - mh, p.y - mh, 2 * mh, 2 * mh);
				if (labelOK) { ctx.fillStyle = "#cfe"; ctx.font = `${Math.min(mh * 0.9, 10 * dpr)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(it.label, p.x, p.y); }
			} else if (it.placeholder) {
				ctx.setLineDash([3 * dpr, 2 * dpr]); ctx.strokeStyle = `hsl(${it.hue}, 60%, 70%)`; ctx.lineWidth = 1.2 * dpr;
				ctx.strokeRect(p.x - mh, p.y - mh, 2 * mh, 2 * mh); ctx.setLineDash([]);
				if (labelOK) { ctx.fillStyle = `hsl(${it.hue}, 60%, 82%)`; ctx.font = `${Math.min(mh * 0.8, 10 * dpr)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(truncateToWidth(ctx, it.label, 1.8 * mh), p.x, p.y); }
			} else {
				const hover = it.id != null && it.id === o.hoverId;
				ctx.fillStyle = `hsla(${it.hue}, 75%, 55%, 0.45)`; ctx.fillRect(p.x - mh, p.y - mh, 2 * mh, 2 * mh);
				ctx.lineWidth = (hover ? 2.5 : 1.2) * dpr; ctx.strokeStyle = `hsl(${it.hue}, 85%, ${hover ? 80 : 70}%)`; ctx.strokeRect(p.x - mh, p.y - mh, 2 * mh, 2 * mh);
				if (it.id) push(it.id, p.x, p.y, mh);
				if (labelOK && mh > 6 * dpr) { ctx.fillStyle = "#eef"; ctx.font = `${Math.min(mh * 0.7, 11 * dpr)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(truncateToWidth(ctx, it.label, 1.8 * mh), p.x, p.y); }
			}
		});
		// frame label inside the top edge.
		if (labelOK) {
			if (R.isTwo) {
				ctx.fillStyle = "hsl(45,60%,80%)"; ctx.font = `${10 * dpr}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "top";
				ctx.fillText(truncateToWidth(ctx, icon.levels[f].sets.map((s) => s.label).join(" ∩ "), 1.9 * Ro), scx, scy - Ro + 2 * dpr);
			} else {
				// ③: T's single tags as "a | b | c", each in its tag colour (matches members).
				drawTagLabel(ctx, tags.map(tagLabel), tags.map(tagHue), scx, scy - Ro + 2 * dpr, dpr);
			}
		}
	}
	// ① focus node at the centre (on top), 4×4 — note title drawn LARGE inside it.
	ctx.fillStyle = "hsla(205, 90%, 60%, 0.5)";
	ctx.fillRect(scx - s1, scy - s1, 2 * s1, 2 * s1);
	ctx.lineWidth = (icon.focusId === o.focusId ? 3 : 1.6) * dpr;
	ctx.strokeStyle = icon.focusId === o.focusId ? FOCUS_RING : "hsl(205, 90%, 72%)";
	ctx.strokeRect(scx - s1, scy - s1, 2 * s1, 2 * s1);
	push(icon.focusId, scx, scy, s1);
	if (labelOK) {
		ctx.fillStyle = icon.focusId === o.focusId ? FOCUS_RING : "#ffffff";
		ctx.font = `bold ${Math.min(s1 * 0.5, 24 * dpr)}px sans-serif`;
		ctx.textAlign = "center"; ctx.textBaseline = "middle";
		ctx.fillText(truncateToWidth(ctx, icon.focusLabel, 1.85 * s1), scx, scy);
	}
}

export function drawDroste(ctx: CanvasRenderingContext2D, o: DrawDrosteOpts): void {
	const { canvas, dpr, gallery, cellSize, zoom, panX, panY } = o;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = "#0f1116";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	if (!gallery || gallery.cells.length === 0) return;
	// world→device-screen
	const sx = (wx: number): number => (wx * zoom + panX) * dpr;
	const sy = (wy: number): number => (wy * zoom + panY) * dpr;
	const cs = cellSize * zoom * dpr; // cell size on screen (device px)
	const gap = cs * 0.09; // clear gap between icons so they never touch/overlap
	const half = cs / 2 - gap;
	// visible cell range (cull)
	const wx0 = (-panX) / zoom, wy0 = (-panY) / zoom;
	const wx1 = (canvas.width / dpr - panX) / zoom, wy1 = (canvas.height / dpr - panY) / zoom;
	const c0 = Math.max(0, Math.floor(wx0 / cellSize) - 1);
	const c1 = Math.min(gallery.cols - 1, Math.ceil(wx1 / cellSize) + 1);
	const r0 = Math.max(0, Math.floor(wy0 / cellSize) - 1);
	const r1 = Math.min(gallery.rows - 1, Math.ceil(wy1 / cellSize) + 1);
	const byPos = (col: number, row: number): string | null => {
		const i = row * gallery.cols + col;
		return i >= 0 && i < gallery.cells.length ? gallery.cells[i].id : null;
	};
	for (let row = r0; row <= r1; row++) {
		for (let col = c0; col <= c1; col++) {
			const id = byPos(col, row);
			if (!id) continue;
			const scx = sx((col + 0.5) * cellSize), scy = sy((row + 0.5) * cellSize);
			if (half < 3 * dpr) {
				// LOD floor: a single marker for the node.
				ctx.fillStyle = id === o.focusId ? FOCUS_RING : "hsl(205, 80%, 62%)";
				const m = Math.max(1 * dpr, half);
				ctx.fillRect(scx - m, scy - m, 2 * m, 2 * m);
				if (o.hitRegions) o.hitRegions.push({ id, x0: scx - m, y0: scy - m, x1: scx + m, y1: scy + m });
				continue;
			}
			// Clip to this cell so an icon can NEVER draw into a neighbour's cell
			// (spec §0/§2: icon diagrams must not overlap each other).
			ctx.save();
			ctx.beginPath();
			ctx.rect(scx - cs / 2, scy - cs / 2, cs, cs);
			ctx.clip();
			drawIcon(ctx, buildIcon(gallery, id), scx, scy, half, o);
			ctx.restore();
		}
	}
	// hover tooltip (on top): show the hovered node's full label near its rect.
	if (o.hoverId && o.hitRegions) {
		const hr = o.hitRegions.find((r) => r.id === o.hoverId);
		const label = gallery.nodeLabel.get(o.hoverId) ?? o.hoverId;
		if (hr) {
			ctx.font = `${12 * dpr}px sans-serif`;
			const pad = 6 * dpr, bh = 20 * dpr, bw = ctx.measureText(label).width + 2 * pad;
			let bx = (hr.x0 + hr.x1) / 2 - bw / 2, by = hr.y0 - bh - 4 * dpr;
			bx = Math.max(2 * dpr, Math.min(bx, canvas.width - bw - 2 * dpr));
			if (by < 2 * dpr) by = hr.y1 + 4 * dpr;
			ctx.fillStyle = "rgba(18,20,26,0.94)"; ctx.strokeStyle = "rgba(230,236,245,0.45)"; ctx.lineWidth = 1 * dpr;
			ctx.fillRect(bx, by, bw, bh); ctx.strokeRect(bx, by, bw, bh);
			ctx.fillStyle = "#e6ecf5"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
			ctx.fillText(label, bx + pad, by + bh / 2);
		}
	}
}
