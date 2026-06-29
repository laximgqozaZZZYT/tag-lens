# F2 — first-class Scatter mode (plan)

Status: **plan** (no code yet). Backlog item: `ralph/BACKLOG.md` → F2.

## Goal

A dedicated **Scatter** view mode: every displayed note placed once on a 2D
Cartesian plane whose X / Y are bound to **quantitative** attributes (e.g.
`x = degree`, `y = ageDays`), with the existing zoom/pan and the existing
axis grid + ticks. One dot (card) per note; no tag boxes, no enclosures.

## What already exists (do NOT rebuild)

The axis machinery is already present — today it is an **encoding overlay**, not a
mode:

- **`src/layout/axis-layout.ts`** — pure `axisLayout(nodes, ctx, opts)` returns
  `{ positions, axes: {x?,y?} }`. Handles categorical *and* quantitative axes
  (linear / log / quantile ticks via `prepareScale`). Unit-tested in
  `test/axis-layout.test.ts`. **This is the layout engine for scatter.**
- **`src/view.ts` `applyAxisLayout()`** (~line 1356) — reads the `axisX` / `axisY`
  *encoding channels*, calls `axisLayout`, re-centres node `x/y`, shifts the
  `AxisSpec` into world space, and stores `this.laid.axes`. It is **gated to
  euler / bubblesets / droste** and only fires when those channels are bound.
- **`src/draw/draw-helpers.ts`** draws `laid.axes` (gridlines + tick labels) for
  card modes; **`src/draw/draw-droste.ts:519`** does it via `drawAxisGrid`.
- Zoom/pan, the world→screen transform, and `drawCard` already serve every card
  mode — scatter reuses them unchanged.

So F2 is **promotion, not invention**: expose this as a mode where X *and* Y are
quantitative by default and always on, instead of an opt-in overlay buried in the
encoding panel.

## Design decisions

1. **Mode id `"scatter"`**, `perspective: "panorama"`, start `experimental: true`
   (segregated in the picker until E2E-validated). Add to the `ViewMode` union
   (`src/types.ts`) and the `VIEW_MODES` array.
2. **Layout** = card layout (one card per node, no clustering) + `axisLayout`.
   Reuse the euler/bubblesets card path rather than writing a new layout: the
   simplest seam is to (a) build the flat node set with a card-sized slot, then
   (b) run the axis placement. Decide in the layout sub-step whether to add a
   `layoutScatter` branch in `src/layout/layout.ts` (~line 339) or to route
   scatter through the existing card layout with clustering disabled.
3. **Axis bindings for scatter come from the mode, not the encoding channels.**
   `applyAxisLayout` currently keys off `axisX`/`axisY` encoding bindings. For
   scatter we want sensible defaults (e.g. x=degree, y=ageDays) that the user can
   re-bind. Keep using the `axisX`/`axisY` channel bindings as the source of
   truth, but in scatter mode **default them on** and surface them in a dedicated
   Scatter settings section (don't make the user discover the encoding panel).
4. **No enclosures / no edges by default** in scatter (a scatter of dots). Wire
   the applicability table (`src/visual/display-applicability.ts`) so
   `showEnclosures` is false-by-default-irrelevant; keep `showEdges` available
   (relation lines between dots can be useful) — confirm during the draw step.
5. **Invariant:** scatter never changes *which* notes are shown — multi-value
   attributes (tags) place a node once at its representative value, same rule as
   `axisLayout` today. Empty-on-an-axis notes get the documented fallback band.

## Sub-steps (one per Ralph iteration, verify-green each)

1. **[plan]** this document. *(done — see backlog)*
2. **Types + picker.** Add `"scatter"` to `ViewMode` and a `VIEW_MODES` entry
   (`experimental: true`, panorama). Update `partitionViewModePicker` test if it
   locks the mode set. No layout/draw yet → mode renders empty/fallback; verify
   green. (Smallest safe first slice.)
3. **Layout dispatch.** Make `src/layout/layout.ts` produce a flat card layout for
   `viewMode === "scatter"` (no clusters). Add a layout unit test asserting one
   node per displayed note and no clusters.
4. **Axis placement on for scatter.** In `applyAxisLayout`, treat `"scatter"` as a
   card mode and default `axisX`/`axisY` to quantitative bindings when unset.
   Unit-test the defaulting helper (pure) in isolation.
5. **Draw.** Route scatter through the card `drawBodyTile` + `laid.axes` grid;
   confirm dots + axes render. Add/extend a render-smoke test (mock ctx) à la
   `bubblesets-render-smoke`.
6. **Settings.** A Scatter section in the Display/Encode panel: X-attr / Y-attr
   pickers + scale (linear/log/quantile) reusing existing encoding controls;
   default-mode merge guard in `main.ts` if needed.
7. **Applicability + per-mode guards.** Update `display-applicability.ts` and the
   `draw()` `!laid.upset` / guard table so scatter shows only the toggles it
   honours (keep the matrix in sync — AGENTS gotcha #6).
8. **E2E.** A CDP scenario (`test/e2e/`) that switches to scatter, binds X/Y, and
   verifies *reflection* (laid node count unchanged, `laid.axes.x/y` populated,
   dots at distinct quantitative positions) — not just "no exception".

## Risks / watch-items

- **NUL bytes in `layout.ts`** — search with `grep -a` (AGENTS gotcha #1).
- Don't let the new mode silently drop attribute propagation on `nodes.push`
  (AGENTS gotcha #5) or status/freshness encoding breaks.
- Keep `applyAxisLayout`'s world-centre `shiftSpec` math intact — it is what keeps
  axes aligned with cards under pan/zoom.
- The `axisX`/`axisY` channels are shared with the existing overlay on
  euler/bubblesets; defaulting-on for scatter must not change their behaviour in
  those modes.
