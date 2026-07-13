// screenPointFromRect(rect, e) — canvas-local pointer coords: subtract the
// canvas rect origin (left/top) from the event's client coords. Every input
// handler in view.ts re-derived this identical `clientX - left` / `clientY - top`
// pair; now one pure helper.
import { ok } from "./assert";
import { screenPointFromRect } from "../src/interaction/pointer-pos";

// Origin-anchored canvas: canvas coords equal client coords.
{
	const p = screenPointFromRect({ left: 0, top: 0 }, { clientX: 30, clientY: 40 });
	ok(p.sx === 30 && p.sy === 40, "zero origin passes client coords through unchanged");
}

// Offset canvas: subtract the rect origin from each axis independently.
{
	const p = screenPointFromRect({ left: 100, top: 20 }, { clientX: 130, clientY: 55 });
	ok(p.sx === 30, "sx = clientX - left");
	ok(p.sy === 35, "sy = clientY - top");
}

// Axes are independent — left never touches sy, top never touches sx.
{
	const p = screenPointFromRect({ left: 5, top: 500 }, { clientX: 12, clientY: 500 });
	ok(p.sx === 7, "sx uses left only");
	ok(p.sy === 0, "sy uses top only (pointer on the top edge → 0)");
}

// Pointer above/left of the canvas → negative canvas coords (no clamping).
{
	const p = screenPointFromRect({ left: 50, top: 50 }, { clientX: 10, clientY: 10 });
	ok(p.sx === -40 && p.sy === -40, "coords left/above the canvas stay negative");
}
