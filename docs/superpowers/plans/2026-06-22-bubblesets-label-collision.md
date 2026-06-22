# BubbleSets Cluster-Label Collision Avoidance Implementation Plan

**Goal:** In `bubblesets` mode only, de-conflict cluster label cells so
overlapping enclosures' tag names (`host`, `inferno`, `timeline`, …) no longer
land on top of each other. `euler-true` and every other `viewMode` keep
byte-identical `labelCells` output.

**Architecture:** A new pure function `placeClusterLabels()` in
`src/layout/label-collision.ts` takes each cluster's desired label cell + its
enclosure box and returns a de-conflicted centre per label (greedy,
largest-first, candidate corner/edge positions — mirroring the existing
`drawOverviewLabels()` convention). `layoutEulerTrue()` applies it to
`labelCells` immediately before its `return`, guarded by
`opts.viewMode === "bubblesets"`.

**Tech Stack:** TypeScript, no new dependencies. Tests use the repo's
zero-dependency `test/assert.ts` (`ok`/`approx`) harness via `node test/run.mjs`
(`npm test`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-22-bubblesets-label-collision-design.md`.
- Change isolated to `bubblesets`. `euler-true` `labelCells` must be
  byte-identical (regression-pinned).
- Do not touch: `siblingOverlapPack`, degree-cascade region placement,
  containment-forest construction, label sizing, `draw-card.ts`,
  exclave/sub-piece generation, the box-overlap stripe pass, or
  `drawClusterLabels()` (the fix is at layout time).

---

### Task 1: `placeClusterLabels` — greedy label de-confliction

**Files:**
- Create: `src/layout/label-collision.ts`
- Test: `test/label-collision.test.ts`
- Modify: `test/index.ts` (register the new test file)

- [ ] Step 1: Write failing tests covering:
  - empty input -> empty output
  - single label -> unchanged desired position
  - two clusters whose desired label cells overlap -> output cells do NOT
    overlap (AABB)
  - two clusters with disjoint desired cells -> unchanged (already clear)
  - every chosen cell stays inside its own cluster box
- [ ] Step 2: Run `npm test` -> FAIL (module missing).
- [ ] Step 3: Implement `placeClusterLabels` per spec (largest-area-first,
  candidate corners/edges/centre clamped inside box, first-non-colliding wins,
  desired-position fallback).
- [ ] Step 4: Run `npm test` -> PASS.
- [ ] Step 5: Commit.

---

### Task 2: Wire `placeClusterLabels` into `layoutEulerTrue` for `bubblesets` only

**Files:**
- Modify: `src/layout/layout.ts` (import + pre-return block in `layoutEulerTrue`)
- Test: `test/bubblesets-label-collision.test.ts`
- Modify: `test/index.ts` (register the new test file)

- [ ] Step 1: Write failing tests:
  - Build a fixture with heavily-overlapping tags (reuse the
    `bubblesets-sibling-overlap` style fixture). Assert that in `bubblesets`
    mode no two `labelCells` AABBs overlap.
  - Regression: capture `euler-true` `labelCells` for the same fixture and
    assert they are identical before/after (deterministic across two runs,
    and that the bubblesets-only branch did not perturb them — compare
    `euler-true` cells to a run where the pass is logically disabled by mode).
- [ ] Step 2: Run `npm test` -> FAIL on the bubblesets non-overlap assertion.
- [ ] Step 3: Add the import and the guarded pre-return block in
  `layoutEulerTrue`.
- [ ] Step 4: Run `npm test` -> PASS (including existing
  `bubblesets-*`, `sibling-overlap-pack`, `euler-true-stripes`, etc.).
- [ ] Step 5: Commit.

---

### Task 3: Full-suite regression + build

- [ ] `npm test` all green.
- [ ] `npm run build` exits 0.
- [ ] Manual visual confirmation in Obsidian (deploy to dev vault, drill into a
  multi-tag selection, confirm previously-overlapping tag names are separated;
  confirm `euler-true` panorama unaffected).
