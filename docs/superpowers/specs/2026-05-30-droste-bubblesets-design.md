# Design: Print Gallery (Escher) View Mode — Droste conformal map of BubbleSets

- **Date:** 2026-05-30
- **Status:** Approved (design); ready for implementation planning
- **Plugin:** Tag Lens (`tag-lens`) v0.2.x → new beta view mode
- **Author:** brainstormed with the user; final maths reviewed & corrected by the user

## 1. Summary

Add a new **experimental (beta)** view mode `"droste"` that renders the tag-membership
hierarchy as M.C. Escher's *Print Gallery* (Prentententoonstelling) — i.e. the
**Droste conformal map** `z = R₀·exp(γ·ζ)`. Walking the perimeter of the frame once
passes through four hierarchy levels and simultaneously zooms by a factor `k`, so the
picture spirals seamlessly into itself (the signature Escher twist).

The mode does **not** touch any existing stable/beta mode; it is additive.

### Hierarchy → one turn (contiguous bands; revision 2026-05-30d)

One turn (`v: 0 → 2π`) is one hierarchy slice. The four roles are laid as **contiguous
bands in order**, NOT pinned to fixed π/2 quadrants — band widths are proportional to
each role's (capped) element count (§2.1, "compact contiguous bands"):

```
   v=0 ──①──▶──②──▶──③──▶──④──▶ v=2π  (≡ next turn's v=0, scaled ×k)
   ┌──────────┬─────┬──────────┬──┐
   │ ① sibling│ ② N's│ ③ sibling│④ │   widths ∝ #cells per role
   │   notes  │clust.│ clusters │↻ │   (≈ quarters only when balanced)
   └──────────┴─────┴──────────┴──┘
     N at v=0                    bridge → next focus
```

- **`v = 0`** = focus `N` (the first cell, smallest scale). The map sends `v=0` to
  screen **angle ≈ 0 (right of centre / 3 o'clock)** — `arg z = −U_BASE·(ln k/2π) ≈ 0`
  — at the innermost radius `≈ R₀·e^{U_BASE}`, NOT the bottom-left (that was a leftover
  from the square-perimeter model; the conformal map `z=exp(γζ)` puts `v=0` on the +x
  ray). A focus marker (§5) is drawn there so the entry is findable in the core.
- **① sibling notes** → **② N's cluster(s)** → **③ the other clusters** (capped) →
  **④ `↻ N` bridge** (self-reference — the nested copy is `N` again). The angular order
  encodes the abstraction climb; because `ln|z| = u + (ln k/2π)·v`, this angular order
  also maps to an inner→outer **radial** climb over the turn.
- **Recursion = ×k self-similar nesting of ONE slice (revision 2026-05-31).** There is
  a single slice; the renderer draws it at `m = 0, 1, 2, …` (`v += 2π·m`), each copy a
  ×k reduction of the SAME picture nested inside the last — the Escher "image contains
  itself". ④ is a self-reference (`↻ N`): the nested copy is `N` again. (The round-6
  design — turn `s+1` re-roots on a *different* cluster — was WRONG: that nests a
  different picture, i.e. drill-down, not self-similarity. See §4.)

### Architecture decisions (confirmed, not revisited)

- **Vector vertex pipeline** (not raster post-warp): subdivide every edge into short
  segments, push each vertex through the conformal map, stroke/fill polylines.
  Resolution-independent, crisp at any zoom, mobile-friendlier than per-pixel remap.
- **Own projection, affine reset**: like the `matrix` / `heatmap` / `lattice` modes,
  reset the canvas transform (`setTransform(1,0,0,1,0,0)`) and project each vertex
  manually — Canvas2D's affine transform cannot express a non-linear conformal map.
- **Seamless infinite zoom** (camera that wraps by `k`) is **deferred to v1.1** (YAGNI).

## 2. Coordinate system (the core — worked out before implementation)

Single holomorphic (⇒ conformal ⇒ angle-preserving) map. `u`, `v` are the real and
imaginary parts of the strip coordinate `ζ`:

```
ζ  = u + i·v          v ∈ [0, 2π)  perimeter / loop parameter
                      u ∈ [0, U)   raw log-radius depth of the frame band
γ  = 1 − i·(ln k)/(2π)             k = scale factor per loop (drosteZoom)
z  = R₀ · exp(γ · ζ)               R₀ = fit base radius
screen = zoom·z + pan              (z complex → (x, y))
```

Expanding `exp(γ·ζ)`:

```
ln|z| = u + (ln k / 2π)·v          ← radius   (BOTH u and v drive it)
arg z = v − (ln k / 2π)·u          ← screen angle (BOTH u and v drive it)
```

Because the map is the Escher twist, **u and v each contribute to both radius and
angle** — they are mixed. The meaningful distinction is periodicity and role:

| variable | role |
|---|---|
| **v** (period 2π) | the loop parameter. Carries the **per-revolution ×k scale** (its `(ln k/2π)·v` term sums to `+ln k` over 2π) **and** advances the screen angle by `+2π` over one loop. The Escher spiral runs along v. |
| **u** (non-periodic) | raw log-radius depth across/within frame bands (`+u` ⇒ radius `×e^u`). Also shears the angle by `−(ln k/2π)·u`. Moving along u alone traces a **logarithmic spiral** locally perpendicular to the v-spiral (it is NOT a straight radial ray — a consequence of choosing twist (A)). |

**Why `γ = 1 − i·(ln k)/(2π)`:**

```
exp(γ · 2πi) = exp(2πi · 1) · exp(ln k) = 1 · k = k
                ╰── Re(γ)=1 ──╯   ╰── Im(γ) ──╯
```

- **Re(γ) = 1 (integer)** ⇒ `exp(2πi·Re γ) = 1` ⇒ one loop advances the screen angle by
  exactly a multiple of 2π ⇒ **the seam closes angularly without a twist-mismatch**.
  (Re(γ) controls the *angle closure / seam*, NOT the scale.)
- **Im(γ) = −(ln k)/(2π)** ⇒ supplies the `exp(ln k) = k` factor ⇒ **sets the
  per-loop scale ×k**. (Im(γ) controls the *scale*.)

**Inverse** (for hit-testing): `ζ = ln(z / R₀) / γ`, then `u = Re ζ`,
`v_raw = Im ζ`, `m = floor(v_raw / 2π)` (which loop copy), `v = v_raw − 2π·m`.

`drosteTwistDir` flips the sign of `Im(γ)` (cw vs ccw spiral).

### 2.1 Tile shape in ζ-space — what is "square" (revision 2026-05-30c)

**Bug found in the first build:** unifying everything onto `z = R₀·exp(γζ)` (§2)
defined the *map* correctly but left the *shape of the tile boundaries placed in
ζ-space* undefined. The layout gave every element the full radial band
(`Δu ≈ 0.8`, i.e. a `e^0.8 ≈ 2.2×` radius span) and only a thin angular slice
(`Δv ≪ Δu`). Those extreme radial slivers make the constant-`u` (≈ constant-radius)
boundaries dominate the eye, so the spiral renders as **circular arcs / sectors**,
not the square tiles of Escher's *Print Gallery*.

**Resolution — Approach B (conformal square grid in ζ).** Tile ζ-space with a
**uniform grid whose cells are squares in the (u, v) plane: `Δu = Δv = Δ`.**

- **What is square:** the *grid cells in ζ-space* (log-polar space). A cell is an
  axis-aligned `Δ × Δ` square in `(u, v)`.
- **Why it reads as square on screen:** `z = R₀·exp(γζ)` is holomorphic ⇒ conformal,
  so it maps each tiny ζ-square to a screen tile that is *locally a square* — scaled by
  `|dz/dζ| = |γ·z|` and rotated by `arg(γ·z)`. The four straight ζ-edges bend into
  logarithmic-spiral arcs; the tile is a "quasi-square with spiral edges" — exactly the
  Print Gallery look. **The square lives in ζ (log-polar) space; on screen it is warped
  into the Droste spiral.**
- **Why `Δu = Δv` specifically:** a ζ-cell's on-screen size is `≈ |γz|·Δu` along the
  u-edge and `≈ |γz|·Δv` along the v-edge (conformal scale is isotropic). Equal steps
  ⇒ equal on-screen edges ⇒ square. Unequal steps ⇒ slivers (the bug).
- **Grid construction — contiguous compact bands (revision 2026-05-30d):** fixed
  π/2 quadrants are NOT used. Square cells (`Δu = Δv`, §2.1) and a gap-free ring and
  fixed π/2 boundaries cannot all hold at once — a quadrant with few elements would
  leave a large empty arc (the bug that made the spiral read as scattered fragments).
  So each turn instead **packs its cells contiguously around the full `[0, 2π)` with a
  per-turn uniform cell `Δ_m = 2π / N_m`** (`N_m` = cells in that turn), one row in `u`.
  The cells are still squares (`Δu = Δv = Δ_m`); only the *size* varies per turn. The
  four roles keep their **order** — ① sibling notes, ② focus cluster(s), ③ sibling
  clusters, ④ bridge — laid as **contiguous bands** whose angular widths are
  proportional to each role's (capped) element count (≈ quarters when balanced, but the
  boundaries float with content, NOT pinned to π/2). `N` (the focus node) is still the
  first cell ⇒ sits at `v = 0`, which the map sends to screen angle ≈ 0 (right of
  centre), innermost radius — see §5. Each role is capped (notes / sibling
  clusters ≤ 12) with a final "+N" overflow cell, bounding `N_m` and render cost.
  The **recursion is in the turns**: turn `m` draws hierarchy slice `m` (see §4), and
  `drosteCopies` turns are drawn at successive scales via the renderer's `v += 2π·m`.
- Rejected **Approach A** (warp `v→θ` so the *outline* is a polar square
  `r(θ)=R/max(|cosθ|,|sinθ|)`): lighter and keeps straight outer edges, but fights the
  conformal map — interior cells distort and angle-preservation is lost, so it is not a
  faithful Print Gallery. Escher fidelity was the stated priority, so B wins.

## 3. Rendering pipeline (`draw-droste.ts`)

1. Reset canvas transform; use a manual `project(u, v) → screen` built from §2.
2. For each bubble contour, card frame, and edge: subdivide into `drosteSubdiv`
   segments, map every vertex through `project`, stroke/fill the resulting polyline.
   Fill hues reuse the existing `clusterHue(groupKey)`.
3. **Self-similar nesting**: the layout emits ONE slice (`slices` has length 1, §4).
   Draw `drosteCopies` copies **back-to-front (outer/large/coarse first, inner/small/fine
   last on top)**; copy `m` draws `slices[m mod 1]` (= the same slice) mapped at
   `v += 2π·m` (scale `k^m`) — each a ×k reduction nested inside the last (the image
   contains itself). This draw order is also the hit-test priority (§5).
   **Seam continuity**: because every turn uses the same `[0, 2π)` parametrisation and
   `z(ζ+2πi) = k·z(ζ)`, turn `m`'s `v=2π⁻` boundary and turn `m+1`'s `v=0⁺` boundary land
   on the same screen point — the tile boundaries are continuous even though the cell
   *content* changes per turn (the Print Gallery effect). Each turn fills `[0, 2π)`
   contiguously (§2.1), so no empty arc breaks the spiral.
4. **Card text**: frame is warped, but the **title is drawn horizontally (upright)** at
   the mapped centroid, sized by local scale, hidden by the existing `minFontPx` floor
   when too small. **Implemented (2026-05-30d):** the label is clamped to the cell's
   *angular screen width* via `truncateToWidth(ctx, label, cellW·0.9)` (with `…`), and
   suppressed when that width `< minFontPx`, so long note names can't spill into
   neighbouring cells. `cellW = |project(uMid, v1) − project(uMid, v0)|`.
   → see §7 for the remaining text-orientation compromise (v1.1 follow-up).

## 4. Data sourcing (reuse existing pipeline)

Use the post-`rebuild` graph directly — no new query logic. Focus node `N`
(`drosteFocus`, else first node with a real non-NONE membership, else first node).

**ONE slice, ×k self-similar nesting (revision 2026-05-31 — supersedes round-6).**
The layout emits a SINGLE hierarchy slice from `N`:

- **① `N` + its sibling notes** (notes sharing any of `N`'s clusters; `N` is the first
  cell ⇒ `v = 0`).
- **② `N`'s cluster(s).**
- **③ the other clusters** (every cluster not in `N`'s set), capped to `cols` with a
  final "+N" overflow cell — so ③ ≈ ① in width, not dominant (verified: ① 40–57%, ②
  6–15%, ③ 29–44%, ④ 5–7%).
- **④ a single `↻ N` bridge** — a *self-reference*, because the nested copy IS `N`.

The renderer (§3) draws this one slice at `m = 0, 1, 2, …`, each a ×k reduction nested
inside the last (`slices[m mod 1]`); `z(ζ+2πi)=k·z(ζ)` makes them continuous. This is
the genuine Print Gallery "the image contains itself".

> **Round-6 was wrong (corrected here).** Round 6 made turn `s+1` re-root on a
> *different* cluster from turn `s`'s ③ (a finite focus chain, `visited` tracking,
> co-occurring-sibling priority + fallback, a self-referential loop closing the chain).
> That nests a *different* picture per level = drill-down, NOT self-similarity. All of
> that machinery (chain / re-rooting / `visited` / fallback / per-turn slices) is
> **removed**; the "sparse turns / chain-length-1 / empty-sibling" struggles it caused
> were artefacts of nesting a different picture and do not arise for a single slice.

Each slice is laid out as contiguous compact square bands per §2.1 (role order ①②③④
preserved; widths ∝ capped counts; `N` at `v = 0`). Empty vault ⇒ `slices = []`.

## 5. Hit-testing & interaction

- Hover / click → invert the map (§2) to `(u, v, m)`.
- **Multi-copy resolution**: a screen pixel maps to several copies. Restrict candidate
  loop indices `m` to the **set of copies actually drawn** (not unbounded `floor`
  neighbours). Among candidates whose `(u, v)` falls inside a drawn element footprint,
  pick the **front-most** (last drawn = innermost/finest), matching the §3 draw order.
- Click on a node → open the file. Click on empty area → no hit.
- **Click to re-root** (self-similar context): every copy is the SAME slice, so a
  screen point maps to one element id across all ×k copies; hit-test returns the
  front-most (innermost) copy's id — the same id regardless of copy. Clicking a NOTE
  sets `drosteFocus = id` and rebuilds, producing a NEW single slice rooted at that
  node — i.e. **re-centres the whole self-similar spiral on the clicked node** (not a
  "dive into a different nested picture"; all copies always share one `N`). Cluster
  cells (②③) and synthetic cells (`__loop`, `__more_*`) do not re-root (focus must be a
  node) and are ignored on click.
- **Focus N marker**: the renderer draws a bright dot+ring on N's innermost (`m=0`)
  cell so the spiral's root/entry is findable in the central core (N is at angle ≈ 0,
  innermost — §1).
- **Content-following fit (revision 2026-05-30d)**: `fitToView` frames ~`N = min(copies,3)`
  turns. The renderer centres `z` at the canvas middle with `R₀ = min(w,h)/(4·dpr)`;
  turn `m`'s outer radius `≈ R₀·e^{U_BASE}·k^m`, so `zoom = 1.8 / (e^{U_BASE}·k^N)`,
  `pan = 0`. Inner turns stay legible while outer turns spill (Droste is infinite). The
  central hollow is `≈ 0.45/k^N` of the min canvas dim (inherent to the spiral's limit
  point — the focus marker compensates). `U_BASE = 0.04` keeps the innermost cell tight
  to the core. Seamless `×k` wrap-around zoom is still v1.1.

## 6. Settings (add `MiniSettings` field + `DEFAULT_SETTINGS` + `loadSettings` validation — all three)

| field | default | meaning |
|---|---|---|
| `drosteZoom` (k) | **2.5** | scale factor per loop. Slider ~1.5–16; start gentle so inner copies survive the `minFontPx` floor (k=8×copies=4 ⇒ 512× span ⇒ inner copies vanish). |
| `drosteTwistDir` | `"ccw"` | spiral direction; flips sign of `Im(γ)`. |
| `drosteCopies` | `4` | recursion copies drawn (back-to-front). |
| `drosteSubdiv` | `24` | segments per edge (quality vs perf). |
| `drosteFocus` | `""` | focus node id; empty ⇒ first node. Click re-roots. |

Controls live in the view's settings panel (GRAPH DISPLAY section, like other modes).

## 7. Known compromise & v1.1 follow-up (text orientation)

v1 draws card **frames warped but text horizontal** — a deliberate, documented
**readability-vs-immersion compromise**. Under strong twist this reduces immersion and
needs overflow handling (clamp + `…`). **This is a known quality limitation of v1.**

**v1.1 candidate**: rotate text to follow the frame using the map's local rotation
angle from the Jacobian:

```
arg(z') = arg(γ) + arg(z) = arg(γ) + v − (ln k / 2π)·u
```

(Note the `+v` term — text rotation depends on the loop position, not just `u`.)

## 8. Verification

The repo has **no test framework**. Add pure-function self-checks in `conformal.ts`,
runnable under a debug flag:

1. **Round-trip**: `inverse(forward(p)) ≈ p` (inverse consistency).
2. **Scale periodicity** (independent of #1 — a wrong-but-consistent map passes #1):
   for sampled `(u, v)`, `|forward(u, v+2π)| / |forward(u, v)| == k` within ε, **and**
   the angle closes: `arg z(u, v+2π) − arg z(u, v) ≡ 0 (mod 2π)`.
3. **Layout seam** (`assertLayoutSeam`, in `droste-layout.ts`): the strip layout is
   2π-periodic in `v` — verify band centre-lines and widths match at the `v=0 ≡ 2π`
   seam to **C0 (value)** *and* **C1 (tangent/first derivative)** so the spiral
   continues without a kink.

Final gate: `npx tsc --noEmit` + `npm run build` + manual visual check in a vault.

## 9. Affected files

- **New**: `src/conformal.ts` (forward/inverse `exp(γζ)` conformal map, edge subdivision, asserts #1/#2),
  `src/droste-layout.ts` (strip layout + `assertLayoutSeam`),
  `src/draw-droste.ts` (renderer).
- **Edit**: `src/types.ts` (`ViewMode` + 5 settings fields + `VIEW_MODES` entry,
  `experimental: true`), `src/main.ts` (`DEFAULT_SETTINGS` + `loadSettings` validation),
  `src/view.ts` (`draw()` dispatch, settings-panel section, hit-test/invert + re-root).
- No `styles.css` change.

## 10. Out of scope (v1)

Seamless `×k` infinite-zoom camera, animations, focus re-root transitions, text
rotation following the frame (all v1.1+).
