# Handoff — Icon Gallery (droste) full custom-axis Cartesian layout

## Goal
Make Icon Gallery (`droste`) a first-class custom-axis Cartesian mode like the card
modes: bind **Position X / Position Y** (Encode tab) to attributes (e.g. x=tag, y=links)
so each note's icon is re-placed by axis, with **variable-width gridlines + attribute labels**.

## Why this is a handoff (not done inline)
- droste is a **bespoke renderer**: it tiles `GalleryCell{id,label,col,row}` on an integer
  grid; `draw-droste.ts` derives screen pos, hit-test, LOD and clip-rects from `(col,row)` via
  `byPos(col,row)=cells[row*cols+col]`. Axis placement needs that grid logic reworked.
- At handoff time `view.ts` / `axis-layout.ts` / `draw-helpers.ts` had **uncommitted WIP** from a
  parallel agent (the card-mode axis layout). Land/commit that first to avoid collisions.
- Follow `docs/0.3.12/AGENTS.md`: `npm run verify` gate, `grep -a` on layout.ts, E2E reflection check.

## What already exists (reuse)
- Card-mode axis layout is committed (`feat: implement Cartesian custom axis layout (P2-P4)`):
  - `src/axis-layout.ts` `axisLayout(nodes, ctx, opts)` → `{positions, axes, width, height}` with
    variable-width categorical bands + quantitative ticks (`AxisSpec`).
  - `src/view.ts` `applyAxisLayout(effEnc, encCtx)` (card modes only) moves `laid.nodes`, sets `laid.axes`.
  - `src/encoding/channels.ts` registers `axisX`/`axisY` (currently `appliesTo` = euler*/bipartite/bubblesets).
  - Grid drawing via `laid.axes` (see `draw-helpers.ts` / view drawAxisGrid path).
- droste data is already available WITHOUT the graph: `DrosteGallery` has
  `nodeKeys: Map<id, tagKeys[]>`, `links: Map<id,id[]>`, `backlinks: Map<id,id[]>` (so x=tag / y=degree
  are derivable per cell). For full field parity (mtime/status/maturity/ageDays) retain a
  `nodeById` map from the graph in `rebuild()` and build `EncNode`s per cell.

## Recommended approach — REUSE the tile grid (low rewrite)
droste is **already a grid**; don't rewrite it to free-place. Instead assign each cell's
`(col,row)` from the axes, keep the tile renderer, and draw boundary gridlines + labels:

1. **channels.ts**: add `"droste"` to `axisX`/`axisY` `appliesTo`.
2. **Per-cell EncNode**: build `EncNode[]` for `gallery.cells` (id + memberships from `nodeKeys`,
   degree from `links/backlinks`, and mtime/fmStatus/fmMaturity/ageDays via a retained `nodeById`).
3. **Axis → (col,row)**: run a discrete variant of the band logic:
   - categorical X → one **column per category** (col = band index); categorical Y → row per category.
   - quantitative → bin into N columns/rows (use `prepareScale` t → `floor(t*N)`).
   Set each `cell.col/cell.row` accordingly and recompute `gallery.cols/gallery.rows`.
   Pack multiple notes sharing a (col,row) into adjacent free cells, OR widen the band to a
   sub-grid (mirror `axis-layout.ts` in-cell packing). Keep `cells` array consistent with
   `byPos` (either keep `byPos` index math by filling a dense `cols×rows` array with the
   scattered cells, or change `draw-droste.ts` to iterate `cells` by their own `col/row`).
4. **Grid + labels**: set `laid.axes` (categorical bands at column boundaries, labels = category
   values via `formatAxisLabel`) and draw gridlines at tile-column/row boundaries in droste's
   world space. Reuse the existing axis-grid drawer if its coordinate space matches droste's
   `cellSize` tiling; otherwise add a small droste-specific grid pass in `draw-droste.ts`.
5. **Encode UI**: Position X/Y rows already exist (settings-tabs.ts) and will appear for droste
   once `appliesTo` includes it — no UI change needed beyond step 1.

### Alternative (higher effort)
Give cells continuous `(x,y)` and rewrite `draw-droste.ts` placement/hit-test/LOD/clip to free
positions + variable gridlines. More faithful to a true scatter but a large renderer rewrite.

## Files
- `src/encoding/channels.ts` (appliesTo += droste)
- `src/view.ts` (`rebuild`: retain `nodeById`; droste branch of `applyAxisLayout` → assign cell col/row + `laid.axes`)
- `src/droste-layout.ts` (GalleryCell already has col/row; helper to (re)assign by axis)
- `src/draw-droste.ts` (iterate by cell col/row if scatter breaks `byPos`; optional grid pass)

## Verification
- `npm run verify` green; add `test/axis-layout.test.ts`-style unit tests for the discrete col/row mapping.
- CDP E2E (separate profile + dedicated port, per AGENTS.md): in droste mode bind axisX=tag/axisY=degree →
  cells land in the expected columns/rows, displayed cell count unchanged (selection non-interference),
  grid + labels drawn; unbinding restores the default contact-sheet tiling.
