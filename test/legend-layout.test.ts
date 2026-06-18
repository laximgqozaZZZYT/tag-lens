// F5-2 — on-canvas legend layout from LegendSpec[]. Verifies sizing, section
// kinds (categorical / gradient / size), item placement, and drawLegend's
// close-rect contract. DOM-free: a fixed-width measurer + a recording mock ctx.
import { ok } from "./assert";
import { buildLegendBox, drawLegend, type LegendTheme } from "../src/draw/legend-layout";
import type { LegendSpec } from "../src/draw/legend-spec";

// Fixed-width measurer: 6 px per char (deterministic, no DOM).
const measure = (s: string) => s.length * 6;

const themeStub: LegendTheme = { panelBg: "#111", border: "#222", text: "#fff", textMuted: "#999" };

// Minimal CanvasRenderingContext2D stand-in covering everything drawLegend calls.
function mockCtx(): CanvasRenderingContext2D {
	const c = {
		fillStyle: "" as string | CanvasGradient | CanvasPattern,
		strokeStyle: "" as string | CanvasGradient | CanvasPattern,
		lineWidth: 1,
		font: "",
		textAlign: "start" as CanvasTextAlign,
		textBaseline: "alphabetic" as CanvasTextBaseline,
		save() {},
		restore() {},
		beginPath() {},
		moveTo() {},
		lineTo() {},
		arc() {},
		closePath() {},
		rect() {},
		fill() {},
		stroke() {},
		fillRect() {},
		strokeRect() {},
		fillText() {},
		measureText(t: string) { return { width: t.length * 6 } as TextMetrics; },
	};
	return c as unknown as CanvasRenderingContext2D;
}

// categorical: one title + N entry rows.
{
	const spec: LegendSpec = { title: "Color · Tag", kind: "categorical", entries: [{ label: "a", color: "#f00" }, { label: "b", color: "#0f0" }] };
	const box = buildLegendBox([spec], { measure });
	ok(box.sections.length === 1 && box.sections[0].items.length === 2, "two entry rows");
	ok(box.width > 0 && box.height > 0, "sized");
	ok(box.sections[0].items[0].color === "#f00", "entry carries colour");
	ok(box.sections[0].items[1].y > box.sections[0].items[0].y, "rows stack downward");
}

// categorical with shape glyph + a "+N more" no-colour row.
{
	const spec: LegendSpec = { title: "Shape · M", kind: "categorical", entries: [{ label: "p", shape: "triangle" }, { label: "+3 more" }] };
	const box = buildLegendBox([spec], { measure });
	ok(box.sections[0].items[0].shape === "triangle", "shape glyph carried");
	ok(box.sections[0].items[1].color === undefined && box.sections[0].items[1].shape === undefined, "overflow row is plain");
}

// gradient section recorded.
{
	const spec: LegendSpec = { title: "Co-occurrence", kind: "gradient", ramp: { stops: ["#001", "#abc", "#fff"], minLabel: "0", maxLabel: "12" } };
	const box = buildLegendBox([spec], { measure });
	ok(box.sections[0].kind === "gradient", "gradient section");
	ok(box.sections[0].ramp?.minLabel === "0" && box.sections[0].ramp?.maxLabel === "12", "ramp recorded");
	ok(box.sections[0].items.length === 1 && box.sections[0].items[0].label.includes("12"), "min … max row");
}

// size rows.
{
	const spec: LegendSpec = { title: "Circle ∝ notes", kind: "size", sizes: [{ label: "1", radius: 2 }, { label: "20", radius: 6 }] };
	const box = buildLegendBox([spec], { measure });
	ok(box.sections[0].kind === "size" && box.sections[0].items.length === 2, "two size rows");
	ok(box.sections[0].items[0].radius === 2 && box.sections[0].items[1].radius === 6, "radii carried");
}

// Empty input → zero-ish box, no sections.
{
	const box = buildLegendBox([], { measure });
	ok(box.sections.length === 0, "no sections for empty specs");
	ok(box.height >= 0 && box.width >= 0, "non-negative dims");
}

// Two sections stack: the second starts below the first.
{
	const specs: LegendSpec[] = [
		{ title: "A", kind: "categorical", entries: [{ label: "a", color: "#f00" }] },
		{ title: "B", kind: "categorical", entries: [{ label: "b", color: "#0f0" }] },
	];
	const box = buildLegendBox(specs, { measure });
	ok(box.sections.length === 2, "two sections");
	ok(box.sections[1].titleY > box.sections[0].items[0].y, "second section below the first");
}

// drawLegend returns a closeRect when showClose, null when not; empty specs -> null.
{
	const spec: LegendSpec = { title: "T", kind: "categorical", entries: [{ label: "a", color: "#f00" }] };
	const withClose = drawLegend(mockCtx(), [spec], 800, 600, "bottom-left", 10, themeStub, undefined, true);
	ok(withClose.closeRect != null, "× rect when showClose");
	ok(withClose.closeRect!.w === 12 && withClose.closeRect!.h === 12, "close rect is 12px");
	const noClose = drawLegend(mockCtx(), [spec], 800, 600, "bottom-left", 10, themeStub, undefined, false);
	ok(noClose.closeRect == null, "no × rect when showClose=false");
	const empty = drawLegend(mockCtx(), [], 800, 600, "bottom-left", 10, themeStub, undefined, true);
	ok(empty.closeRect == null && empty.width === 0, "empty specs -> nothing");
}

// drawLegend renders all three kinds without throwing (gradient + size + shape paths).
{
	const specs: LegendSpec[] = [
		{ title: "C", kind: "categorical", entries: [{ label: "x", shape: "square" }, { label: "+2 more" }] },
		{ title: "G", kind: "gradient", ramp: { stops: ["#000", "#fff"], minLabel: "0", maxLabel: "9" } },
		{ title: "S", kind: "size", sizes: [{ label: "1", radius: 2 }, { label: "9", radius: 6 }] },
	];
	const r = drawLegend(mockCtx(), specs, 800, 600, "top-right", 10, themeStub, undefined, true);
	ok(r.width > 0 && r.height > 0 && r.closeRect != null, "renders all kinds + close rect");
}

// panelRect is returned and matches the drawn box; anchor bottom-left places it.
{
	const spec: LegendSpec = { title: "T", kind: "categorical", entries: [{ label: "a", color: "#f00" }] };
	const r = drawLegend(mockCtx(), [spec], 800, 600, "bottom-left", 10, themeStub, undefined, true);
	ok(r.panelRect != null, "panelRect returned");
	ok(r.panelRect!.w === r.width && r.panelRect!.h === r.height, "panelRect matches box size");
	ok(r.panelRect!.x === 10, "bottom-left anchor → x = margin");
	ok(r.closeRect!.x >= r.panelRect!.x && r.closeRect!.x + r.closeRect!.w <= r.panelRect!.x + r.panelRect!.w, "× sits inside the panel");
}

// explicit origin wins and is CLAMPED so the whole panel stays on-screen.
{
	const spec: LegendSpec = { title: "T", kind: "categorical", entries: [{ label: "abc", color: "#f00" }] };
	const mid = drawLegend(mockCtx(), [spec], 800, 600, "bottom-left", 10, themeStub, undefined, true, { x: 200, y: 150 });
	ok(mid.panelRect!.x === 200 && mid.panelRect!.y === 150, "origin honoured when on-screen");
	const off = drawLegend(mockCtx(), [spec], 800, 600, "bottom-left", 10, themeStub, undefined, true, { x: 100000, y: 100000 });
	ok(off.panelRect!.x === 800 - off.width && off.panelRect!.y === 600 - off.height, "origin clamped to keep panel on-screen");
	const neg = drawLegend(mockCtx(), [spec], 800, 600, "bottom-left", 10, themeStub, undefined, true, { x: -50, y: -50 });
	ok(neg.panelRect!.x === 0 && neg.panelRect!.y === 0, "negative origin clamped to 0");
}
