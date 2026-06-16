# view.ts split — Phase 2 plan (all-low-risk decomposition)

Continues `docs/0.3.17/refactor-view-split.md`. Tier 1–3 + the first Phase-2 work
(data-table-view, menu-notes, export-image, dead-code removal, src/ reclassification)
are done — `view.ts` was **4,532 lines**.

## STATUS — L1–L7 COMPLETE (2026-06-16), view.ts now 4,443 lines
Two tasks turned out to target code that was already extracted or dead — the
kaizen-correct action there was removal, not extraction (confirmed against real
code per AGENTS.md "don't trust the plan/grep"):
- **L1** (a5175fa) — DEAD-CODE REMOVAL. draw()'s contentBBox/worldViewport had
  zero readers after the world-map tiling was reduced to a single revolution
  (they were `void`-ed under a stale comment). Removed ~40 LOC.
- **L2** (cc6241a) — extracted `note-menu-geom.ts`: defaultMenuRect /
  resolveMenuRect / pinnedMenuWidth + NOTE_MENU_MIN. (clampRect was already
  in note-menu.ts.) + test/note-menu-geom.test.ts.
- **L3** (6178108) — extracted `zoom-math.ts` zoomAroundPointer (wheel + zoomBy).
- **L4** (6f98570) — added `zoom-math.ts` fitTransform (fitToRect).
- **L5+L6** (b116da4) — extracted `hit-modes.ts`
  hitMatrixLine/hitMatrixCol/hitHeatmapCell (combined; same module + test).
- **L7** (a407be0) — DEAD-CODE REMOVAL. positionTip was already extracted
  (highlight.ts positionTipFn); positionDetail never existed; detailEl/closeDetail
  were vestigial (detailEl never assigned — detail overlays replaced by
  switchToCloseup). Removed field + method + 6 no-op call sites.
- **L8** (drosteHitTest pure core) — NOT done; was always optional/medium-risk.

Net: 3 new pure modules (148 LOC) + 3 new test files (218 LOC, ~50 assertions),
view.ts −89 lines, and new unit coverage on previously-untested geometry. All
commits verify-green. Remaining backlog below (features F1–F4, N2) is untouched.

---
## Original plan (kept for reference)

## Principle (revised): extract PURE helpers, not coupled glue
The four giants (`ensureNoteMenu` 787, `rebuild` 380, `draw` 335, `attachInputs` 346)
are coupled to `this`. Extracting a whole method (e.g. the ~200-line click handler)
just relocates a large `deps` bag — that is NOT low-risk and hurts readability (the
Tier-4 caution). So we extract only the **pure, testable sub-units** they call —
coordinate/transform math, geometry, rect resolution — each with a **unit test**, and
leave the action/orchestration glue in view as thin wrappers. Every task below is
**low-risk** (pure function, no behaviour change, added test coverage).

Investigated `this`-usage: these helpers touch only a small fixed set
(`laid`, `zoom/panX/panY`, `canvas` size, a couple of selection flags) — i.e. they
are already pure-over-arguments and just need the arguments passed explicitly.

## Rules
- Behaviour-preserving. **1 extraction = `npm run verify` green = 1 commit.**
- Each pure helper ships with a unit test registered in `test/index.ts`.
- The view method becomes a thin wrapper calling the new free function (or inlines the call).
- Re-anchor with `grep -n` (line numbers drift); `grep -a` for layout.ts.
- Review invariant: displayed node set unchanged; selection ⊥ encoding/attributes.

---

## Low-risk tasks (each = pure helper + test + thin wrapper)

### L1. `draw` → `src/draw/viewport.ts`
`contentBBox(laid): {minX,minY,maxX,maxY}` (union of card footprints + cluster rects)
and `worldViewport(canvasW, canvasH, t): {left,top,right,bottom}` where
`t = {zoom,panX,panY}`. From draw ~offset 203–230. Test: `test/viewport.test.ts`.

### L2. `ensureNoteMenu` → `src/interaction/note-menu-geom.ts`
`resolveMenuRect({settings, containerW, containerH, savedRect, pinned}): {x,y,w,h}`
— the rect priority + clamp-to-container (ensureNoteMenu ~offset 13–66). Pure.
Test: `test/note-menu-geom.test.ts`.

### L3. `attachInputs` wheel → `src/interaction/zoom-math.ts`
`zoomAroundPointer(t, factor, sx, sy): {zoom,panX,panY}` — keep the cursor anchored
while zooming (wheel handler ~4504–4527, and reused by `zoomBy`). Pure.
Test: `test/zoom-math.test.ts`.

### L4. `fitToRect`/`fitToView`/`zoomBy` → `src/interaction/zoom-math.ts` (same module)
`fitTransform(worldRect, canvasW, canvasH, padFrac): {zoom,panX,panY}` — the fit math
(`fitToRect` body, ~1757). The view methods keep the side effects (assign + requestDraw).
Pure. Add to `test/zoom-math.test.ts`.

### L5. `attachInputs`/click → matrix hit math → `src/interaction/hit-modes.ts`
`matrixColAt(matrix, t, canvasW, sx): number` and
`matrixLineAt(matrix, matrixLines, t, sy): number` (view methods at ~3796/3806;
deps: laid.matrix, matrixLines, zoom/pan, canvas). Pure. Test: `test/hit-modes.test.ts`.

### L6. click → heatmap hit math → `src/interaction/hit-modes.ts` (same module)
`heatmapCellAt(heatmap, t, canvasW, canvasH, sel, sx, sy): {i,j}|null` (view ~3817;
`sel` carries the pinned-column flags it reads). Pure. Add to `test/hit-modes.test.ts`.

### L7. hover/tip positioning → `src/interaction/tip-geom.ts`
`positionTip(canvasRect, marqueeActive, sx, sy, tipSize): {left,top}` and the detail
overlay clamp (`positionTip` ~4172, `positionDetail`). Pure geometry. Test: `test/tip-geom.test.ts`.

### L8. (stretch) `drosteHitTest` pure core → `src/interaction/hit-modes.ts`
Only if the `drosteHit` cache can be passed in cleanly; else defer (medium). Not required.

## Order & effect
L1 → L2 → L3 → L4 → L5 → L6 → L7 (L8 optional). Each verify-green + commit.
LOC out of view.ts: small individually (~20–60 each) but each ADDS unit coverage to
currently-untested geometry, and shrinks the giant methods' pure surface so the
remaining glue is obviously just orchestration.

## Deliberately NOT done (cannot be made low-risk)
- Extracting the click handler / event listeners wholesale → large deps bag, not low-risk.
- Converting `draw`'s mode dispatch to a table, or parameterising `rebuild`/`draw` →
  central-path / giant-deps risk. Keep them as thin orchestrators (Tier-4 stance).

---

## Broader backlog — DO NOT LOSE (track alongside this plan)
See memory `kaizen-backlog-0.3.18`. Beyond R4:
- **F1** Encoding/Lens preset import/export + bundled presets (acquisition driver).
- **F2** first-class scatter mode (2D quantitative axes + zoom/pan; builds on axis-layout — the L1/L3/L4 viewport+zoom helpers feed this).
- **F3** SVG / clipboard-copy export (PNG already shipped).
- **F4** Encoding channel `shape` + on-canvas legend rendering.
- **N2** plugin re-enable re-runs `registerView` → "existing view type" warning (`src/main.ts`); low priority, benign.

## Design invariants to preserve in EVERY future change
- **Selection ⊥ encoding/attributes**: encoding/axis bindings and attribute propagation
  never change WHICH notes appear. closeup `focusNodeIds` is a query-layer (parser.ts) concern.
- **Per-figure separation is intentional**: do NOT merge per-mode `draw-*`/layout logic for DRY (R5 was rejected on this basis).
- **`npm run verify` is the merge gate**; tsc is the only type gate (esbuild/test don't type-check).
- New settings field ⇒ update `MiniSettings` + `DEFAULT_SETTINGS` (guarded by `settings-parity.test`).
- Layout must propagate `mtime/fmMaturity/ageDays` to every note node (guarded by `attribute-propagation.test`).
