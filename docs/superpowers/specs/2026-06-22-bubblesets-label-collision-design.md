# BubbleSets: cluster-label collision avoidance

## Problem

`bubblesets` mode now places cross-cutting sibling tag boxes so they
*intentionally overlap* in proportion to shared membership
(`siblingOverlapPack`, degree-cascade region placement). This is the desired
Euler-diagram reading for the enclosures — but the cluster **labels** were not
updated to cope with it.

In `layoutEulerTrue()` (`src/layout/layout.ts`, the `place()` closure, ~line
1066) each cluster's `labelCell` is computed independently as
`x = box.x + gap + labelWidth/2`, `y = box.y + labelStrip/2`. For
`euler-true` (panorama "Containment map") the cluster boxes never share
interior area at the top-left corner, so these label cells never collide and
the renderer can assume non-overlap. `drawClusterLabels()`
(`src/draw/draw-helpers.ts`, ~line 482) is explicitly documented to rely on
that assumption ("it is already on a grid cell, clear of nodes and of every
other label's cell, so no search / de-confliction is needed").

Once `bubblesets` makes boxes overlap, multiple label cells derived from
near-coincident box top-left corners land on top of each other. Real-device
screenshots showed tag names like `host`, `inferno`, `timeline` overlapping
and becoming unreadable.

## Scope

- Changes are isolated to **`bubblesets` mode only**. `euler-true` and every
  other `viewMode` keep byte-identical `labelCells` output — verified by a
  regression test pinning `euler-true`'s label-cell coordinates to the
  pre-change values, and by the new code being guarded by
  `opts.viewMode === "bubblesets"`.
- No change to: `siblingOverlapPack`, degree-cascade region placement,
  containment-forest construction, label *sizing*, node-card drawing
  (`draw-card.ts`), exclave / sub-piece generation, or the visible
  box-overlap stripe pass.
- `drawClusterLabels()` is **not** modified. The fix happens at layout time
  (the label cells handed to the renderer are already de-conflicted), so the
  renderer keeps its existing "draw each cell as-is" contract.

## Design

### New file: `src/layout/label-collision.ts`

```ts
export interface LabelPlacementInput {
  key: string;
  // Desired (default) label-cell centre + size, as currently computed.
  x: number; y: number; w: number; h: number;
  // The cluster's MAIN box (top-left origin), used to derive alternative
  // candidate anchor positions (corners / edge midpoints) for this label.
  box: { x: number; y: number; w: number; h: number };
}

export function placeClusterLabels(
  inputs: LabelPlacementInput[],
): Array<{ x: number; y: number }>;
```

Pure function. Returns, in the **same order as `inputs`**, the de-conflicted
label-cell **centre** for each input. Size (`w`/`h`) is unchanged — only the
centre moves — so the caller mutates just `cell.x` / `cell.y`.

Algorithm (mirrors `drawOverviewLabels()`'s greedy, largest-first
convention in `draw-helpers.ts`):

1. **Order**: process inputs largest-box-area first. A bigger enclosure's
   label is more important to keep at its natural top-left strip; smaller
   boxes yield and move to an alternate corner.
2. **Candidates** per label, tried in order, each an AABB of size `w`×`h`
   placed relative to the cluster box:
   - the desired position (current top-left label strip) — index 0,
   - top-right strip, bottom-left strip, bottom-right strip,
   - top-centre, bottom-centre,
   - box centre (last-resort interior anchor).
   Every candidate is clamped to stay fully inside the cluster box so the
   label never escapes its own enclosure (matching `drawClusterLabels`'
   existing clamp intent).
3. **Acceptance**: take the first candidate whose AABB does not overlap any
   already-placed label AABB. If none is clear, fall back to the desired
   position (index 0) — best effort, never drop a label (consistent with
   the layout layer always emitting one cell per cluster; the renderer, not
   this pass, decides visibility).
4. Record the chosen AABB as placed and continue.

`O(n²)` over cluster count. `bubblesets` is a closeup (drill-down) mode over
a filtered node subset, so cluster counts are small — not a concern.

### `layout.ts` changes

- Import `placeClusterLabels` from `./label-collision`.
- Immediately **before** `layoutEulerTrue()`'s `return { ..., labelCells }`
  (~line 1299), add a guard:

  ```ts
  if (opts.viewMode === "bubblesets" && labelCells.length > 1) {
    // build inputs from labelCells + each cluster's main box, call
    // placeClusterLabels, then mutate each labelCell's x/y in place.
  }
  ```

  For any `viewMode !== "bubblesets"` the block is skipped entirely, so
  `labelCells` is byte-identical to today.
- The cluster box for a label is its `main` piece (the filled enclosure),
  found via `clusters.find(c => c.groupKey === cell.key)` then
  `pieces.find(p => p.kind === "main" && !p.contour)`, falling back to the
  cluster's overall bbox. A cell whose cluster can't be found keeps its
  desired position.

## Risks / non-goals

- Heuristic greedy placement, not a global optimum — two labels may still be
  close if every candidate for the smaller one collides (then it uses its
  desired spot as best effort). The goal is "no exact-overlap of legible tag
  names in the common case", not provably-optimal label layout.
- Candidate count / ordering are tuned by inspection; validation of visual
  quality is manual (build, drill into a multi-tag selection, confirm the
  previously-overlapping names are now separated). The automated guarantee is
  limited to "two overlapping clusters' label cells do not overlap after the
  pass" and "euler-true label cells are unchanged".
