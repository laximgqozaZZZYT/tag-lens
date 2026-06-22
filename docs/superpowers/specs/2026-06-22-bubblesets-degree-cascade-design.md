# BubbleSets: degree-cascading intersection placement + n=3 guarantee

## Relationship to the prior spec

This extends `2026-06-21-bubblesets-sibling-overlap-design.md` (sibling-box
proximity/overlap, already implemented). That spec made cross-cutting TAG
BOXES overlap proportional to sharing. This spec addresses a different,
more specific problem the user identified: where exactly a NODE's card gets
drawn when its full tag signature has degree ≥ 2, given that a rectangle
layout cannot always realize every possible intersection region.

Both apply to `bubblesets` mode only. `euler-true` is unchanged by either.

## Problem (user's exact requirement)

A node with signature `{tagA, tagB, tagC, tagD}` (degree 4) should be drawn
inside the degree-4 intersection region if that region is "physically
representable" (draws as a real rectangle with positive area). If it isn't,
fall back to one of the 4 possible degree-3 regions (drop one tag). If none
of those 4 are representable either, fall back to one of the 6 possible
degree-2 regions (drop two tags). And so on down to degree 1, which always
exists (a tag's own rectangle).

**Degree 3 must be exact/guaranteed**, not best-effort: it is a known result
that 3 axis-aligned rectangles CAN always be arranged so all 8 Venn regions
(including the true triple intersection) are realizable simultaneously —
unlike 4+ sets, where no rectangle arrangement can realize every region.
Degree ≥ 4 only needs "the most reasonable placement," because rectangles
fundamentally cannot guarantee it in general — but per the cascade, a
degree-4 node's fallback set always includes 4 degree-3 combinations, and
every one of those is a "needed triple" this spec guarantees is drawable
(see below), so the cascade will succeed by degree 3 in the overwhelming
majority of real cases.

## Design

### Two new pieces, scoped to `bubblesets` only

**1. Triple-overlap guarantee** (`src/layout/triple-overlap-guarantee.ts`)

A "needed triple" is any 3 distinct tags `{a, b, c}` whose member sets have
a non-empty 3-way intersection (`tagMembers(a) ∩ tagMembers(b) ∩
tagMembers(c) ≠ ∅` — i.e. some real node has all 3, possibly plus others).
Pairwise force-relaxation (the existing `siblingOverlapPack`) only pulls
PAIRS together; it does not guarantee that 3 mutually-overlapping pairs
also share a common triple region (classic failure: A∩B and B∩C both
non-empty, A∩C empty).

```ts
export function guaranteeTripleOverlaps(
  boxes: SizedNode[],
  positions: { x: number; y: number }[], // mutated in place
  hasTripleShare: (a: string, b: string, c: string) => boolean,
  minEps: number,
): void
```

For every triple `(i, j, k)` among `boxes` where `hasTripleShare` is true:
compute the current AABB intersection of the three rectangles (using
`positions[i/j/k]` + each box's width/height). If it is already
non-degenerate (positive width AND height), do nothing — the relaxation
already solved it, no need to disturb a good layout. If degenerate:

- `P` = centroid of the three current centres.
- `eps` = `min(minEps, every box's half-width, every box's half-height)`
  among the three (kept positive and always feasible — a box can always be
  shifted to contain a region around its own centre no larger than its own
  half-extent).
- For each of the three boxes independently: clamp its centre's x into
  `[P.x - halfW + eps, P.x + halfW - eps]` (and y likewise), i.e. the
  *minimal* shift that makes the box's rectangle contain the small square
  `P ± eps`.

After this, all three rectangles contain `P ± eps` by construction, so
their AABB intersection contains that square — guaranteed non-degenerate,
with area ≥ `(2·eps)²`. This is a deterministic geometric construction, not
an iterative approximation — it cannot fail to converge.

Called from `layoutEulerTrue`'s `pack` closure (the same wrapping point
Task 2 added for `siblingOverlapPack`), immediately after the pairwise
relax, before the result's `width`/`height` bounding box is recomputed (the
nudge can move a box slightly outside the previously-computed bbox).

**Scope note:** this only fires for triples that are siblings in the SAME
`pack()` call (same immediate parent, or all roots) — consistent with how
the pairwise sibling-overlap mechanism is already scoped. A "needed triple"
whose 3 tags end up at different containment-forest depths (each nested
under a different ancestor) is not reachable by this construction; the
cascade for such a node still terminates correctly (it just falls through
to degree 2 or 1), so correctness is preserved — only the n=3 *strictness*
guarantee is bounded to the sibling case, which is the common case for
genuinely cross-cutting tags (none a subset of another implies they
generally land at the same forest depth).

**Side effect (accepted trade-off):** the minimal clamp can, in rare cases,
nudge a box into a small (≤ `eps`) overlap with an unrelated 0-share
sibling. No corrective repulsion pass runs afterward — re-running repulsion
risks undoing the just-established triple guarantee. The resulting
violation is bounded by `eps` (a small constant, default `max(gap, 8)`
world units) and is the deliberate cost of satisfying the user's explicit
n=3 requirement.

**2. Degree-cascading region resolution** (`src/layout/intersection-region.ts`)

```ts
export interface RegionResult {
  tags: string[]; // the chosen subset, sorted
  rect: { x: number; y: number; w: number; h: number };
}
export function resolveNodeRegion(
  signature: string[], // sorted, deduped tags for one node (or [NONE_BUCKET])
  mainRectOf: (tag: string) => { x: number; y: number; w: number; h: number } | null,
): RegionResult | null
```

For `d` from `signature.length` down to `1`: enumerate every size-`d`
subset of `signature` (all `C(k, d)` combinations). For `d === 1`, the
"region" is just that tag's own main rect — always present, the guaranteed
base case (a tag with zero members never appears in any node's signature,
so `mainRectOf` is never null here in practice). For `d >= 2`, compute the
AABB intersection of the `d` tags' main rects (sequential
max-of-lefts/min-of-rights reduce); it's drawable iff width AND height are
both positive. Among all drawable subsets at the FIRST degree (highest `d`)
where at least one is drawable, pick the one with the largest intersection
area (tie-break: alphabetically-smallest joined tag key, for determinism).
Return that as the result; degree 1 always succeeds, so the function never
returns `null` for a non-empty signature.

Combinatorial guard: real signatures are small in `bubblesets`'s closeup
scope, but as a safety bound (mirroring `droste-layout.ts`'s `buildIcon`
precedent), when `k > 8` only degrees `k`, `k-1`, `k-2`, and `1` are tried
— skipping the combinatorially expensive middle range rather than
enumerating up to `2^k - 1` subsets.

### Wiring into `layoutEulerTrue` (bubblesets only)

After `place()` finishes (final `clusters[]` geometry is known), replace
the existing "PARTIAL-OVERLAP exclave" block (the one that pushes a tiny
marker square at a cross-cutting member's literal position) with real
region placement, **for `bubblesets` only** (the existing exclave block
stays completely unchanged for `euler-true`):

1. For every node, compute its signature and call `resolveNodeRegion`.
2. Skip nodes whose resolved region is degree 1 (already correctly
   positioned by the existing `place()` recursion — nothing to do).
3. Group degree ≥ 2 nodes by their resolved region key (sorted tags
   joined). For each group, `shelfPack` its cards within the resolved
   rect's top-left corner (same convention as every other shelf-packed
   block in this file) and overwrite those nodes' `x`/`y` (and
   `idToRect`, since edge routing depends on it).
4. Push one striped `sub` piece per resolved region (attached to one of
   the region's tags' clusters, picked deterministically — e.g.
   alphabetically smallest) with `hueKeys` = the resolved region's tag
   list, so `draw-enclosures.ts`'s existing `hueKeys.length > 1` ∩-stripe
   rendering picks it up automatically — no renderer changes needed.

The existing pairwise "VISIBLE BOX-OVERLAP stripes" pass (further down,
unchanged) keeps running for both modes — it decoratively stripes any
TAG-BOX-level crossing regardless of whether any node actually resolved
there; the two passes are complementary, not conflicting.

## Risks / non-goals

- This is still not an exact area-proportional Venn solver (per the prior
  spec's risk section) — degree ≥ 4 is explicitly best-effort by the user's
  own framing, not a defect.
- The triple-guarantee's bounded `eps`-overlap side effect on unrelated
  0-share pairs (above) is accepted, not silently ignored — tests must
  assert the bound, not just "no violation," since a small violation is
  expected by design.
- Performance: `guaranteeTripleOverlaps` is O(n³) over one sibling group's
  box count; `resolveNodeRegion` is up to O(2^k) per node (capped at k≤8
  fully, k>8 narrowed). Both scoped to `bubblesets`'s closeup-sized data —
  not a concern at this scale, consistent with the prior spec's
  performance note.
