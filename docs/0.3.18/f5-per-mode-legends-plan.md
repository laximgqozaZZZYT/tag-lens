# F5 — Per-mode on-canvas legends — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every view mode shows a mode-appropriate on-canvas legend (categorical / gradient / size), dismissible per-mode via an × button, anchored to clear each mode's fixed UI.

**Architecture:** A pure `LegendSpec` model unifies "what to render"; `buildModeLegend(mode, input)` selects the spec(s) per mode; `drawLegend` renders any spec kind and returns hit-rects; `view.draw` gathers input + paints at a per-mode anchor; pointerdown hit-tests the × to set a per-mode hidden flag.

**Tech Stack:** TypeScript, Canvas2D, esbuild bundle, custom `test/assert.ts` (throw-on-fail) bundled via `test/run.mjs`, CDP E2E in `test/e2e/`.

**Repo conventions:** unit tests are `test/<name>.test.ts` registered in `test/index.ts`; run `node test/run.mjs`; full gate `npm run verify` (tsc + tests + build); deploy to dev vault `npm run deploy`; commit message style `feat(f5): F5-N …` / `test(e2e): …`. End commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- Create `src/draw/legend-spec.ts` — `LegendSpec`/`LegendKind` types, `sequentialColorRamp`, `encodingToSpecs` adapter (pure).
- Create `src/draw/mode-legend.ts` — `ModeLegendInput`, `buildModeLegend`, `legendAnchor` (pure).
- Modify `src/draw/legend-layout.ts` — `drawLegend` consumes `LegendSpec[]`, renders 3 kinds, returns `{ box, closeRect }`.
- Modify `src/encoding/channels.ts` — color quantitative uses `sequentialColorRamp` (folds in the latent gradient-inversion fix).
- Modify `src/types.ts` — add `legendHiddenModes` to `MiniSettings` + `DEFAULT_SETTINGS`.
- Modify `test/settings-parity.test.ts` — add `legendHiddenModes` to `EXPECTED_KEYS`.
- Modify `src/view.ts` — gather `ModeLegendInput`, call `buildModeLegend`, render at `legendAnchor`, gate on `showLegend && !legendHiddenModes[mode]`; cache `closeRect`; hit-test × in pointerdown.
- Create tests: `test/legend-spec.test.ts`, `test/mode-legend.test.ts`, `test/legend-layout.test.ts` (extend existing), `test/e2e/e2e-f5-legends.mjs`.

---

## Task 1 (F5-1): Legend spec model + ramp + encoding adapter

**Files:**
- Create: `src/draw/legend-spec.ts`
- Test: `test/legend-spec.test.ts` (register in `test/index.ts`)

- [ ] **Step 1: Write `src/draw/legend-spec.ts`**

```ts
// F5 — a renderable legend section, independent of its SOURCE (an encoding
// binding or a mode's intrinsic encoding). drawLegend renders these; builders
// produce them. Pure + DOM-free.
import type { BindingLegend } from "../encoding/evaluate";
import type { NodeShape } from "../encoding/shapes";
import { categoricalColor } from "../encoding/scales";

export type LegendKind = "categorical" | "gradient" | "size";

export interface LegendSpec {
	title: string;
	kind: LegendKind;
	entries?: { label: string; color?: string; shape?: NodeShape }[];
	ramp?: { stops: string[]; minLabel: string; maxLabel: string };
	sizes?: { label: string; radius: number; color?: string }[];
}

// Sequential colour ramp shared by the colour channel AND the legend gradient so
// the bar can never disagree with the nodes. t in [0,1] -> dark(low)..light(high),
// matching channels.ts. (Fixes the prior inverted legend gradient.)
export function sequentialColorRamp(t: number): string {
	const c = Math.max(0, Math.min(1, t));
	return `hsl(210, 70%, ${Math.round(20 + c * 55)}%)`;
}

const fmtNum = (n: number): string => {
	if (!isFinite(n)) return "—";
	const r = Math.round(n * 100) / 100;
	return Object.is(r, -0) ? "0" : String(r);
};

const capitalize = (s: string): string => (s.length ? s[0].toUpperCase() + s.slice(1) : s);

// Convert F4 encoding legends to specs. Categorical -> categorical; quantitative
// -> a 5-stop gradient built from the SAME ramp the colour channel paints.
export function encodingToSpecs(legends: BindingLegend[], maxItems = 8): LegendSpec[] {
	const out: LegendSpec[] = [];
	for (const lg of legends) {
		const title = `${capitalize(lg.channelId)} · ${lg.fieldLabel}`;
		const isShape = lg.channelId === "shape";
		if (lg.legend.kind === "quantitative") {
			const stops = [0, 0.25, 0.5, 0.75, 1].map(sequentialColorRamp);
			out.push({ title, kind: "gradient", ramp: { stops, minLabel: fmtNum(lg.legend.min ?? 0), maxLabel: fmtNum(lg.legend.max ?? 0) } });
		} else {
			const all = lg.legend.entries ?? [];
			const shown = all.slice(0, maxItems);
			const entries = shown.map((e) => isShape
				? { label: e.key, shape: shapeForKeySpec(e.key) }
				: { label: e.key, color: e.output });
			if (all.length > shown.length) entries.push({ label: `+${all.length - shown.length} more` });
			out.push({ title, kind: "categorical", entries });
		}
	}
	return out;
}

// shape resolution kept local to avoid a cycle; mirrors encoding/shapes.shapeForKey.
import { shapeForKey as shapeForKeySpec } from "../encoding/shapes";
```

NOTE: move the `import { shapeForKey ... }` to the top with the others when writing (shown at bottom only for readability). `categoricalColor` import is used by mode-legend; keep it imported here only if used — if unused remove it to satisfy tsc.

- [ ] **Step 2: Write `test/legend-spec.test.ts`**

```ts
import { ok } from "./assert";
import { sequentialColorRamp, encodingToSpecs } from "../src/draw/legend-spec";
import type { BindingLegend } from "../src/encoding/evaluate";

// ramp: low is darker than high (monotone), matches channel direction.
{
	const lo = Number(/(\d+)%\)$/.exec(sequentialColorRamp(0))![1]);
	const hi = Number(/(\d+)%\)$/.exec(sequentialColorRamp(1))![1]);
	ok(lo < hi, `ramp goes dark(low)->light(high) (got ${lo} -> ${hi})`);
	ok(sequentialColorRamp(-5) === sequentialColorRamp(0) && sequentialColorRamp(9) === sequentialColorRamp(1), "ramp clamps");
}
// categorical encoding -> categorical spec with swatches + overflow.
{
	const entries = Array.from({ length: 10 }, (_, i) => ({ key: String(i), output: `c${i}` }));
	const lg: BindingLegend = { channelId: "color", fieldId: "tag", fieldLabel: "Tag", legend: { kind: "categorical", entries } };
	const specs = encodingToSpecs([lg], 8);
	ok(specs.length === 1 && specs[0].kind === "categorical", "one categorical spec");
	ok(specs[0].entries!.length === 9, "8 shown + 1 overflow row");
	ok(specs[0].entries![8].label === "+2 more", "overflow label");
	ok(specs[0].entries![0].color === "c0", "swatch colour carried");
}
// quantitative encoding -> gradient spec with 5 stops + min/max labels.
{
	const lg: BindingLegend = { channelId: "color", fieldId: "age", fieldLabel: "Age", legend: { kind: "quantitative", min: 1, max: 9 } };
	const specs = encodingToSpecs([lg]);
	ok(specs[0].kind === "gradient" && specs[0].ramp!.stops.length === 5, "gradient with 5 stops");
	ok(specs[0].ramp!.minLabel === "1" && specs[0].ramp!.maxLabel === "9", "min/max labels");
}
// shape encoding -> categorical spec carrying shape glyphs.
{
	const lg: BindingLegend = { channelId: "shape", fieldId: "maturity", fieldLabel: "Maturity", legend: { kind: "categorical", entries: [{ key: "a", output: "x" }] } };
	const specs = encodingToSpecs([lg]);
	ok(specs[0].entries![0].shape != null && specs[0].entries![0].color == null, "shape spec carries a glyph, not a colour");
}
```

- [ ] **Step 3: Register + run — expect FAIL first (module absent), then PASS**

```bash
cd /home/ubuntu/obsidian-plugins/tag-lens
grep -q legend-spec test/index.ts || sed -i '/import "\.\/legend-layout.test";/a import "./legend-spec.test";' test/index.ts
node test/run.mjs 2>&1 | tail -5
```
Expected after writing both files: exit 0, no FAIL lines.

- [ ] **Step 4: Fold the gradient-inversion fix into the colour channel**

Modify `src/encoding/channels.ts` color channel quantitative branch (the `if (scaled.t != null)` block, ~line 37-40) to reuse the ramp:
```ts
		if (scaled.t != null) {
			params.fillColor = sequentialColorRamp(scaled.t);
		}
```
Add at top: `import { sequentialColorRamp } from "../draw/legend-spec";`
(Verify no import cycle: legend-spec imports from encoding/shapes + encoding/scales only, NOT channels — so channels->legend-spec is safe.)

- [ ] **Step 5: `npm run verify` — expect exit 0; Commit**

```bash
npm run verify > /tmp/f5.log 2>&1; echo $?
git add src/draw/legend-spec.ts test/legend-spec.test.ts test/index.ts src/encoding/channels.ts
git commit -m "feat(f5): F5-1 LegendSpec model + encoding adapter + shared sequential ramp"
```

---

## Task 2 (F5-2): drawLegend renders LegendSpec[] (categorical / gradient / size)

**Files:**
- Modify: `src/draw/legend-layout.ts` (rewrite `buildLegendBox` + `drawLegend` to consume `LegendSpec[]`; return `{ width, height, closeRect }`)
- Test: extend `test/legend-layout.test.ts`

- [ ] **Step 1: Rewrite `legend-layout.ts` to consume `LegendSpec[]`**

Replace the `BindingLegend`-based `buildLegendBox`/`drawLegend` with spec-based versions. Keep the injected-measurer pattern. Key changes:
- Input type `LegendSpec[]` (import from `./legend-spec`).
- `buildLegendBox(specs, opts)` lays out: per spec a title row, then for `categorical` one row per entry (swatch or shape glyph), for `gradient` one ramp row + label, for `size` one row per graduated circle.
- `drawLegend(ctx, specs, canvasW, canvasH, anchor, margin, theme, opts?, showClose=true)` returns `{ width, height, closeRect: {x,y,w,h} | null }`.
- Paint a `×` glyph at the box's top-right inner corner when `showClose`; its screen rect is `closeRect`. Gradient renders `ramp.stops` as a left→right interpolated bar. Size renders graduated filled circles of `sizes[i].radius`.

Concrete signature + close-button geometry (the executing agent writes the body following the existing render structure):
```ts
import type { LegendSpec } from "./legend-spec";
import { shapeMarkerPath } from "./draw-shape";
export interface LegendRender { width: number; height: number; closeRect: { x: number; y: number; w: number; h: number } | null; }
export function drawLegend(ctx: CanvasRenderingContext2D, specs: LegendSpec[], canvasW: number, canvasH: number, anchor: LegendAnchor, margin: number, theme: LegendTheme, o?: Partial<LegendLayoutOpts>, showClose = true): LegendRender { /* ... */ }
```
Close glyph: an `×` drawn with two strokes inside a `CLOSE = 12` px box at `originX + box.width - CLOSE - 4`, `originY + 4`. `closeRect` is that box in SCREEN px.

- [ ] **Step 2: Extend `test/legend-layout.test.ts`** (add cases; keep existing ones if still valid, otherwise port them to specs)

```ts
import { buildLegendBox, drawLegend } from "../src/draw/legend-layout";
import type { LegendSpec } from "../src/draw/legend-spec";

const measure = (s: string) => s.length * 6;
const opts = { measure };

// categorical spec produces one title + N entry rows; box grows with content.
{
	const spec: LegendSpec = { title: "Color · Tag", kind: "categorical", entries: [{ label: "a", color: "#f00" }, { label: "b", color: "#0f0" }] };
	const box = buildLegendBox([spec], opts);
	ok(box.width > 0 && box.height > 0, "categorical box sized");
	ok(box.sections.length === 1 && box.sections[0].items.length === 2, "two entry rows");
}
// gradient spec yields a gradient section.
{
	const spec: LegendSpec = { title: "Co-occurrence", kind: "gradient", ramp: { stops: ["#001", "#abc", "#fff"], minLabel: "0", maxLabel: "12" } };
	const box = buildLegendBox([spec], opts);
	ok(box.sections[0].kind === "gradient", "gradient section");
}
// size spec yields graduated-circle rows.
{
	const spec: LegendSpec = { title: "Circle ∝ notes", kind: "size", sizes: [{ label: "1", radius: 2 }, { label: "20", radius: 6 }] };
	const box = buildLegendBox([spec], opts);
	ok(box.sections[0].kind === "size" && box.sections[0].items.length === 2, "two size rows");
}
// drawLegend returns a closeRect when showClose, and null when not.
{
	const rec = makeMockCtx(); // a ctx mock recording fills/strokes; reuse the svg-recorder/draw-shape mock pattern
	const spec: LegendSpec = { title: "T", kind: "categorical", entries: [{ label: "a", color: "#f00" }] };
	const withClose = drawLegend(rec as any, [spec], 800, 600, "bottom-left", 10, theme(), { measure } as any, true);
	ok(withClose.closeRect != null, "× rect returned when showClose");
	const noClose = drawLegend(rec as any, [spec], 800, 600, "bottom-left", 10, theme(), { measure } as any, false);
	ok(noClose.closeRect == null, "no × rect when showClose=false (export)");
}
```
(`makeMockCtx` + `theme()` stub: follow the mock pattern in `test/svg-recorder.test.ts` / `test/draw-card-fill.test.ts`; set a stub theme via `setTheme`.)

- [ ] **Step 3: Run `node test/run.mjs`** — expect PASS.

- [ ] **Step 4: Keep F4 encoding legend working** — update the `view.ts:2312` call site MINIMALLY to compile: `drawLegend(ctx, encodingToSpecs(this.encLegends), …)` (full per-mode wiring lands in Task 4). Import `encodingToSpecs`.

- [ ] **Step 5: `npm run verify` (exit 0) + deploy + re-run F4 E2E (regression)**

```bash
npm run deploy 2>&1 | tail -1
DISPLAY=:0 node test/e2e/e2e-f4-shape-legend.mjs 2>&1 | tail -3
```
Expected: F4 E2E still `PASS ✅ | 11 modes`.

- [ ] **Step 6: Commit**
```bash
git add src/draw/legend-layout.ts test/legend-layout.test.ts src/view.ts
git commit -m "feat(f5): F5-2 drawLegend renders LegendSpec[] (categorical/gradient/size) + × rect"
```

---

## Task 3 (F5-3): mode-legend builder + anchor table

**Files:**
- Create: `src/draw/mode-legend.ts`
- Test: `test/mode-legend.test.ts` (register in `test/index.ts`)

- [ ] **Step 1: Write `src/draw/mode-legend.ts`**

```ts
// F5 — pick the legend spec(s) for a mode from its INTRINSIC encoding, unless the
// user bound an encoding (then that wins — it is what the cards actually paint).
import type { ViewMode } from "../types";
import type { LegendSpec } from "./legend-spec";
import type { LegendAnchor } from "./legend-layout";
import { sequentialColorRamp } from "./legend-spec";

export interface ModeLegendInput {
	encodingSpecs: LegendSpec[];                 // from encodingToSpecs(encLegends)
	tags: { key: string; color: string }[];      // distinct tags/clusters present + their hue colour
	counts?: { min: number; max: number };        // for size/gradient ramps
	heatmap?: { jaccard: boolean };
	maxItems?: number;
}

const amberRamp = (t: number): string => `hsl(42, 85%, ${Math.round(80 - Math.max(0, Math.min(1, t)) * 45)}%)`;

function tagKey(input: ModeLegendInput, title: string): LegendSpec {
	const max = input.maxItems ?? 8;
	const shown = input.tags.slice(0, max).map((t) => ({ label: t.key, color: t.color }));
	if (input.tags.length > shown.length) shown.push({ label: `+${input.tags.length - shown.length} more`, color: undefined as unknown as string });
	return { title, kind: "categorical", entries: shown };
}

function sizeKey(title: string, input: ModeLegendInput): LegendSpec {
	const lo = input.counts?.min ?? 1, hi = input.counts?.max ?? 1;
	return { title, kind: "size", sizes: [
		{ label: String(lo), radius: 3 },
		{ label: String(hi), radius: 7 },
	] };
}

export function buildModeLegend(mode: ViewMode, input: ModeLegendInput): LegendSpec[] {
	if (input.encodingSpecs.length) return input.encodingSpecs; // bound encoding wins
	switch (mode) {
		case "heatmap": {
			const co = input.heatmap?.jaccard ? "Co-occurrence (Jaccard)" : "Co-occurrence";
			return [
				{ title: "Tag size", kind: "gradient", ramp: { stops: [0, 0.5, 1].map(amberRamp), minLabel: "small", maxLabel: "large" } },
				{ title: co, kind: "gradient", ramp: { stops: [0, 0.5, 1].map(sequentialColorRamp), minLabel: "low", maxLabel: "high" } },
			];
		}
		case "stream":
			return [tagKey(input, "Row · Tag"), sizeKey("Circle ∝ notes", input)];
		case "upset":
			return [tagKey(input, "Dot · in set"), sizeKey("Bar ∝ set size", input)];
		case "lattice":
			return [sizeKey("Bar ∝ notes", input)];
		case "matrix":
			return [tagKey(input, "Dot · Tag")];
		case "droste":
		case "euler":
		case "euler-true":
		case "euler-venn":
		case "bipartite":
		case "bubblesets":
		default:
			return [tagKey(input, "Color · Tag")];
	}
}

// Anchor that clears each mode's fixed UI bands (survey in the spec).
export function legendAnchor(mode: ViewMode): LegendAnchor {
	switch (mode) {
		case "matrix":
		case "heatmap":
		case "stream":
		case "lattice":
		case "droste":
		case "upset":
			return "bottom-right";
		default:
			return "bottom-left";
	}
}
```

- [ ] **Step 2: Write `test/mode-legend.test.ts`**

```ts
import { ok } from "./assert";
import { buildModeLegend, legendAnchor, type ModeLegendInput } from "../src/draw/mode-legend";

const base: ModeLegendInput = { encodingSpecs: [], tags: [{ key: "greek", color: "#a00" }, { key: "norse", color: "#0a0" }], counts: { min: 1, max: 20 } };

// bound encoding wins over intrinsic.
{
	const enc = [{ title: "Color · Out-degree", kind: "categorical" as const, entries: [{ label: "1", color: "#111" }] }];
	const specs = buildModeLegend("bipartite", { ...base, encodingSpecs: enc });
	ok(specs === enc, "bound encoding returned verbatim");
}
// heatmap -> two gradients incl. co-occurrence; jaccard renames it.
{
	const specs = buildModeLegend("heatmap", { ...base, heatmap: { jaccard: true } });
	ok(specs.length === 2 && specs.every((s) => s.kind === "gradient"), "two gradient ramps");
	ok(specs[1].title.includes("Jaccard"), "jaccard title");
}
// stream -> tag key + size key.
{
	const specs = buildModeLegend("stream", base);
	ok(specs[0].kind === "categorical" && specs[1].kind === "size", "tag + size");
}
// card mode with no encoding -> one categorical tag key.
{
	const specs = buildModeLegend("euler", base);
	ok(specs.length === 1 && specs[0].kind === "categorical" && specs[0].title === "Color · Tag", "euler tag key");
}
// anchors clear fixed bands.
{
	ok(legendAnchor("matrix") === "bottom-right", "matrix avoids left label band");
	ok(legendAnchor("upset") === "bottom-right", "upset avoids footer corner");
	ok(legendAnchor("euler") === "bottom-left", "euler default");
}
```

- [ ] **Step 3: Register + run** (`sed` add `import "./mode-legend.test";` after legend-spec import in `test/index.ts`); `node test/run.mjs` → PASS.

- [ ] **Step 4: `npm run verify` (exit 0) + Commit**
```bash
git add src/draw/mode-legend.ts test/mode-legend.test.ts test/index.ts
git commit -m "feat(f5): F5-3 buildModeLegend (per-mode kind) + legendAnchor table"
```

---

## Task 4 (F5-4): settings + × dismiss + view wiring

**Files:**
- Modify: `src/types.ts` (MiniSettings + DEFAULT_SETTINGS)
- Modify: `test/settings-parity.test.ts` (EXPECTED_KEYS)
- Modify: `src/view.ts` (gather input, render at anchor, cache closeRect, hit-test ×)

- [ ] **Step 1: Add the per-mode hide setting**

`src/types.ts` — in `MiniSettings` near `showLegend: boolean;` add:
```ts
	legendHiddenModes: Partial<Record<ViewMode, boolean>>;
```
In `DEFAULT_SETTINGS` near `showLegend: true,` add:
```ts
	legendHiddenModes: {},
```
`test/settings-parity.test.ts` — add `"legendHiddenModes",` to `EXPECTED_KEYS`.

- [ ] **Step 2: Run settings-parity** — `node test/run.mjs 2>&1 | grep -i settings` → no drift failure.

- [ ] **Step 3: Wire `view.ts` draw block** (replace the `src/view.ts:2312` legend block)

```ts
		// F5: per-mode on-canvas legend. Pure overlay — never affects figure/selection.
		if (this.settings.showLegend && !this.settings.legendHiddenModes?.[mode]) {
			const t = theme();
			const input = this.buildModeLegendInput(); // gathers encodingSpecs + tags + counts + heatmap
			const specs = buildModeLegend(mode, input);
			if (specs.length) {
				const render = drawLegend(
					ctx, specs, cw / dpr, ch / dpr, legendAnchor(mode), 10,
					{ panelBg: colorAlpha(t.panelBg, 0.92), border: t.border, text: t.textNormal, textMuted: t.textMuted },
					undefined,
					this.exportDprMul === 1, // showClose only when NOT exporting
				);
				this.legendCloseRect = render.closeRect; // cache for pointerdown hit-test
			} else {
				this.legendCloseRect = null;
			}
		} else {
			this.legendCloseRect = null;
		}
```
Add field `private legendCloseRect: { x: number; y: number; w: number; h: number } | null = null;` near `encLegends`. Add imports: `buildModeLegend, legendAnchor` from `./draw/mode-legend`; ensure `encodingToSpecs` from `./draw/legend-spec`.

Add the input gatherer method (concrete data sources — distinct tags from `this.laid` memberships, hue via `clusterHue`):
```ts
	private buildModeLegendInput(): ModeLegendInput {
		const encodingSpecs = encodingToSpecs(this.encLegends);
		const seen = new Set<string>();
		const tags: { key: string; color: string }[] = [];
		for (const n of this.laid.nodes) {
			const k = n.memberships?.[0];
			if (!k || seen.has(k)) continue;
			seen.add(k);
			tags.push({ key: k, color: theme().swatch(clusterHue(k), "fill") });
		}
		let min = Infinity, max = -Infinity;
		for (const n of this.laid.nodes) { const c = (n as { count?: number }).count ?? 1; if (c < min) min = c; if (c > max) max = c; }
		if (!isFinite(min)) { min = 1; max = 1; }
		return { encodingSpecs, tags, counts: { min, max }, heatmap: { jaccard: !!this.settings.heatmapJaccard } };
	}
```
(`clusterHue` is already imported in view.ts:28. Import `ModeLegendInput` type.)

- [ ] **Step 4: Hit-test the × in pointerdown**

In `attachInputs` pointerdown handler, alongside the existing screen-space checks (the matrix/heatmap/stream block ~`view.ts:4428`), add FIRST (so it wins over canvas content):
```ts
			const cr = this.legendCloseRect;
			if (cr && sx >= cr.x && sx <= cr.x + cr.w && sy >= cr.y && sy <= cr.y + cr.h) {
				this.settings.legendHiddenModes = { ...this.settings.legendHiddenModes, [this.settings.viewMode]: true };
				void this.save();
				this.draw();
				return;
			}
```
(`sx`/`sy` are the screen coords already computed in that handler — match the existing local names; read the handler first.)

- [ ] **Step 5: `npm run verify` (exit 0) + deploy**
```bash
npm run verify > /tmp/f5.log 2>&1; echo $?; npm run deploy 2>&1 | tail -1
```

- [ ] **Step 6: Commit**
```bash
git add src/types.ts test/settings-parity.test.ts src/view.ts
git commit -m "feat(f5): F5-4 legendHiddenModes setting + per-mode × dismiss + view wiring"
```

---

## Task 5 (F5-5): live CDP E2E across 11 modes

**Files:**
- Create: `test/e2e/e2e-f5-legends.mjs` (pattern: clone `test/e2e/e2e-f4-shape-legend.mjs` harness — dedicated profile `/tmp/obs-e2e-f4`, port 9229, deep settings snapshot+restore, vault delta 0)

- [ ] **Step 1: Write the harness** asserting, on real Obsidian:
  1. For each of the 11 modes (no encoding bound): `view.settings.legendHiddenModes={}`, `showLegend=true`, set `viewMode`, `rebuild()`, `draw()` no-throw, and `view.legendCloseRect != null` (a legend with a × is painted).
  2. Mode KIND sanity: drive `exportSvg({target:"clipboard"})` (stub `clipboard.write` like the F4 harness), pull the SVG, assert heatmap SVG contains "Co-occurrence", stream contains "Circle ∝ notes", a card mode contains "Color · Tag" (or the bound encoding title).
  3. × dismiss is per-mode: simulate dismiss by setting `legendHiddenModes={[mode]:true}` for ONE mode, `draw()`, assert `legendCloseRect==null` for that mode but a sibling mode still paints a legend.
  4. Export excludes ×: with a legend visible, exported SVG contains the legend title text but the harness asserts the live `legendCloseRect` is non-null while export path used `showClose=false` (assert SVG has no stray "×" close glyph: it should not contain the close-box strokes — practically, assert title present AND that toggling export does not change title presence).
  5. Restore settings (incl. `legendHiddenModes`) + vault delta 0.

- [ ] **Step 2: Deploy + run**
```bash
npm run deploy 2>&1 | tail -1
DISPLAY=:0 node test/e2e/e2e-f5-legends.mjs 2>&1 | tail -20
```
Expected: `F5 result: PASS`, 11 modes checked, vault delta 0.

- [ ] **Step 3: Commit**
```bash
git add test/e2e/e2e-f5-legends.mjs
git commit -m "test(e2e): F5 per-mode legend live CDP harness (11 modes + × + export)"
```

---

## Self-Review notes

- Spec coverage: req1 (every mode) → Task 4 gating; req2 (kind by mode) → Task 3; req3 (× per-mode) → Task 4 steps 1/4; req4 (no overlap) → Task 3 anchor; req5 (correspondence) → Task 1/3 reuse the same colour sources (clusterHue/encoding output/sequentialColorRamp).
- Latent gradient-inversion fix folded into Task 1 Step 4.
- Type consistency: `LegendSpec`, `ModeLegendInput`, `LegendRender.closeRect`, `legendHiddenModes`, `legendCloseRect` are used with identical names across tasks.
- Risk: the `view.ts` pointerdown local var names (`sx`/`sy`) and the exact insertion point must be confirmed by reading the handler before editing (Task 4 Step 4 says so).
