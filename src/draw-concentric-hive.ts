import type { HiveMeta } from "./concentric-hive-layout";
import { truncateToWidth } from "./canvas-utils";

export interface DrawHiveOpts {
	canvas: HTMLCanvasElement;
	dpr: number;
	zoom: number;
	panX: number;
	panY: number;
	hoverId: string | null;
	// Collector: each node's SCREEN rect (device px) for hit-testing.
	hitRegions?: { id: string; x0: number; y0: number; x1: number; y1: number }[];
}

// Concentric Hive renderer. World-space (spec): the view passes zoom/pan and we apply
// the standard dpr·zoom transform, then draw spokes → ring/conduit guides → edges →
// nodes → axis legend, all in world coordinates.
export function drawConcentricHive(ctx: CanvasRenderingContext2D, meta: HiveMeta, o: DrawHiveOpts): void {
	const { canvas, dpr, zoom, panX, panY } = o;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = "#0f1116";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	if (meta.axes.length === 0 || meta.nodes.length === 0) {
		ctx.fillStyle = "#7a8aa0";
		ctx.font = `${14 * dpr}px sans-serif`;
		ctx.textAlign = "center"; ctx.textBaseline = "middle";
		ctx.fillText("No groups to plot — set GROUP_BY / relax WHERE / HAVING.", canvas.width / 2, canvas.height / 2);
		return;
	}
	// world → screen device px
	const lw = dpr / zoom; // 1 device px in world units (so strokes look ~1px after transform)
	ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);

	const rOuter = meta.rings.length ? meta.rings[meta.rings.length - 1].radius : 0;
	const guideOuter = rOuter + 75;

	// ---- spokes (axes): faint radial lines, label at the outer end in the axis hue ----
	for (const ax of meta.axes) {
		const ex = guideOuter * Math.cos(ax.angle), ey = guideOuter * Math.sin(ax.angle);
		ctx.strokeStyle = `hsla(${ax.hue}, 50%, 60%, 0.30)`;
		ctx.lineWidth = 1.2 * lw;
		ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(ex, ey); ctx.stroke();
		// label
		const lx = (guideOuter + 18) * Math.cos(ax.angle), ly = (guideOuter + 18) * Math.sin(ax.angle);
		ctx.fillStyle = `hsl(${ax.hue}, 60%, 72%)`;
		ctx.font = `${12 * lw}px sans-serif`;
		ctx.textAlign = Math.cos(ax.angle) >= 0 ? "left" : "right";
		ctx.textBaseline = "middle";
		ctx.fillText(truncateToWidth(ctx, ax.label, 160 * lw), lx, ly);
	}

	// ---- ring guides + per-facet conduits + centre conduit (faint circles) ----
	ctx.strokeStyle = "rgba(150,165,190,0.18)"; ctx.lineWidth = 1 * lw;
	for (const ring of meta.rings) { ctx.beginPath(); ctx.arc(0, 0, ring.radius, 0, Math.PI * 2); ctx.stroke(); }
	ctx.strokeStyle = "rgba(120,200,210,0.16)"; ctx.setLineDash([5 * lw, 4 * lw]);
	for (const c of meta.conduits) { ctx.beginPath(); ctx.arc(0, 0, c, 0, Math.PI * 2); ctx.stroke(); }
	ctx.beginPath(); ctx.arc(0, 0, meta.centerConduit, 0, Math.PI * 2); ctx.stroke();
	ctx.setLineDash([]);
	// ring labels (degree pair) along the top spoke gap
	ctx.fillStyle = "rgba(200,210,225,0.55)"; ctx.font = `${11 * lw}px sans-serif`;
	ctx.textAlign = "center"; ctx.textBaseline = "bottom";
	for (const ring of meta.rings) ctx.fillText(ring.label, 0, -ring.radius - 2 * lw);

	// ---- edges (under nodes), faint; cross edges slightly cooler ----
	for (const e of meta.edges) {
		if (e.path.length < 2) continue;
		ctx.strokeStyle = e.kind === "cross" ? "rgba(140,170,210,0.22)" : "rgba(180,190,210,0.28)";
		ctx.lineWidth = 1 * lw;
		ctx.beginPath(); ctx.moveTo(e.path[0].x, e.path[0].y);
		for (let i = 1; i < e.path.length; i++) ctx.lineTo(e.path[i].x, e.path[i].y);
		ctx.stroke();
	}

	// ---- nodes: neutral squares, size = link count; hover = highlighted ----
	const sx = (wx: number): number => (wx * zoom + panX) * dpr;
	const sy = (wy: number): number => (wy * zoom + panY) * dpr;
	for (const n of meta.nodes) {
		const hover = n.id === o.hoverId;
		const h = n.size;
		ctx.fillStyle = hover ? "hsla(205,85%,62%,0.85)" : "hsla(210,18%,62%,0.85)"; // neutral default (Q11)
		ctx.fillRect(n.x - h, n.y - h, 2 * h, 2 * h);
		ctx.lineWidth = (hover ? 2.5 : 1) * lw;
		ctx.strokeStyle = hover ? "#cfe6ff" : "hsl(210,20%,78%)";
		ctx.strokeRect(n.x - h, n.y - h, 2 * h, 2 * h);
		if (o.hitRegions) o.hitRegions.push({ id: n.id, x0: sx(n.x - h), y0: sy(n.y - h), x1: sx(n.x + h), y1: sy(n.y + h) });
		// label only when comfortably legible on screen
		if (h * zoom > 14) {
			ctx.fillStyle = "#e9eef5"; ctx.font = `${Math.min(h * 0.7, 12 * lw)}px sans-serif`;
			ctx.textAlign = "center"; ctx.textBaseline = "middle";
			ctx.fillText(truncateToWidth(ctx, n.label, 1.8 * h), n.x, n.y);
		}
	}
}
