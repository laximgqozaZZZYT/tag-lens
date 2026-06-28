# Ralph backlog — Tag Lens

Single source of truth for the autonomous loop. **Ordered smallest/safest first.**
The loop picks the topmost open `- [ ]` item it can finish *and* `npm run verify`
in one iteration. Large items must be decomposed into sub-steps rather than attempted
whole. Check off `- [x]` with the commit short-hash; append discovered follow-ups.

> Conventions: commit subject `Kaizen:`/`Feat:`/`Fix:`; gate = `npm run verify`;
> never push; pure-module-plus-test is preferred over editing inside `view.ts`.

## Open

### Small / additive (do these first to build momentum)

(none open)

### Medium

- [ ] **P2 — make `view.ts` `draw()` a thin dispatcher.** Each mode already delegates
      to a pure `drawX` (drawLattice/drawDroste/…). Extract the per-mode input
      assembly into pure builders (same pattern as `buildModeLegendInput`) so `draw()`
      becomes a small mode→builder→drawX dispatch. Decompose: one mode per iteration.
  - [x] lattice → `computeLatticeDrawInput` (`src/draw/lattice-draw-input.ts`) +
        `test/lattice-draw-input.test.ts`; `DrawLatticeOpts` now exported.
  - [x] droste → `computeDrosteDrawInput` (`src/draw/droste-draw-input.ts`) +
        `test/droste-draw-input.test.ts`; the `this.drosteHit = []` assign-and-pass
        stays in the view wrapper, `hiddenSet` is built from settings in the builder. — 61898d2
  - [x] heatmap → `computeHeatmapDrawInput` (`src/draw/heatmap-draw-input.ts`) +
        `test/heatmap-draw-input.test.ts`; `DrawOpts` in `draw-heatmap.ts` exported as
        `DrawHeatmapOpts`. All three modes (lattice/droste/heatmap) now go through
        pure builders.
  - [x] upset → `computeUpsetDrawInput` (`src/draw/upset-draw-input.ts`) +
        `test/upset-draw-input.test.ts`; `drawUpsetFooter` now takes a `DrawUpsetOpts`
        object (was 10 positional args) — canvasW/H come from `canvas.clientWidth/Height`
        in the builder. Smoke-test call site updated. Remaining `draw()` modes
        (bubblesets, default node graph) inline their assembly inside the world-map
        tiling body loop (`drawBodyTile`), which is more entangled — decompose next. — ecad63b

- [ ] **BubbleSets visibility & density.** A written 3-task plan exists at
      `docs/superpowers/plans/2026-06-22-bubblesets-visibility-and-density.md`
      (currently untracked — `git add` it as the first sub-step). Execute its Task 1
      → 2 → 3, one task per iteration, honouring its "do not change public signatures"
      constraint and its baseline assertion count.

- [ ] **N2 — `registerView` re-enable robustness.** Rapid plugin disable/enable re-runs
      `registerView` → "existing view type" console error (`src/main.ts` onload).
      Benign but a robustness gap; guard the re-registration.

### Large (decompose — do last, one sub-step per iteration)

- [ ] **P3 — break up `ensureNoteMenu()` (762 lines, `src/view.ts`).** The single
      largest method. Note-menu is entangled with the settings/data panels, so go
      slow: peel off ONE pure DOM-structure builder (returns a plain descriptor the
      view applies) per iteration, each with a unit test, never changing behaviour.
      Add sub-steps here as you discover the seams.

- [ ] **F2 — first-class scatter mode.** 2D quantitative axes + zoom/pan as a proper
      view mode. Large feature: first iteration writes a short plan under
      `docs/<latest>/`, then implement layout → draw → settings → E2E across iterations.

## Done

(loop appends `- [x] <item> — <short-hash>` here)

- [x] **R5′ — settings type-rot guard test.** Already covered by
      `test/settings-parity.test.ts` (no-undefined defaults + JSON round-trip +
      inventory key-set lock on `DEFAULT_SETTINGS`). No new work needed.
- [x] **P4 — `view.ts` line-count ratchet.** `test/view-line-ratchet.test.ts`
      fails if `src/view.ts` exceeds baseline 4478 (ratchet only goes down). — 4045e0e
- [x] **P1 — cognitive-complexity baseline.** Enabled
      `complexity/noExcessiveCognitiveComplexity` at `warn` in `biome.json` (warnings
      don't fail `biome lint`, so verify stays green); baseline **111 offenders**
      (max score 163, top file `view.ts` ×16) recorded in
      `docs/0.3.21/complexity-baseline.md`. Ratchet-to-`error` deferred to a later item.
- [x] **Categorical `scale.reverse` (latent bug).** Categorical colour path now
      honours `config.reverse` (flips the auto-colour INDEX; keyed palette overrides
      and legend key-order unchanged; legend↔node invariant preserved). Tests added
      in `test/encoding-scales.test.ts`. — b5458e4

## Blockers

(loop appends `> BLOCKER:` notes here when verify cannot be made green)
