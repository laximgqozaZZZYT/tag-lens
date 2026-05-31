# Design: Print Gallery (Escher) View Mode — conformal warp of the BubbleSets plane

- **Status:** FINAL (full rewrite 2026-05-31). Supersedes all earlier revisions.
- **Plugin:** Tag Lens — beta view mode `"droste"`.

## 0. What this design discards (do not drift back)

Earlier rounds built the spiral by **generating tiles in strip space and packing a
label per cell** (compact contiguous bands `Δ_m = 2π/N_m`, per-turn focus re-rooting,
`visited` / empty-sibling fallback / focus chains, self-referential loops). **All of
that is discarded.** It was an attempt to *re-invent* a source image with hand-built
discrete tiles. The struggles it caused (sparse turns, chain-length-1, tag duplication,
seam filling) were artefacts of that mistake and do not arise here.

The correct source image is the **existing BubbleSets layout** — its node cards and
cluster enclosures — treated as one continuous plane, warped by `z = R₀·exp(γζ)` and
overlaid with a red coordinate grid, nested ×k toward the centre (Escher *Print
Gallery*).

## 1. One sentence

Treat the BubbleSets view's geometry as a continuous **source plane**, reorder its
content into the ①②③④ containment-zoom order along X, wrap that plane onto the strip
`ζ = u + i·v`, warp it with `z = R₀·exp(γζ)`, overlay a red grid (the warped source
orthogonal grid), and nest the whole plane ×k self-similarly toward the centre.

## 2. The ①②③④ order = containment zoom-out from N (GROUP_BY intersection)

`GROUP_BY` (e.g. `tag:*`) defines enclosures. Let **`T` = the intersection set of the
focus node `N`'s membership cluster-keys** (`N.memberships`). Reading outward:

- **`v = 0`** — **① the node `N`** (one node).
- **`v ∈ [0, π/2)`** — **② the nodes whose membership set EXACTLY equals `T`** (exact
  match, partial excluded; includes `N`). These are the cards in the exact-`T` enclosure.
- **`v ∈ [π/2, π)`** — **③ those nodes presented as ONE intersection group** framed by
  `T` (a BubbleSets enclosure = the overlap region of all tags in `T`; aggregatable).
- **`v ∈ [π, 3π/2)`** — **④ ③ plus the groups whose signature is a PROPER SUBSET of
  `T`** (a looser, more inclusive enclosure = the zoom-out direction). Candidates are
  the **membership-signatures that actually occur in the data** and are `⊊ T` (bounded
  by distinct signatures, NOT `2^|T|`), ordered by `|signature|` desc (tightest
  enclosure first), then by group size desc; capped to `cols` with a "+N" aggregate.
- **`v ∈ [3π/2, 2π)`** — **transition band**; ×k self-similar, so the whole ④ becomes
  one element of the next (outer) turn's enclosure.

This is a **containment zoom-out**: `N → exact-T group → T-enclosure → subset-of-T
enclosures`, each step opening the enclosure one level outward. It is NOT "four
abstraction levels of arbitrary content".

## 3. Source plane → strip → screen

- **Source plane** = the reordered BubbleSets geometry in world coords: node **cards**
  (filled rects) and group **enclosure frames** (stroked rects, BubbleSets style),
  arranged left→right in ①②③④ order. Its bbox is `[minX,maxX] × [minY,maxY]`.
- **Wrap** `source(x,y) → ζ`: `X' = (x−minX)/W`, `Y' = (y−minY)/H`; then
  `v = 2π·X'`, `u = uBase + Y'·uH` with `uH = 2π·(H/W)` so the warp stays locally
  isotropic (square-ish grid cells).
- **Warp**: `z = R₀·exp(γ·ζ)`, `γ = 1 − i·(ln k)/(2π)` (unchanged; `conformal.ts`).
  Every source edge is subdivided into `drosteSubdiv` segments and each vertex mapped,
  so straight source lines become logarithmic-spiral arcs.
- **Vector, not raster**: BubbleSets supplies vector geometry (`laid.nodes`,
  `laid.clusters[].pieces[]`, `laid.edges`), so we map vertices — crisp at any zoom, no
  per-pixel sampling.

## 4. Red grid overlay

The red grid is the **source orthogonal grid mapped through the same warp**: a uniform
grid (default **16 vertical × 8 horizontal** lines, count configurable) over the source
bbox. Const-`X` lines → radial logarithmic spirals; const-`Y` lines → ring arcs —
together the spiralling red grid of Escher's *Print Gallery* (shows the coordinate
distortion). Thin red subdivided polylines, drawn over the warped content.

## 5. ×k self-similar nesting & interaction

- The renderer draws the SAME warped source plane at `m = 0, 1, 2, …` via `v += 2π·m`
  (scale `k^m`), each a ×k reduction nested inside the last (`z(ζ+2πi)=k·z(ζ)` keeps
  outer and nested continuous). Back-to-front (outer first, inner on top).
- **Focus N**: `drosteFocus`, else first node with a real (non-NONE) membership, else
  first node. `v=0` ⇒ N maps to screen angle ≈ 0 (right of centre), innermost radius; a
  marker (dot+ring) is drawn on N's innermost (`m=0`) card.
- **Hit-test**: invert the map (`conformal.ts` `drosteInverseBranch`) → `(u,v,m)` →
  `(X',Y')` → source `(x,y)`; the card rect containing it gives the id. Front-most
  (innermost `m`) wins; ids are identical across copies.
- **Click re-root**: clicking a NOTE sets `drosteFocus` and rebuilds — re-centres the
  whole self-similar spiral on that node (recomputes `T`). Frames / "+N" / synthetic
  cells do not re-root.
- **Text**: drawn upright at each card/frame centroid, sized by local scale, hidden
  below `minFontPx`, clamped to the cell's angular screen width with `…`
  (`truncateToWidth`). Text rotation to follow the warp is a v1.1 follow-up.

## 5b. Render modes (grid ↔ spiral)

The Print Gallery view has two render modes over the SAME ①②③④ source plane
(`drosteRender`):

- **`"grid"` (default)** — the orthogonal, pre-warp source plane drawn on a cartesian
  grid: ① N as a **4×4-cell** central square; ② exact-`T` notes as a square ring of
  cells surrounding ①; ③ the `T`-enclosure frame; ④ proper-subset frames offset around
  ③ (siblings overlap only on the shared central ③, never nest into each other), each
  holding its own member notes as **1×1-cell grey squares** in that frame's exclusive
  outer band. All box edges snap to the grid. The block spacing is sized so ②'s nearest
  cell always clears the 4×4 ①. This is the directly-readable containment view.
- **`"spiral"`** — the same plane warped by `z = R₀·exp(γζ)` with the red coordinate
  grid and ×k self-similar nesting (§3–§5): Escher's *Print Gallery*.

Grid mode is self-fitting (ignores zoom/pan). Hit-testing in grid mode reuses the rects
the renderer records while drawing (front-most wins); spiral mode inverts the conformal
map. Both modes re-root on clicking a note.

## 6. Settings

| field | default | meaning |
|---|---|---|
| `drosteRender` | `"grid"` | render mode: `"grid"` (orthogonal cartesian plane) or `"spiral"` (conformal warp). |
| `drosteZoom` (k) | 2.5 | scale per turn / twist; γ = 1 − i·ln k/2π. (spiral only) |
| `drosteTwistDir` | `"ccw"` | spiral direction (sign of Im γ). (spiral only) |
| `drosteCopies` | 4 | nested ×k copies drawn. (spiral only) |
| `drosteSubdiv` | 24 | segments per source edge. (spiral only) |
| `drosteFocus` | `""` | focus node id; empty ⇒ first node. Click re-roots (both modes). |

## 7. Verification

`conformal.ts` keeps its round-trip + scale-periodicity asserts. The layout has unit
tests for the ②④ set logic (exact-`T` match, proper-subset ordering, caps). Final gate:
`npx tsc --noEmit` + `npm run build` + vault eye-check (reordered BubbleSets warped into
a red-grid spiral, nesting ×k from `N` outward through `T → subsets`).
