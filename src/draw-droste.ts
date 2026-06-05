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
	// Set of hidden node ids/paths. When provided, cells whose id (or its
	// tab-stripped path) is in this set are skipped every paint without a
	// rebuild — so requestDraw() from a checkbox toggle or Deselect-all
	// immediately removes the cell from the screen. Matches the same
	// nodeIsHidden(id, hiddenSet) semantics used by the other draw paths.
	hiddenSet?: Set<string>;
}

type Pt = { x: number; y: number };

// Place `count` items on the BORDER of a coarse grid ring (radius nSteps coarse cells,
// coarse cell = stepCells fine cells). Slots sit on shared grid rows/columns, so items
// line up in clean rows and columns and their cell edges land on the (0.5u-offset) grid.
// `u` is the fine-cell pitch (device px); centre is (cx,cy).
function gridBorderRing(cx: number, cy: number, nSteps: number, stepCells: number, u: number, count: number): Pt[] {
	if (count <= 0) return [];
	const R = nSteps * stepCells; // ring half in fine cells
	const xs: number[] = [];
	for (let k = -nSteps; k <= nSteps; k++) xs.push(k * stepCells); // shared columns/rows
	const slots: [number, number][] = [];
	xs.forEach((x) => slots.push([x, -R])); // top  L→R
	xs.slice(1, -1).forEach((y) => slots.push([R, y])); // right (skip shared corners)
	[...xs].reverse().forEach((x) => slots.push([x, R])); // bottom R→L
	[...xs.slice(1, -1)].reverse().forEach((y) => slots.push([-R, y])); // left
	const N = slots.length, out: Pt[] = [];
	for (let i = 0; i < count; i++) { const s = slots[Math.round((i * N) / count) % N]; out.push({ x: cx + s[0] * u, y: cy + s[1] * u }); }
	return out;
}

// Break `text` into ≤maxLines lines each fitting maxWidth (char-level wrap; long tokens
// like "bt01_01_03_p" split). The last line is ellipsised only if it still overflows.
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
	if (ctx.measureText(text).width <= maxWidth) return [text];
	const lines: string[] = [];
	let cur = "";
	for (const ch of [...text]) {
		if (cur && ctx.measureText(cur + ch).width > maxWidth) { lines.push(cur); cur = ch; }
		else cur += ch;
	}
	if (cur) lines.push(cur);
	if (lines.length > maxLines) {
		const kept = lines.slice(0, maxLines);
		kept[maxLines - 1] = truncateToWidth(ctx, kept[maxLines - 1] + "…", maxWidth);
		return kept;
	}
	return lines;
}

// Draw `text` centred in a box (half-size boxHalf), wrapping to multiple lines instead
// of truncating. Font shrinks a little to fit more lines.
function drawWrapped(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, boxHalf: number, fontPx: number, color: string, bold = false): void {
	ctx.font = `${bold ? "bold " : ""}${fontPx}px sans-serif`;
	const maxW = 1.85 * boxHalf;
	const lh = fontPx * 1.12;
	const maxLines = Math.max(1, Math.floor((1.9 * boxHalf) / lh));
	const lines = wrapLines(ctx, text, maxW, maxLines);
	ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
	const y0 = cy - ((lines.length - 1) * lh) / 2;
	lines.forEach((ln, i) => ctx.fillText(ln, cx, y0 + i * lh));
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
	ctx.textBaseline = "bottom";
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


	type Item = { id?: string; label: string; hue: number; agg?: boolean; placeholder?: boolean; spacer?: boolean };
	const buildItems = (lvl: IconDiagram["levels"][number]): Item[] => {
		const out: Item[] = [];
		lvl.sets.forEach((set, si) => {
			// colour: explicit set.hue (⑤ link/backlink) wins; else ② amber; ③ by the
			// single tag the set shares (its first key).
			const hue = set.hue !== undefined ? set.hue : (lvl.n === 2 ? TWO_HUE : tagHue(set.keys[0] ?? tags[0] ?? ""));
			if (si > 0) out.push({ label: "", hue, spacer: true }); // gap between incomparable sets
			for (const m of set.members) out.push({ id: m.id, label: m.label, hue });
			if (set.overflow > 0) out.push({ label: `+${set.overflow}`, hue, agg: true });
			if (set.members.length === 0 && set.overflow === 0) out.push({ label: set.label, hue, placeholder: true });
		});
		return out;
	};

	// Grid layout in CELL units: ① half 2.5 cells (5×5), ② members 3×3, ③ members 1×1.
	// Each level's ring sits far enough out to clear the inner frame and to hold every
	// member with a 1-cell gap; frames contain their ring. All accumulates outward.
	let innerHalfC = 2.5; // ① half = 2.5 cells ⇒ 5×5
	const rings: { items: Item[]; isTwo: boolean; isLink: boolean; lvl: IconDiagram["levels"][number]; memHalfC: number; stepC: number; nSteps: number; frameC: number }[] = [];
	for (let f = 0; f < icon.levels.length; f++) {
		const lvl = icon.levels[f];
		const items = buildItems(lvl);
		const isTwo = lvl.n === 2;
		const isLink = lvl.kind === "link";
		const big = isTwo || isLink; // ② and ⑤ are 3×3; ③ stays 1×1
		const memHalfC = big ? 1.5 : 0.5; // ②⑤ 3×3 ⇒ half 1.5, ③ 1×1 ⇒ half 0.5
		const stepC = (big ? 3 : 1) + 1; // coarse cell = member footprint + 1-cell gap (②⑤=4, ③=2)
		const count = Math.max(1, items.length);
		// nSteps: coarse-ring radius (in coarse cells) — clears the inner frame AND has
		// ≥count border slots (border of a (2n+1)² coarse grid = 8n slots).
		const nSteps = Math.max(Math.ceil((innerHalfC + 1 + memHalfC) / stepC), Math.ceil(count / 8), 1);
		const frameC = nSteps * stepC + memHalfC + 1; // frame contains the ring
		rings.push({ items, isTwo, isLink: lvl.kind === "link", lvl, memHalfC, stepC, nSteps, frameC });
		innerHalfC = frameC;
	}
	const totalC = Math.max(2.5001, innerHalfC);
	const u = half / totalC; // grid pitch (device px)
	const s1 = 2.5 * u; // ① half-size (5×5)
	const labelOK = u > 4.5 * dpr;
	const push = (id: string, x: number, y: number, h: number): void => {
		if (o.hitRegions) o.hitRegions.push({ id, x0: x - h, y0: y - h, x1: x + h, y1: y + h });
	};

	// faint background grid at pitch u, offset by 0.5u so that odd-sized blocks (5/3/1
	// cells) centred on integer cells have their EDGES exactly on grid lines.
	ctx.save();
	ctx.beginPath(); ctx.rect(scx - half, scy - half, 2 * half, 2 * half); ctx.clip();
	ctx.strokeStyle = "rgba(150,165,190,0.10)"; ctx.lineWidth = 1;
	const g0 = (c: number): number => c - (Math.ceil(half / u) + 0.5) * u;
	for (let gx = g0(scx); gx <= scx + half; gx += u) { ctx.beginPath(); ctx.moveTo(gx, scy - half); ctx.lineTo(gx, scy + half); ctx.stroke(); }
	for (let gy = g0(scy); gy <= scy + half; gy += u) { ctx.beginPath(); ctx.moveTo(scx - half, gy); ctx.lineTo(scx + half, gy); ctx.stroke(); }
	ctx.restore();

	// frames + members, outer → inner (inner on top).
	for (let f = rings.length - 1; f >= 0; f--) {
		const R = rings[f];
		const Ro = R.frameC * u, mh = R.memHalfC * u;
		ctx.fillStyle = ICON_BG; ctx.fillRect(scx - Ro, scy - Ro, 2 * Ro, 2 * Ro);
		ctx.lineWidth = 1.4 * dpr;
		ctx.strokeStyle = R.isLink ? "hsl(190,35%,58%)" : R.isTwo ? "hsl(45,70%,62%)" : "hsl(150,28%,55%)";
		ctx.strokeRect(scx - Ro, scy - Ro, 2 * Ro, 2 * Ro);
		// grid-aligned border ring: rows/columns line up, edges on the grid.
		const pts = gridBorderRing(scx, scy, R.nSteps, R.stepC, u, R.items.length);
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
				if (labelOK && mh > 6 * dpr) {
					// ②⑤ (3×3) wrap long labels to multiple lines; ③ (1×1) is too small → truncate.
					if (R.isTwo || R.isLink) drawWrapped(ctx, it.label, p.x, p.y, mh, Math.min(mh * 0.42, 11 * dpr), "#eef");
					else { ctx.fillStyle = "#eef"; ctx.font = `${Math.min(mh * 0.7, 10 * dpr)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(truncateToWidth(ctx, it.label, 1.8 * mh), p.x, p.y); }
				}
			}
		});
		// frame (group) label placed OUTWARD: just ABOVE the frame's top edge, facing out.
		if (labelOK) {
			const labelY = scy - Ro - 2 * dpr; // outside the frame (above top edge)
			if (R.isTwo) {
				ctx.fillStyle = "hsl(45,60%,82%)"; ctx.font = `${10 * dpr}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
				ctx.fillText(truncateToWidth(ctx, icon.levels[f].sets.map((s) => s.label).join(" * "), 1.95 * Ro), scx, labelY);
			} else if (R.isLink) {
				// ⑤: "link | backlink" (only the categories present), each in its colour.
				drawTagLabel(ctx, R.lvl.sets.map((s) => s.label), R.lvl.sets.map((s) => s.hue ?? 0), scx, labelY, dpr);
			} else {
				// ③: THIS ring's own sets (e.g. "beat*drama | beat*timeline | drama*timeline"
				// for the 2-tag-subset ring, "beat | drama | timeline" for the 1-tag ring),
				// each in its set colour — NOT always T's single tags (that duplicated labels
				// across the ③₁/③₂ rings).
				drawTagLabel(ctx, R.lvl.sets.map((s) => s.label), R.lvl.sets.map((s) => tagHue(s.keys[0] ?? tags[0] ?? "")), scx, labelY, dpr);
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
		// ① title wraps to multiple lines instead of truncating.
		drawWrapped(ctx, icon.focusLabel, scx, scy, s1, Math.min(s1 * 0.34, 20 * dpr), icon.focusId === o.focusId ? FOCUS_RING : "#ffffff", true);
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
			// Skip cells hidden by the navigator checkboxes / Deselect-all.
			// Re-read hiddenSet fresh every paint so a requestDraw() from a
			// toggle immediately removes the cell — matching the skipNode path
			// used by all other view modes.
			if (o.hiddenSet) {
				const tab = id.indexOf("\t");
				const path = tab >= 0 ? id.slice(tab + 1) : id;
				if (o.hiddenSet.has(id) || o.hiddenSet.has(path)) continue;
			}
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
	// (Hover tip is the shared DOM tip — file name + folder — driven by the view's
	// hoverTarget/showHover, matching every other view mode. The hovered cell itself is
	// highlighted via o.hoverId in drawIcon.)
}
