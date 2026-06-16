// F4 — pure shape-marker path builder for the `shape` channel and its legend.
// Builds a path centred at (cx,cy) with radius r on the given context; the CALLER
// sets fillStyle/strokeStyle and calls fill()/stroke(). Uses only beginPath /
// moveTo / lineTo / arc / closePath so it renders identically on a real canvas
// and on the SvgRecorderContext (vector export).
import type { NodeShape } from "../encoding/shapes";

// Minimal context surface this helper needs (so it is unit-testable with a mock).
export interface ShapePathCtx {
	beginPath(): void;
	moveTo(x: number, y: number): void;
	lineTo(x: number, y: number): void;
	arc(x: number, y: number, r: number, start: number, end: number, ccw?: boolean): void;
	closePath(): void;
}

function polygon(ctx: ShapePathCtx, cx: number, cy: number, r: number, sides: number, rot: number): void {
	ctx.beginPath();
	for (let i = 0; i < sides; i++) {
		const a = rot + (i / sides) * Math.PI * 2;
		const x = cx + r * Math.cos(a);
		const y = cy + r * Math.sin(a);
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.closePath();
}

function star(ctx: ShapePathCtx, cx: number, cy: number, r: number, points: number, rot: number): void {
	const inner = r * 0.42;
	ctx.beginPath();
	for (let i = 0; i < points * 2; i++) {
		const rad = i % 2 === 0 ? r : inner;
		const a = rot + (i / (points * 2)) * Math.PI * 2;
		const x = cx + rad * Math.cos(a);
		const y = cy + rad * Math.sin(a);
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.closePath();
}

const UP = -Math.PI / 2; // first vertex pointing up

// Build (only) the path for `shape`. Does not fill or stroke.
export function shapeMarkerPath(ctx: ShapePathCtx, shape: NodeShape, cx: number, cy: number, r: number): void {
	switch (shape) {
		case "circle":
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
			break;
		case "square":
			ctx.beginPath();
			ctx.moveTo(cx - r, cy - r);
			ctx.lineTo(cx + r, cy - r);
			ctx.lineTo(cx + r, cy + r);
			ctx.lineTo(cx - r, cy + r);
			ctx.closePath();
			break;
		case "triangle":
			polygon(ctx, cx, cy, r, 3, UP);
			break;
		case "diamond":
			polygon(ctx, cx, cy, r, 4, UP);
			break;
		case "hexagon":
			polygon(ctx, cx, cy, r, 6, UP);
			break;
		case "star":
			star(ctx, cx, cy, r, 5, UP);
			break;
		default:
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
	}
}
