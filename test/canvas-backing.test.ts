// canvasBackingSize(clientW, clientH, dpr) — the device-pixel backing-store
// dimensions for the <canvas>: floor(client * dpr) with a min-1 guard. Behaviour
// lock for the seam extracted from the view's `resize()` path.
import { canvasBackingSize } from "../src/draw/canvas-backing";
import { ok } from "./assert";

// dpr = 1 → buffer equals the (already-integer) CSS size.
{
	const s = canvasBackingSize(800, 600, 1);
	ok(s.width === 800 && s.height === 600, "dpr 1 → 1:1 backing size");
}

// HiDPI dpr = 2 → buffer is doubled.
{
	const s = canvasBackingSize(800, 600, 2);
	ok(s.width === 1600 && s.height === 1200, "dpr 2 → doubled backing size");
}

// Fractional dpr / fractional client → truncated to an integer pixel buffer.
{
	const s = canvasBackingSize(500.5, 300.9, 1.5);
	ok(s.width === Math.floor(500.5 * 1.5), "fractional product floored (width)");
	ok(s.height === Math.floor(300.9 * 1.5), "fractional product floored (height)");
}

// Collapsed / detached element (0 size) → clamped to a 1×1 buffer, never 0.
{
	const s = canvasBackingSize(0, 0, 2);
	ok(s.width === 1 && s.height === 1, "zero client size → min 1×1 buffer");
}

// A negative dimension (e.g. a bogus/collapsed layout) clamps up to 1 while a
// valid sibling dimension is unaffected — never a 0/negative buffer.
{
	const s = canvasBackingSize(-10, 5, 2);
	ok(s.width === 1, "negative product → clamped to 1 (width)");
	ok(s.height === 10, "valid sibling dimension unaffected (height)");
}
