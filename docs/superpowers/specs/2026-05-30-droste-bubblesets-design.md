# Design: Droste-Effect View Mode — orthogonal ½-recursion of the containment unit

- **Status:** FINAL (full rewrite 2026-05-31). Supersedes all earlier revisions,
  including every conformal-warp design. The conformal map is NOT used.
- **Plugin:** Tag Lens — beta view mode `"droste"` (UI label "Droste Effect").

## 0. What this design discards (do not drift back)

Earlier rounds tried to reproduce Escher's *Print Gallery* with the **conformal map**
`z = R₀·exp(γζ)` — wrapping the source plane onto a strip `ζ`, subdividing edges with
`seg()`, drawing copies around `v += 2π·m`, and overlaying a warped red grid. **All of
that is discarded.** The map is angle-preserving but produced either rotationally
symmetric webs or required a hand-designed grid texture; it never gave a clean,
readable, vault-meaningful picture. `conformal.ts` stays in the repo but is unused by
this view.

The view is now a **plain orthogonal (axis-aligned) drawing**, recursed ×½ toward the
centre — the Droste self-similarity ("the picture contains itself") done with nested
squares, not a warp.

## 1. The unit: ① ∈ ② ∈ ③ ∈ ④, plus ⑤ outside

Let **`T`** = the focus note `N`'s membership cluster-key set. Reading outward:

- **①** — the focus note `N` (a square at the unit centre, 4×4 grid cells).
- **②** — notes whose membership set **EXACTLY equals `T`** (excl. `N`), as small
  squares filling the cells immediately **around** ① (a square ring enclosing it).
- **③** — those notes presented as **ONE `T`-enclosure frame** around the ①② block.
- **④** — the groups whose signature is a **PROPER SUBSET of `T`** (the looser, more
  inclusive enclosures), each a square frame that CONTAINS ③, staggered so independent
  siblings overlap only on the shared central ③; each holds its own member notes as
  1×1-cell squares in its exclusive outer band.
- **⑤** — **UNRELATED notes**: signature is **NOT a subset of `T`** (supersets, partial
  overlaps, disjoint tags, or untagged). They have no containment relation to `N`, so
  they are tiled in the **OUTER region** outside the ④ bounding square — they never
  overlap ①②③④. ALL unrelated notes are shown (overflow → a "+N" cell).

`① ⊆ ② ⊆ ③ ⊆ ④` is a genuine containment chain; ⑤ is everything else, drawn as the
surrounding context.

## 2. Data (`droste-layout.ts`, unchanged geometry contract)

`layoutDroste(data, {focusId, labels})` emits role-tagged `DrosteShape`s:
roles ①②③ as before; ④ frames carry their `members`; **⑤ = role-5 cards for every
node with `keys ⊄ T`** (NOT capped — the renderer decides how many fit). The view feeds
the **full pre-LIMIT graph** (`drosteAllData`) so ①②③④⑤ are vault-wide, not limited to
the query's visible subset.

## 3. Render: orthogonal ½-recursion (`draw-droste.ts`)

```
# layout builds a FOCUS CHAIN so each ×½ centre copy shows a DIFFERENT context:
chain[0] = layout(N)
for d in 1 .. DEPTH-1:
    chain[d] = layout( nextFocus(chain[d-1], used) )   # re-root each level
# render
drawNest(canvas):
    grid()                                  # one faint cartesian grid (background)
    uR = outerR                             # outermost unit half-size
    for d in 0 .. len(chain)-1:             # outer → inner (inner drawn on top)
        if 2·uR < minFontPx: break          # too small to read ⇒ stop
        drawUnit(chain[d], centre, uR, drawFive = (d == 0))  # ①②③④ ; ⑤ only d==0
        uR *= k                             # ½ each step

k = 0.5, DEPTH = 5.
```

**`nextFocus(meta, used)` — the focus of the next inner level.** Drilling inward must
reveal a DIFFERENT context, not the same figure shrinking, so we do NOT reuse N or its
② peers (same `T` ⇒ identical layout). Pick, in order: (1) the first **④ proper-subset
group's first member** — a representative of a BROADER enclosure N sits in; (2) failing
that, the first **⑤ unrelated note** — a different region of the vault. Skip ids already
on the chain (`used`); return nothing ⇒ recursion stops. So the chain walks N → broader
context → … → an unrelated context, each level a distinct figure.

- **`drawUnit(cx, cy, uR, drawFive)`** draws one ①②③④ (and ⑤ iff `drawFive`) sized to
  the square centred on `(cx,cy)` with half-size `uR`, snapping edges to that unit's own
  grid (`gstep = uR/16`).
- **⑤ handling (decided):** drawn **only on the outermost unit** (`d == 0`). ⑤ is the
  large surrounding context; ×½⁵ shrinkage would crush it into an unreadable blob, and
  it is best read as a single outer backdrop. Inner units draw ①②③④ only — but each
  with its OWN re-rooted focus (the chain above), so the centre is genuinely a different
  figure, not the same one shrunk.
- Outermost unit shrinks to `0.72·min(cx,cy)` when ⑤ exist (to leave the outer ring),
  else `0.94`.
- Draw order outer→inner means each smaller copy sits on top, converging to the centre.

No conformal warp, no `seg()` subdivision, no red spiral grid, no `copies` loop, no
`bbox → ζ` wrapping. The BubbleSets renderer for the other view modes is untouched.

## 4. Interaction

- **Click a note** (any ①②④-member/⑤ card; front-most/innermost wins) → open the file
  **and** set it as the new focus `N`, recompute `T`, and rebuild the whole view
  (re-root). Frames / "+N" / synthetic cells do not re-root.
- **Hover** a note → its full title is shown in a tooltip near the cell (cells are tiny,
  especially ⑤).

## 5. Settings

| field | default | meaning |
|---|---|---|
| `drosteFocus` | `""` | focus note id (the recursion centre). "" ⇒ first note. Click re-roots. |

(`drosteZoom`/`Copies`/`Subdiv`/`TwistDir`/`Render` were conformal-only and are removed.)

## 6. Verification

`droste-layout` unit tests cover the ②④ set logic and ⑤ membership (`keys ⊄ T`). Final
gate: `npx tsc --noEmit` + `npm run build` + vault eye-check — depth-2 first (one ½ unit
nested in the centre of the outer ①②③④⑤), then depth-5; clicking a note re-roots.
