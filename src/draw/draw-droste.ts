import { buildIcon, type DrosteGallery, type IconDiagram } from "../layout/droste-layout";
import type { AxisSpec } from "../layout/axis-layout";
import { theme, colorAlpha, parseColor, relativeLuminance } from "./theme";
import { truncateToWidth, clusterHue } from "./canvas-utils";

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

const focusRing = () => theme().warn;
const iconBg = () => theme().overlay(0.02);
const TWO_HUE = 45; // ② = amber
const textOnFill = (fill: string): string => {
	const rgb = parseColor(fill);
	if (!rgb) return theme().textNormal;
	return relativeLuminance(rgb) > 0.42 ? "#10141c" : "#eef3f9";
};

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
		ctx.fillStyle = s.h == null ? colorAlpha(theme().textMuted, 0.65) : theme().swatch(s.h, "fill");
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
	const tagHue = (t: string): number => clusterHue(t);


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
	ctx.strokeStyle = theme().overlay(0.10); ctx.lineWidth = 1;
	const g0 = (c: number): number => c - (Math.ceil(half / u) + 0.5) * u;
	for (let gx = g0(scx); gx <= scx + half; gx += u) { ctx.beginPath(); ctx.moveTo(gx, scy - half); ctx.lineTo(gx, scy + half); ctx.stroke(); }
	for (let gy = g0(scy); gy <= scy + half; gy += u) { ctx.beginPath(); ctx.moveTo(scx - half, gy); ctx.lineTo(scx + half, gy); ctx.stroke(); }
	ctx.restore();

	// frames + members, outer → inner (inner on top).
	for (let f = rings.length - 1; f >= 0; f--) {
		const R = rings[f];
		const Ro = R.frameC * u, mh = R.memHalfC * u;
		ctx.fillStyle = iconBg(); ctx.fillRect(scx - Ro, scy - Ro, 2 * Ro, 2 * Ro);
		ctx.lineWidth = 1.4 * dpr;
		ctx.strokeStyle = R.isLink ? theme().accent : R.isTwo ? theme().warn : theme().success;
		ctx.strokeRect(scx - Ro, scy - Ro, 2 * Ro, 2 * Ro);
		// grid-aligned border ring: rows/columns line up, edges on the grid.
		const pts = gridBorderRing(scx, scy, R.nSteps, R.stepC, u, R.items.length);
		R.items.forEach((it, i) => {
			if (it.spacer) return;
			const p = pts[i];
			if (it.agg) {
				ctx.fillStyle = theme().overlay(0.3); ctx.fillRect(p.x - mh, p.y - mh, 2 * mh, 2 * mh);
				ctx.strokeStyle = theme().overlay(0.7); ctx.lineWidth = 1 * dpr; ctx.strokeRect(p.x - mh, p.y - mh, 2 * mh, 2 * mh);
				if (labelOK) { ctx.fillStyle = theme().textNormal; ctx.font = `${Math.min(mh * 0.9, 10 * dpr)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(it.label, p.x, p.y); }
			} else if (it.placeholder) {
				ctx.setLineDash([3 * dpr, 2 * dpr]); ctx.strokeStyle = theme().swatch(it.hue, "stroke"); ctx.lineWidth = 1.2 * dpr;
				ctx.strokeRect(p.x - mh, p.y - mh, 2 * mh, 2 * mh); ctx.setLineDash([]);
				if (labelOK) { ctx.fillStyle = theme().swatch(it.hue, "label"); ctx.font = `${Math.min(mh * 0.8, 10 * dpr)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(truncateToWidth(ctx, it.label, 1.8 * mh), p.x, p.y); }
			} else {
				const hover = it.id != null && it.id === o.hoverId;
				const fill = theme().swatch(it.hue, "fill");
				const text = textOnFill(fill);
				ctx.fillStyle = fill; ctx.fillRect(p.x - mh, p.y - mh, 2 * mh, 2 * mh);
				ctx.lineWidth = (hover ? 2.5 : 1.2) * dpr; ctx.strokeStyle = theme().swatch(it.hue, hover ? "fillStrong" : "fill"); ctx.strokeRect(p.x - mh, p.y - mh, 2 * mh, 2 * mh);
				if (it.id) push(it.id, p.x, p.y, mh);
				if (labelOK && mh > 6 * dpr) {
					// ②⑤ (3×3) wrap long labels to multiple lines; ③ (1×1) is too small → truncate.
					if (R.isTwo || R.isLink) drawWrapped(ctx, it.label, p.x, p.y, mh, Math.min(mh * 0.42, 11 * dpr), text);
					else { ctx.fillStyle = text; ctx.font = `${Math.min(mh * 0.7, 10 * dpr)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(truncateToWidth(ctx, it.label, 1.8 * mh), p.x, p.y); }
				}
			}
		});
		// frame (group) label placed OUTWARD: just ABOVE the frame's top edge, facing out.
		if (labelOK) {
			const labelY = scy - Ro - 2 * dpr; // outside the frame (above top edge)
			if (R.isTwo) {
				ctx.fillStyle = theme().warn; ctx.font = `${10 * dpr}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
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
	const focusFill = theme().accent;
	const focusText = textOnFill(focusFill);
	ctx.fillStyle = focusFill;
	ctx.fillRect(scx - s1, scy - s1, 2 * s1, 2 * s1);
	ctx.lineWidth = (icon.focusId === o.focusId ? 3 : 1.6) * dpr;
	ctx.strokeStyle = icon.focusId === o.focusId ? focusRing() : theme().accent;
	ctx.strokeRect(scx - s1, scy - s1, 2 * s1, 2 * s1);
	push(icon.focusId, scx, scy, s1);
	if (labelOK) {
		// ① title wraps to multiple lines instead of truncating.
		drawWrapped(ctx, icon.focusLabel, scx, scy, s1, Math.min(s1 * 0.34, 20 * dpr), icon.focusId === o.focusId ? focusRing() : focusText, true);
	}
}

// Custom-axis Cartesian grid for the Icon Gallery. Band/tick positions are in
// COLUMN/ROW units (multiples of cellSize → world coords). Categorical axes draw
// a gridline at each band boundary + a centred band label; quantitative axes draw
// a gridline at each tick + a value label. Labels are drawn in SCREEN space at the
// top / left edges so they stay legible regardless of pan/zoom.
function drawAxisGrid(
	ctx: CanvasRenderingContext2D,
	o: DrawDrosteOpts,
	axes: { x?: AxisSpec; y?: AxisSpec },
	c0: number,
	c1: number,
	r0: number,
	r1: number,
): void {
	const { dpr, cellSize, zoom, panX, panY } = o;
	const sx = (wx: number): number => (wx * zoom + panX) * dpr;
	const sy = (wy: number): number => (wy * zoom + panY) * dpr;
	const w = ctx.canvas.width;
	const h = ctx.canvas.height;
	// Band/tick boundaries (in col OR row units) within the visible range. X is
	// filtered by the visible COLUMN range (c0..c1), Y by the visible ROW range
	// (r0..r1) — using the column range for Y dropped horizontal lines whenever
	// the Y bands outnumbered the X columns.
	const linesFor = (ax: AxisSpec, lo: number, hi: number): number[] => {
		const out: number[] = [];
		if (ax.kind === "categorical" && ax.bands) {
			for (const b of ax.bands) {
				out.push(b.start);
				out.push(b.end);
			}
		} else if (ax.ticks) {
			for (const t of ax.ticks) out.push(t.pos);
		}
		return [...new Set(out)].filter((u) => u >= lo - 1 && u <= hi + 2);
	};

	ctx.save();
	ctx.strokeStyle = theme().overlay(0.22);
	ctx.lineWidth = 1 * dpr;
	ctx.beginPath();
	if (axes.x) {
		for (const u of linesFor(axes.x, c0, c1)) {
			const px = sx(u * cellSize);
			ctx.moveTo(px, 0);
			ctx.lineTo(px, h);
		}
	}
	if (axes.y) {
		for (const u of linesFor(axes.y, r0, r1)) {
			const py = sy(u * cellSize);
			ctx.moveTo(0, py);
			ctx.lineTo(w, py);
		}
	}
	ctx.stroke();

	// Labels — screen-pinned headers at the top (X) and left (Y) edges.
	const headerH = 18 * dpr;
	const headerW = 18 * dpr;
	const fontPx = 11 * dpr;
	ctx.fillStyle = colorAlpha(theme().panelBg, 0.92);
	if (axes.x) ctx.fillRect(0, 0, w, headerH);
	if (axes.y) ctx.fillRect(0, 0, headerW, h);
	ctx.fillStyle = theme().textNormal;
	ctx.font = `700 ${fontPx}px sans-serif`;
	ctx.textBaseline = "middle";

	if (axes.x) {
		ctx.textAlign = "center";
		if (axes.x.kind === "categorical" && axes.x.bands) {
			for (const b of axes.x.bands) {
				const xc = sx(b.center * cellSize);
				if (xc < headerW || xc > w) continue;
				const bw = (b.end - b.start) * cellSize * zoom * dpr;
				const tw = ctx.measureText(b.label).width;
				const f = Math.max(7 * dpr, fontPx * Math.min(1, (bw - 6 * dpr) / Math.max(1, tw)));
				ctx.font = `700 ${f}px sans-serif`;
				ctx.fillText(b.label, xc, headerH / 2);
				ctx.font = `700 ${fontPx}px sans-serif`;
			}
		} else if (axes.x.ticks) {
			let lastRight = -Infinity;
			for (const t of axes.x.ticks) {
				const xc = sx(t.pos * cellSize);
				if (xc < headerW || xc > w) continue;
				const tw = ctx.measureText(t.label).width;
				if (xc - tw / 2 < lastRight + 8 * dpr) continue;
				ctx.fillText(t.label, xc, headerH / 2);
				lastRight = xc + tw / 2;
			}
		}
	}
	if (axes.y) {
		if (axes.y.kind === "categorical" && axes.y.bands) {
			for (const b of axes.y.bands) {
				const yc = sy(b.center * cellSize);
				if (yc < headerH || yc > h) continue;
				ctx.save();
				ctx.translate(headerW / 2, yc);
				ctx.rotate(-Math.PI / 2);
				const bh = (b.end - b.start) * cellSize * zoom * dpr;
				const tw = ctx.measureText(b.label).width;
				const f = Math.max(7 * dpr, fontPx * Math.min(1, (bh - 6 * dpr) / Math.max(1, tw)));
				ctx.font = `700 ${f}px sans-serif`;
				ctx.textAlign = "center";
				ctx.fillText(b.label, 0, 0);
				ctx.restore();
				ctx.font = `700 ${fontPx}px sans-serif`;
			}
		} else if (axes.y.ticks) {
			ctx.textAlign = "center";
			let lastBottom = -Infinity;
			for (const t of axes.y.ticks) {
				const yc = sy(t.pos * cellSize);
				if (yc < headerH || yc > h) continue;
				if (yc - fontPx / 2 < lastBottom + 6 * dpr) continue;
				ctx.save();
				ctx.translate(headerW / 2, yc);
				ctx.rotate(-Math.PI / 2);
				ctx.fillText(t.label, 0, 0);
				ctx.restore();
				lastBottom = yc + fontPx / 2;
			}
		}
	}
	ctx.textAlign = "start";
	ctx.textBaseline = "alphabetic";
	ctx.restore();
}

// Default Cartesian grid for the Icon Gallery when no custom axes are bound.
// Draws orthogonal gridlines at every cell boundary in the visible range, plus
// frozen screen-space headers along the top (column index) and left (row index)
// edges so the gallery reads as a proper coordinate system.
function drawDefaultGrid(
	ctx: CanvasRenderingContext2D,
	o: DrawDrosteOpts,
	c0: number,
	c1: number,
	r0: number,
	r1: number,
): void {
	const { dpr, cellSize, zoom, panX, panY } = o;
	const w = ctx.canvas.width;
	const h = ctx.canvas.height;
	const sx = (wx: number): number => (wx * zoom + panX) * dpr;
	const sy = (wy: number): number => (wy * zoom + panY) * dpr;

	// Gridlines — subtle orthogonal lines at every cell boundary.
	ctx.save();
	ctx.strokeStyle = theme().overlay(0.15);
	ctx.lineWidth = 1 * dpr;
	ctx.beginPath();
	for (let col = c0; col <= c1 + 1; col++) {
		const px = sx(col * cellSize);
		ctx.moveTo(px, 0);
		ctx.lineTo(px, h);
	}
	for (let row = r0; row <= r1 + 1; row++) {
		const py = sy(row * cellSize);
		ctx.moveTo(0, py);
		ctx.lineTo(w, py);
	}
	ctx.stroke();

	// Frozen headers — column indices at the top, row indices on the left.
	const headerH = 18 * dpr;
	const headerW = 18 * dpr;
	const fontPx = 11 * dpr;

	// Background strips (semi-opaque so the grid peeks through slightly).
	ctx.fillStyle = colorAlpha(theme().panelBg, 0.88);
	ctx.fillRect(0, 0, w, headerH);
	ctx.fillRect(0, 0, headerW, h);

	// Column labels (centred in each cell).
	ctx.fillStyle = theme().textMuted;
	ctx.font = `600 ${fontPx}px sans-serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	for (let col = c0; col <= c1; col++) {
		const xc = sx((col + 0.5) * cellSize);
		if (xc < headerW || xc > w) continue;
		ctx.fillText(String(col + 1), xc, headerH / 2);
	}

	// Row labels (centred vertically, rotated −90° for consistency with axis mode).
	for (let row = r0; row <= r1; row++) {
		const yc = sy((row + 0.5) * cellSize);
		if (yc < headerH || yc > h) continue;
		ctx.save();
		ctx.translate(headerW / 2, yc);
		ctx.rotate(-Math.PI / 2);
		ctx.textAlign = "center";
		ctx.fillText(String(row + 1), 0, 0);
		ctx.restore();
	}

	ctx.textAlign = "start";
	ctx.textBaseline = "alphabetic";
	ctx.restore();
}

export function drawDroste(ctx: CanvasRenderingContext2D, o: DrawDrosteOpts): void {
	const { canvas, dpr, gallery, cellSize, zoom, panX, panY } = o;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = theme().canvasBg;
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
	// Look up the cell at (col,row) by its OWN col/row, not the dense
	// row*cols+col index — the custom-axis Cartesian mode scatters cells onto
	// arbitrary (col,row) positions, so a positional index would be wrong. Built
	// once per paint; the default contact-sheet tiling resolves identically.
	const byPosMap = new Map<number, string>();
	for (const cell of gallery.cells) byPosMap.set(cell.row * gallery.cols + cell.col, cell.id);
	const byPos = (col: number, row: number): string | null =>
		byPosMap.get(row * gallery.cols + col) ?? null;
	// Cartesian gridlines: axis grid when axes are bound, default cell grid otherwise.
	if (gallery.axes) {
		drawAxisGrid(ctx, o, gallery.axes, c0, c1, r0, r1);
	} else {
		drawDefaultGrid(ctx, o, c0, c1, r0, r1);
	}
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
				ctx.fillStyle = id === o.focusId ? focusRing() : theme().accent;
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
