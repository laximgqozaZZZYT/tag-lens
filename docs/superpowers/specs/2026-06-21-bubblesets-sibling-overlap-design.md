# BubbleSets: sharing-aware sibling placement

## Problem

`bubblesets` mode (closeup, drill-down target from panorama views) reuses
`layoutEulerTrue()` verbatim. That function builds a strict containment
forest from subset relations (tag A ⊊ tag B → A nests inside B), which is
correct. But sibling tags that are *cross-cutting* (neither a subset of the
other) are placed with a plain `shelfPack()` — a size-greedy bin-packer that
has no notion of how many members two tags share. Visual overlap between
cross-cutting tags currently only happens by packing coincidence; there is
no force pulling tags that share many members close together, nor pushing
disjoint tags apart. As a result, the closeup view does not read as an Euler
diagram: proximity and overlap don't track actual set intersection.

Dead-code note: `src/layout/anchor-placement.ts` already contains
`reorderBySharing` / `tightenAnchors` / `computeClusterSharingCounts`,
apparently written for exactly this purpose, but nothing in the production
layout path calls them. They are not reused as-is (different data shape —
they operate on single-point anchors, not sized rectangles with potential
overlap) but confirm the gap was previously identified.

## Scope

- Changes are isolated to **`bubblesets` mode only**. `euler-true`
  (panorama "Containment map") keeps its exact current `shelfPack` behavior
  and output — verified by not changing any default code path.
- No change to: containment-forest construction, label sizing, the
  per-tag "own node" packing, exclave-piece generation, or the existing
  visible-box-overlap stripe detection (`layout.ts` ~1137-1169) — that pass
  keeps working unmodified, it will simply now detect *intentional*
  overlaps instead of accidental ones.

## Design

### New file: `src/layout/sibling-overlap-pack.ts`

```ts
export function siblingOverlapPack(
  boxes: SizedNode[],
  gap: number,
  opts: {
    sharedCount: (idA: string, idB: string) => number;
    sizeOf: (id: string) => number; // member count, for overlap-fraction normalization
  },
): { positions: { x: number; y: number }[]; width: number; height: number };
```

Same input/output contract as `shelfPack` (positions are box **centres**,
so it's a drop-in replacement at call sites) plus the `sharedCount` /
`sizeOf` callbacks.

Algorithm:
1. **Seed** with `shelfPack(boxes, gap)` — a compact, deterministic,
   non-overlapping starting layout. Boxes with ≤1 entries return immediately
   (no relaxation needed).
2. **Mass** = box area (`width * height`). Heavier boxes move less per
   iteration — keeps large tags stable, lets small/peripheral tags do most
   of the migrating (consistent with the existing `tightenAnchors` /
   `relaxSubgroups` convention in this codebase).
3. **Relax** (~60 iterations), for every pair `(a, b)`:
   - `shared = sharedCount(a.id, b.id)`.
   - **shared > 0**: target overlap fraction
     `frac = clamp(shared / min(sizeOf(a.id), sizeOf(b.id)), 0, 0.7)` (cap
     so a near-identical pair doesn't fully collapse into one box and lose
     legibility). Target center distance on each axis =
     `(halfExtentSum) * (1 - frac)`. Move both centres a fraction of the
     way toward that target distance (mass-weighted split), each iteration.
   - **shared === 0**: standard AABB repulsion (same shape as the existing
     `relaxSubgroups` collision loop) — if currently overlapping, push
     apart along the shorter-overlap axis until `gap` is satisfied. This is
     the only case the OWN-node pseudo-box (`sharedCount` always 0 against
     every tag) ever participates in — it never overlaps a sibling tag,
     matching its current semantics (a node's OWN box only happens when
     that tag is the node's most-specific membership, i.e. by construction
     not a member of any sibling tag).
4. **Re-derive bounding box** from final positions + box extents; translate
   so it starts at (0,0) (matching `shelfPack`'s coordinate convention).
   Return `{ positions, width, height }`.

### `layout.ts` changes

- `layoutEulerTrue(data, sized, opts, pack = shelfPack)` gains an optional
  4th parameter used **only** at the two call sites that pack *sibling tag
  boxes* (cross-cutting candidates):
  - the recursive `inner` pack inside `measure()` (OWN block + child tag
    boxes sharing one parent — siblings under the same parent can still be
    mutually cross-cutting),
  - the root-level `canvas` pack (`rootSizes`).
- The "own node" pack (cards within a single tag's own block) is **not**
  parameterized — always `shelfPack`, regardless of mode.
- A `sharedCount(a, b)` closure is built once per call from the function's
  existing `tagMembers: Map<string, Set<string>>` (small-set intersection;
  returns 0 if either id isn't a tag key — covers the OWN pseudo-box). A
  `sizeOf(id)` closure wraps the existing `count()` helper.
- Dispatcher in `layout()`:
  - `viewMode === "euler-true"` → `layoutEulerTrue(data, sized, opts)`
    (unchanged, default `shelfPack`).
  - `viewMode === "bubblesets"` → `layoutEulerTrue(data, sized, opts,
    boundSiblingOverlapPack)`.

## Risks / non-goals

- This is a heuristic force relaxation, not an exact area-proportional Venn
  solver — rectangles, not arbitrary curves, so perfect Euler correctness
  (every region's area exactly matching set size) is out of scope. The goal
  is "visibly closer to an Euler reading" (sharing ⇒ proximity/overlap,
  disjoint ⇒ separation), not mathematical exactness.
- Iteration count (60) and overlap cap (0.7) are heuristic constants tuned
  by inspection; no automated visual-quality test exists for this, so
  validation is manual (build the plugin, drill down into a multi-tag
  selection, confirm overlapping tags visually cluster/overlap and disjoint
  tags separate).
- Performance: O(n²) per iteration over sibling-box count at each forest
  level. `bubblesets` is a closeup (drill-down) mode operating on a
  filtered subset of nodes (`focusNodeIds`), so sibling-box counts are
  small (single selected group's tags) — not a concern at this scope.
