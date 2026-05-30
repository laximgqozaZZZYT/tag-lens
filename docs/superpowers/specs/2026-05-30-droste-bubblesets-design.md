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

### Hierarchy → perimeter mapping (counter-clockwise from bottom-left)

```
   top-left ←──────────────── top-right
    │  ④ peer groups            ↑
    │     (other clusters)      │ ③ containing group
    │                           │    (the cluster/tag)
    ↓  (left edge = seam/       │
    │   transition that closes  │
    │   the loop into next      │
   bottom-left ───────────────→ bottom-right
   ① focus       ② node-peers
     node N         (sibling notes in N's cluster)
```

- **bottom-left corner** = focus node `N` (smallest scale, `v = 0`)
- **bottom edge** (`v ∈ [0, π/2)`) = ① notes sharing N's cluster
- **right edge** (`v ∈ [π/2, π)`) = ② the cluster(s) containing them
- **top edge** (`v ∈ [π, 3π/2)`) = ③ other clusters peer to that cluster
- **left edge** (`v ∈ [3π/2, 2π)`) = ④ transition band that morphs level ③ into the
  next loop's level ① so the seam closes
- One full perimeter loop (`v: 0 → 2π`) scales the whole picture by `k` and is
  self-similar — the recursion repeats the same 4-band template at successive scales.

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
- **Grid construction:** `v ∈ [0, 2π)` is split into the 4 hierarchy quadrants (§1);
  each quadrant is filled with a `cols × rows` block of `Δ × Δ` cells. `Δ = (π/2)/cols`
  (so a quadrant holds exactly `cols` columns), and `rows` cells stack along `u` with
  the **same** `Δ`. One element per cell, in reading order. A level showing more
  elements than `cols × rows` is capped (overflow folded into a final "+N" cell), which
  also bounds render cost. One full turn (`v: 0→2π`) is still one Droste period (×k);
  `drosteCopies` repeats it at successive scales via the renderer's `v += 2π·m`.
- Rejected **Approach A** (warp `v→θ` so the *outline* is a polar square
  `r(θ)=R/max(|cosθ|,|sinθ|)`): lighter and keeps straight outer edges, but fights the
  conformal map — interior cells distort and angle-preservation is lost, so it is not a
  faithful Print Gallery. Escher fidelity was the stated priority, so B wins.

## 3. Rendering pipeline (`draw-droste.ts`)

1. Reset canvas transform; use a manual `project(u, v) → screen` built from §2.
2. For each bubble contour, card frame, and edge: subdivide into `drosteSubdiv`
   segments, map every vertex through `project`, stroke/fill the resulting polyline.
   Fill hues reuse the existing `clusterHue(groupKey)`.
3. **Recursion tiling**: draw `drosteCopies` scale copies (`v` shifted by `−2π·m`,
   equivalently `z·k^−m`) **back-to-front: outer/large/coarse first, inner/small/fine
   last (on top)**. This draw order is also the hit-test priority (§5).
4. **Card text**: frame is warped, but the **title is drawn horizontally (upright)** at
   the mapped centroid, sized by local scale, hidden by the existing `minFontPx` floor
   when too small. Overflow is clamped to band width with `…` truncation.
   → see §7 for the known compromise and the v1.1 follow-up.

## 4. Data sourcing (reuse existing pipeline)

Use the post-`rebuild` `laid.nodes` / `laid.clusters` directly — no new query logic.
Focus node `N` (`drosteFocus`, empty ⇒ first node). From `N.memberships`:
① sibling notes in N's cluster, ② N's cluster(s), ③ other clusters.

**Data depth is finite** (notes + clusters = ~2 real tiers). The recursion therefore
repeats the **same 4-band template at successive scales** — *representational*
self-similarity, which is itself Escher-like self-reference and acceptable for beta.

## 5. Hit-testing & interaction

- Hover / click → invert the map (§2) to `(u, v, m)`.
- **Multi-copy resolution**: a screen pixel maps to several copies. Restrict candidate
  loop indices `m` to the **set of copies actually drawn** (not unbounded `floor`
  neighbours). Among candidates whose `(u, v)` falls inside a drawn element footprint,
  pick the **front-most** (last drawn = innermost/finest), matching the §3 draw order.
- Click on a node → open the file. Click on empty area → no hit.
- Click to **re-root focus N** to the front-most node (self-similar dive). This is a
  headline interaction, so it relies on the precise resolution rule above.
- Zoom: standard fit/zoom in v1. Seamless `×k` wrap-around zoom is v1.1.

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
