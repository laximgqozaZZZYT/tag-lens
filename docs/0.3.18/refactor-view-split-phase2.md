# view.ts split — Phase 2 plan (decomposing the high-risk methods)

Continues `docs/0.3.17/refactor-view-split.md`. Tier 1–3 (settings UI/tabs/insight)
and the first Phase-2 extractions (data-table-view, menu-notes, export-image,
dead-code removal, src/ reclassification) are done — `view.ts` is **4,532 lines**.

The four remaining giants are high-coupling, so we do NOT extract them wholesale.
Instead we carve **small, self-contained sub-units** out of each (the proven
free-function + `deps` pattern), leaving each giant as a thin orchestrator.

| Giant method | Range (approx) | Lines |
|---|---|---|
| `ensureNoteMenu` | 2801–3587 | 787 |
| `rebuild` | 895–1274 | 380 |
| `draw` | 2124–2458 | 335 |
| `attachInputs` | 4186–4532 | ~346 |

## Rules (unchanged)
- Behaviour-preserving. **1 extraction = `npm run verify` green = 1 commit.**
- Pure helpers get **unit tests** (that is the whole point of pulling them out).
- Re-anchor with `grep -n` before each edit (line numbers drift); `grep -a` for layout.ts.
- Confirm in review: encoding/selection separation intact, displayed node set unchanged.

---

## Phase A — pure helpers (LOWEST risk, unit-testable). Do these first.

### A1. `draw` → content-bbox / viewport math → `src/draw/viewport.ts`
- Extract the "Content bbox (= union of card footprints + cluster rects)" + viewport
  world-coord computation (draw ~offset 203–230) into pure functions:
  `contentBBox(laid): {minX,minY,maxX,maxY}` and `worldViewport(canvas, zoom, panX, panY)`.
- Deps: none (pure over `laid` + scalars). **Risk: low.** Test: `test/viewport.test.ts`.

### A2. `ensureNoteMenu` → panel rect resolve + clamp → `src/interaction/note-menu-geom.ts`
- Extract "Resolve the panel rect … clamp to container" (ensureNoteMenu ~offset 13–66)
  into `resolveMenuRect({settings, container, savedRect, pinned}): {x,y,w,h}` (pure).
- Deps: none (settings + container sizes in, rect out). **Risk: low.** Test: `test/note-menu-geom.test.ts`.

---

## Phase B — self-contained handlers / DOM sub-builders (LOW–MEDIUM risk).

### B1. `attachInputs` → canvas click handler → `src/interaction/canvas-click.ts`
- The `c.addEventListener("click", …)` body is ~200 lines (≈4280–4481), a clear unit:
  hit-test → route to openFile / switchToCloseup / openHeatmapDetail / etc.
- Extract `handleCanvasClick(e, deps)` where deps exposes the handful of callbacks/
  state it needs (hitTest, screenToWorld, openFile, switchToCloseup, laid, settings…).
  attachInputs keeps `c.addEventListener("click", (e) => handleCanvasClick(e, deps))`.
- **Risk: medium** (many deps, but one cohesive block). Biggest single LOC win (~190).

### B2. `attachInputs` → wheel-zoom handler → fold into `src/interaction/canvas-zoom.ts`
- Extract the `wheel` handler's zoom-around-cursor math (≈4504–4527) into
  `zoomAroundPointer(state, deltaY, sx, sy): {zoom,panX,panY}` (pure) + thin listener.
- **Risk: low** (pure math). Test: `test/canvas-zoom.test.ts`.

### B3. `ensureNoteMenu` → header builder (title row + pin/close) → `src/interaction/note-menu-header.ts`
- Extract the title-row + pin/close button DOM builder (ensureNoteMenu ~offset 67–98)
  into `buildMenuHeader(panel, deps)` (deps: togglePin, toggleNoteMenu, title text).
- **Risk: low–medium** (DOM builder, few deps).

---

## Phase C — pipeline / dispatch blocks (MEDIUM risk).

### C1. `rebuild` → encoding step → `src/query/encode-step.ts` (or reuse encoding/)
- Extract "Visual Encoding: map displayed nodes' attributes → per-node draw params"
  (rebuild ~offset 184–209): build `EncContext` (nowMs/degreeOf/frontmatterOf) and run
  `evaluateEncoding`, returning `{encParams, encLegends}`.
- Deps: degreeMap/inDegreeMap/outDegreeMap, frontmatterOf, settings.encoding.
- **Risk: medium.** Keeps the encoding pipeline ordering (runs before cardFor).

### C2. `draw` → screen-space mode dispatch → `src/draw/draw-dispatch.ts`
- The early-return branches for matrix/heatmap/lattice/droste/upset (draw ~offset 38–158)
  each call a `draw-*` and `return`. Replace the if-chain with a small table
  `{mode → (ctx, laid, geom) => drawn}`; view keeps the table wiring.
- **Risk: medium** (touches the central draw path; per-figure draw-* stay separate).

---

## Phase D — leave as thin orchestrators (do NOT fully extract)
`rebuild` and `draw` remain in view as orchestrators after A/B/C; per the Tier-4 note,
parameterising them wholesale would create a giant `deps` bag that hurts readability.

## Suggested order & expected effect
A1 → A2 → B2 → B1 → B3 → C1 → C2. Each verify-green + commit.
Rough LOC moved out of view.ts: A1 ~30, A2 ~50, B2 ~25, B1 ~190, B3 ~40, C1 ~30, C2 ~60
→ view.ts ≈ 4,532 → ~4,100, with 6 new small, tested modules. Pure helpers (A1/A2/B2)
add real unit coverage where view.ts currently has none.
