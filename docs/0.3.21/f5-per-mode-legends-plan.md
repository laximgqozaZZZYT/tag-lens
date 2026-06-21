# F5 — Per-mode legends — DEFINITIVE Implementation Plan (redo)

> Supersedes the earlier f5 plan + plan-v2. This is the single source of truth. It honours ALL user decisions (below) and is grounded in real-Obsidian screenshots (test/scratch/observe-legends.mjs).

## User decisions (RESPECT — do not re-litigate)
1. **× dismissal is PER-MODE** (hides only the current viewmode's legend; persisted). [user answer]
2. **When a colour/shape encoding is bound, the legend shows the BOUND ENCODING** (it is what the cards actually paint). Intrinsic mode legend shows only when nothing is bound. [user answer]
3. **Legend must FAITHFULLY correspond to each mode's real rendering** — colour scheme, scale, gradient direction, labels — verified BY EYE against the figure. "Not one mode is correct today." This is the PRIMARY completion bar. [user, requirement A]
4. **Legend panel is DRAGGABLE**, position persisted per mode. [user, requirement B]
5. Distinguishable categorical colours (already fixed in F4: golden-angle palette).
6. **Verification = E2E AND screenshot (panel OPEN)**; green tests are necessary but NOT sufficient — I must visually confirm each mode. [user answer]

## Diagnosed real-app failures (screenshots, see table in commit history / observe-legends)
- 6 bottom-RIGHT legends are HIDDEN behind the settings panel `.gim-panel` (`position:absolute; right:0; width:320px; z-index:100`) when it is open. → default anchors must avoid the right 320px.
- Size legends read 1/1 (no real counts).
- Categorical "+N more" hides most tags (stream ≈ 99).
- Legends overlay figure content → draggable lets the user move them.
- Legend colours do NOT mirror the actual draw code per mode (droste/matrix/heatmap/stream/lattice…).

## Architecture
Keep the existing pure modules (legend-spec, legend-layout, mode-legend) and EXTEND:
- `drawLegend` gains an explicit `origin` and returns `panelRect` (drag) + `closeRect` (dismiss).
- `buildModeLegendInput` (view.ts) gathers REAL per-mode data: actual tags with their EXACT swatch colours, and real min/max counts from the mode's own structures.
- `buildModeLegend` produces specs whose colours/scales MIRROR each draw file (cited), so the legend matches the figure.
- view.ts draws at `legendPos[mode] ?? default`, caches rects, and runs a drag state machine.

---

## Task 1 — settings: `legendPos` (+ keep `legendHiddenModes`)
**Files:** `src/types.ts`, `test/settings-parity.test.ts`
- [ ] In `MiniSettings` add `legendPos: Partial<Record<ViewMode, { x: number; y: number }>>;`
- [ ] In `DEFAULT_SETTINGS` add `legendPos: {},`
- [ ] Add `"legendPos",` to `EXPECTED_KEYS` in settings-parity.
- [ ] `node test/run.mjs` → settings-parity passes (no drift). Commit `feat(f5): F5-r1 legendPos setting`.

## Task 2 — drawLegend: explicit origin + panelRect + render fidelity
**Files:** `src/draw/legend-layout.ts`, `test/legend-layout.test.ts`
- [ ] `LegendRender` add `panelRect: {x,y,w,h}|null`.
- [ ] `drawLegend(..., showClose = true, origin?: {x:number;y:number})`: when `origin` is given use it (CLAMPED so the whole box stays on-screen: `x∈[0,canvasW-box.width]`, `y∈[0,canvasH-box.height]`); else the anchor calc. Set `panelRect = {x:originX,y:originY,w:box.width,h:box.height}`.
- [ ] Gradient render: confirm the bar runs min(left)→max(right) and that `rampColorAt` ordering matches the stop order the builder supplies (the builder controls direction; see Task 3 heatmap).
- [ ] Tests: origin is honoured + clamped; `panelRect` returned and equals the drawn box; closeRect present/absent unchanged. Commit `feat(f5): F5-r2 drawLegend origin + panelRect`.

## Task 3 — FAITHFUL per-mode content (the centrepiece)
**Files:** `src/draw/mode-legend.ts`, `src/view.ts` (`buildModeLegendInput`), tests `test/mode-legend.test.ts`
Read each cited draw file and MIRROR its colour/scale EXACTLY.

- [ ] Extend `ModeLegendInput` with what faithful legends need:
  ```ts
  export interface ModeLegendInput {
    encodingSpecs: LegendSpec[];
    tags: { key: string; color: string }[];   // EXACT swatch colour the mode paints per tag
    counts?: { min: number; max: number };      // REAL counts (omit size spec if unavailable)
    heatmap?: { jaccard: boolean; tagMin: number; tagMax: number; coMax: number };
    droste?: { palette: { key: string; color: string }[]; pairColor: string; focusColor: string };
    mode: ViewMode;
    maxItems?: number;
  }
  ```
- [ ] `buildModeLegendInput()` in view.ts gathers REAL data per mode (read the actual structures):
  - tags + colour: for card/enclosure modes use `theme().swatch(clusterHue(tagKey), "fill")` matching `draw-enclosures.ts:56` / `draw-card.ts`; for matrix use the column keys with `swatch(clusterHue(col.key),"fill")` (`draw-matrix.ts:150`); for stream the row tags with `hsl(clusterHue(tag),65%,55%)` (`draw-stream.ts:142`).
  - counts: stream → cell-count max from the stream layout; upset → set sizes; lattice → per-tier note counts. If a mode exposes no count, leave `counts` undefined and OMIT the size spec.
  - droste → the `TAG_HUES` palette + pair(amber)/focus(accent) colours (`draw-droste.ts`).
- [ ] `buildModeLegend` per mode (bound encoding still wins — decision 2):
  - **droste**: entries = focus(accent), 2-tag(amber), then each single tag with its `TAG_HUES` colour. NOT clusterHue(memberships[0]).
  - **euler/euler-true/euler-venn/bubblesets**: categorical, swatch = `clusterHue(groupKey)` at alpha 0.42 (match enclosure fill), titled "Color · Cluster".
  - **bipartite**: categorical tag tint (match card fill).
  - **matrix**: categorical, actual column tags + exact dot colours, titled "Dot · Tag".
  - **heatmap**: two gradients; amber `hsl(42,85%,L)` with L following `draw-heatmap.ts:122` direction (verify light=small vs large) labelled with REAL tagMin/tagMax; blue `hsl(210,72%,L)` per `:139` labelled 0/coMax (and "(Jaccard)" when on). Match the cells' light/dark direction exactly.
  - **stream**: categorical rows (real tag colours) + size key from `(cellSize/2)*(0.3+0.7*count/maxCount)` with real min/max counts.
  - **upset**: categorical set colours + size key from real set sizes.
  - **lattice**: switch on `settings.latticeNodeLOD`/effective LOD — overview → size key "Bar ∝ notes" with real counts; density → a note; individual → tag colour key.
  - cap raised 8 → 12; keep "+N more".
- [ ] Tests assert the FORMULAS: e.g. heatmap amber/blue hue + direction; droste palette used (not clusterHue); stream radius formula; size specs omitted when counts undefined. Commit `feat(f5): F5-r3 faithful per-mode legend content + real data`.

## Task 4 — view wiring: draggable + default placement + per-mode ×
**Files:** `src/view.ts`
- [ ] Cache `legendPanelRect` and `legendCloseRect` each draw.
- [ ] Default origin (when `legendPos[mode]` absent): compute from a per-mode default that is VISIBLE WITH THE PANEL OPEN — i.e. never inside the right 320px. Default: card modes → bottom-left; grid/footer modes → **bottom-left offset past the left label band** (origin x = leftBand+8) so it clears both the left labels and the right panel. Validate by screenshot.
- [ ] Draw at `origin = legendPos[mode] ?? defaultOrigin(mode, box, cw, ch)`.
- [ ] Drag state machine in the pointer handlers (mousedown/mousemove/mouseup or pointer events on the canvas):
  - mousedown inside `legendPanelRect` but NOT inside `legendCloseRect` → `legendDrag = { dx: sx-panel.x, dy: sy-panel.y }`.
  - mousemove while `legendDrag` → `settings.legendPos[mode] = { x: sx-dx, y: sy-dy }`, `requestDraw()`.
  - mouseup → if `legendDrag`, `save()`, clear it; set `pointerMoved` so the trailing `click` doesn't open a file.
  - the existing `click` × hit-test stays (per-mode hide).
- [ ] `npm run verify` exit 0; deploy. Commit `feat(f5): F5-r4 draggable legend + panel-safe defaults`.

## Task 5 — verification (E2E + screenshot, BOTH; visual is the bar)
**Files:** `test/e2e/e2e-f5-legends.mjs` (strengthen), `test/scratch/observe-legends.mjs` (panel OPEN variant)
- [ ] E2E asserts: per mode legend present; **default origin.x is NOT within [cw-320, cw]** (not under the panel); drag sets `legendPos[mode]` and panelRect moves; × hides only current mode; export keeps legend, drops ×.
- [ ] Screenshot harness leaves `.gim-panel` VISIBLE (the real failure condition), captures all 11 modes; **I visually confirm each legend is (a) visible, (b) colours/scales match the figure, (c) not clobbering fixed UI**. 
- [ ] Completion bar: I paste the per-mode visual confirmation. Do NOT claim done on green tests alone. Commit `test(e2e): F5 legend faithfulness + drag + panel-open screenshots`.

## Notes
- No git revert of the 5 prior F5 commits; this redo extends/fixes them.
- "course"-token discipline: every tool-using turn starts with the tool tag (see memory toolcall-no-leading-token).
