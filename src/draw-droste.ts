import type { DrosteMeta, DrosteBandElement } from "./droste-layout";
import { drosteForward, subdivideSegment, type DrosteParams, type StripPoint } from "./conformal";
import { clusterHue } from "./canvas-utils";

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
}

// Project a strip point (with a copy offset m on v) to device pixels.
function project(
	pt: StripPoint, m: number, p: DrosteParams, o: DrawDrosteOpts,
): { x: number; y: number } {
	const z = drosteForward(pt.u, pt.v + 2 * Math.PI * m, p);
	// world → screen → device. Centre z at the canvas middle.
	const cx = o.canvas.width / 2;
	const cy = o.canvas.height / 2;
	return {
		x: cx + (z.re * o.zoom + o.panX) * o.dpr,
		y: cy + (z.im * o.zoom + o.panY) * o.dpr,
	};
}

function polyline(
	ctx: CanvasRenderingContext2D, a: StripPoint, b: StripPoint, m: number,
	p: DrosteParams, o: DrawDrosteOpts,
): void {
	const pts = subdivideSegment(a, b, o.subdiv);
	pts.forEach((sp, i) => {
		const d = project(sp, m, p, o);
		if (i === 0) ctx.moveTo(d.x, d.y);
		else ctx.lineTo(d.x, d.y);
	});
}

// One band element = a strip-space rectangle [u0,u1]×[v0,v1] → warped quad.
function strokeElement(
	ctx: CanvasRenderingContext2D, e: DrosteBandElement, m: number,
	p: DrosteParams, o: DrawDrosteOpts,
): void {
	const hue = clusterHue(e.hueKey);
	ctx.beginPath();
	polyline(ctx, { u: e.u0, v: e.v0 }, { u: e.u1, v: e.v0 }, m, p, o);
	polyline(ctx, { u: e.u1, v: e.v0 }, { u: e.u1, v: e.v1 }, m, p, o);
	polyline(ctx, { u: e.u1, v: e.v1 }, { u: e.u0, v: e.v1 }, m, p, o);
	polyline(ctx, { u: e.u0, v: e.v1 }, { u: e.u0, v: e.v0 }, m, p, o);
	ctx.closePath();
	ctx.fillStyle = e.kind === "cluster"
		? `hsla(${hue}, 60%, 50%, 0.18)`
		: `hsla(${hue}, 60%, 55%, 0.32)`;
	ctx.fill();
	ctx.lineWidth = (e.id === o.hoverId ? 2.4 : 1.2) * o.dpr;
	ctx.strokeStyle = `hsla(${hue}, 70%, 70%, 0.9)`;
	ctx.stroke();
	// Upright label at the warped centroid (spec §7 — known compromise).
	const c = project({ u: (e.u0 + e.u1) / 2, v: (e.v0 + e.v1) / 2 }, m, p, o);
	// Local scale ≈ |γ|·|z|·zoom; hide below the font floor.
	const scaleSample = project({ u: e.u0, v: (e.v0 + e.v1) / 2 }, m, p, o);
	const localPx = Math.hypot(c.x - scaleSample.x, c.y - scaleSample.y);
	if (localPx >= o.minFontPx * o.dpr) {
		ctx.fillStyle = "#e6ecf5";
		ctx.font = `${Math.min(localPx * 0.5, 16 * o.dpr)}px sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(e.label, c.x, c.y);
	}
}

export function drawDroste(
	ctx: CanvasRenderingContext2D, meta: DrosteMeta, o: DrawDrosteOpts,
): void {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = "#0f1116";
	ctx.fillRect(0, 0, o.canvas.width, o.canvas.height);
	const p: DrosteParams = {
		k: o.k,
		twistDir: o.twistDir === "ccw" ? 1 : -1,
		R0: Math.min(o.canvas.width, o.canvas.height) / (4 * o.dpr),
	};
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	const L = meta.slices.length;
	if (L === 0) return;
	// Back-to-front: outer (large/coarse) turn first, inner (small/fine) last.
	// Turn m draws hierarchy slice (m mod L) at scale k^m — the recursion lives
	// in the turns. When the focus chain is shorter than the copy count it wraps
	// (slices[m mod L]), closing the Droste loop self-referentially.
	for (let m = o.copies - 1; m >= 0; m--) {
		const slice = meta.slices[m % L];
		for (const e of slice) strokeElement(ctx, e, m, p, o);
	}
}
