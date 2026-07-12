// normalizeWheelDelta / wheelZoomFactor — pure interpretation of raw WheelEvent
// deltas the view.ts `wheel` handler used inline (legend scroll + zoom-on-wheel).
import { ok } from "./assert";
import {
	normalizeWheelDelta,
	wheelZoomFactor,
	WHEEL_LINE_PX,
	WHEEL_PAGE_PX,
	WHEEL_ZOOM_SENSITIVITY,
} from "../src/interaction/wheel";

// Multipliers match the historical inline values.
ok(WHEEL_LINE_PX === 20, "line multiplier is 20");
ok(WHEEL_PAGE_PX === 300, "page multiplier is 300");
ok(WHEEL_ZOOM_SENSITIVITY === 0.0015, "zoom sensitivity is 0.0015");

// Pixel mode (0) — passes through unchanged.
ok(normalizeWheelDelta(37, 0) === 37, "pixel mode → unchanged");
ok(normalizeWheelDelta(-8, 0) === -8, "pixel mode preserves sign");
// Line mode (1) — ×20.
ok(normalizeWheelDelta(3, 1) === 60, "line mode → ×20");
ok(normalizeWheelDelta(-2, 1) === -40, "line mode preserves sign");
// Page mode (2) — ×300.
ok(normalizeWheelDelta(1, 2) === 300, "page mode → ×300");
// Unknown deltaMode falls back to pixel passthrough.
ok(normalizeWheelDelta(9, 5) === 9, "unknown deltaMode → passthrough");

// Equivalence with the old inline ternary across a grid.
for (const dy of [-300, -12, -1, 0, 1, 12, 300]) {
	for (const mode of [0, 1, 2]) {
		const inline = mode === 1 ? dy * 20 : mode === 2 ? dy * 300 : dy;
		ok(normalizeWheelDelta(dy, mode) === inline, `matches inline at (${dy},${mode})`);
	}
}

// wheelZoomFactor: zero delta → identity factor.
ok(wheelZoomFactor(0) === 1, "no scroll → factor 1");
// Scroll up (negative deltaY) → zoom in (> 1); down → zoom out (< 1).
ok(wheelZoomFactor(-100) > 1, "scroll up → zoom in");
ok(wheelZoomFactor(100) < 1, "scroll down → zoom out");
// Reciprocal symmetry: equal-and-opposite deltas multiply back to 1.
ok(Math.abs(wheelZoomFactor(50) * wheelZoomFactor(-50) - 1) < 1e-12, "opposite deltas are reciprocal");
// Matches the inline Math.exp spelling; sensitivity is a param.
ok(wheelZoomFactor(120) === Math.exp(-120 * 0.0015), "matches inline Math.exp");
ok(wheelZoomFactor(100, 0.003) === Math.exp(-0.3), "custom sensitivity honoured");
