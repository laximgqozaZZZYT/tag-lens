// F4-2 — shape-marker path geometry. Records calls on a mock ctx (no DOM) and
// checks vertex counts, centring, and SVG-recorder-compatible primitive usage.
import { ok } from "./assert";
import { shapeMarkerPath, type ShapePathCtx } from "../src/draw/draw-shape";
import { SHAPES } from "../src/encoding/shapes";

interface Call { op: string; args: number[] }
function rec(): ShapePathCtx & { calls: Call[] } {
	const calls: Call[] = [];
	return {
		calls,
		beginPath() { calls.push({ op: "beginPath", args: [] }); },
		moveTo(x, y) { calls.push({ op: "moveTo", args: [x, y] }); },
		lineTo(x, y) { calls.push({ op: "lineTo", args: [x, y] }); },
		arc(x, y, r, s, e) { calls.push({ op: "arc", args: [x, y, r, s, e] }); },
		closePath() { calls.push({ op: "closePath", args: [] }); },
	};
}

// Every shape produces a path and uses only recorder-safe primitives.
{
	const allowed = new Set(["beginPath", "moveTo", "lineTo", "arc", "closePath"]);
	for (const s of SHAPES) {
		const c = rec();
		shapeMarkerPath(c, s, 0, 0, 10);
		ok(c.calls.length > 0, `${s}: emits a path`);
		ok(c.calls.every((k) => allowed.has(k.op)), `${s}: only path primitives`);
		ok(c.calls[0].op === "beginPath", `${s}: starts with beginPath`);
	}
}

// circle = one arc; no polygon edges.
{
	const c = rec();
	shapeMarkerPath(c, "circle", 5, 6, 4);
	ok(c.calls.filter((k) => k.op === "arc").length === 1, "circle is a single arc");
	const a = c.calls.find((k) => k.op === "arc")!;
	ok(a.args[0] === 5 && a.args[1] === 6 && a.args[2] === 4, "circle centred + radius honoured");
}

// triangle = 3 vertices (1 moveTo + 2 lineTo + closePath).
{
	const c = rec();
	shapeMarkerPath(c, "triangle", 0, 0, 10);
	ok(c.calls.filter((k) => k.op === "moveTo").length === 1, "triangle: 1 moveTo");
	ok(c.calls.filter((k) => k.op === "lineTo").length === 2, "triangle: 2 lineTo");
	ok(c.calls.some((k) => k.op === "closePath"), "triangle closes");
}

// square = 4 corners centred on (cx,cy) within radius r.
{
	const c = rec();
	shapeMarkerPath(c, "square", 0, 0, 10);
	const verts = c.calls.filter((k) => k.op === "moveTo" || k.op === "lineTo");
	ok(verts.length === 4, "square: 4 corners");
	ok(verts.every((v) => Math.abs(v.args[0]) <= 10 + 1e-9 && Math.abs(v.args[1]) <= 10 + 1e-9), "square within radius box");
}

// hexagon = 6 vertices; star = 10 vertices (5 outer + 5 inner).
{
	const h = rec();
	shapeMarkerPath(h, "hexagon", 0, 0, 10);
	ok(h.calls.filter((k) => k.op === "moveTo" || k.op === "lineTo").length === 6, "hexagon: 6 vertices");
	const s = rec();
	shapeMarkerPath(s, "star", 0, 0, 10);
	ok(s.calls.filter((k) => k.op === "moveTo" || k.op === "lineTo").length === 10, "star: 10 vertices");
}

// Polygon vertices sit on radius r (centred), e.g. diamond top point is (cx, cy-r).
{
	const c = rec();
	shapeMarkerPath(c, "diamond", 3, 7, 5);
	const first = c.calls.find((k) => k.op === "moveTo")!;
	ok(Math.abs(first.args[0] - 3) < 1e-6 && Math.abs(first.args[1] - (7 - 5)) < 1e-6, "diamond first vertex points up at radius");
}
