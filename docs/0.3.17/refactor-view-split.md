# Design plan — incremental split of `src/view.ts`

## Goal
`MiniGraphView` (`src/view.ts`, originally ~6512 lines) became a god-file. To improve
reviewability, testability and complexity, move concerns out into separate modules
**while fully preserving behaviour**.
※ Through Tier 1–3 the settings UI, tabs, and Insight engine were extracted successfully
(view.ts is now ~5200 lines), confirming the split approach is safe and effective.

## Constraints & approach (important)
- **TS has no partial classes.** Rather than splitting the class across files, extract each
  method into a **free function that takes `deps`**, leaving the view side as a thin delegator.
- **There is a proven pattern in this repo**: `src/panel-sections.ts` already extracts
  `renderToggleSection` / `renderOrderBySection` as free functions taking deps like
  `{ settings, save, redraw }`. **Rolling this pattern out further** is the lowest-risk path.
- **Behaviour-preserving refactor.** Run a small PDCA — one module extraction → **`npm run verify`**
  (tsc && test && build) green → commit — so it is safe to stop mid-way. Also check reflection
  regressions via the E2E (`test/e2e-display.mjs` family).

## Current clusters (line ranges, estimates)
| Cluster | Approx. range | Approx. lines | Coupling |
|---|---|---|---|
| ✅ Settings UI sections (renderMinFont/NodeDisplay/OrderBy …) | extracted | done | resolved |
| ✅ Settings tabs (Settings Tabs / FilterBody …) | extracted | done | resolved |
| ✅ Insight (computeCognitiveLoad / renderInsight* / computeTagSuggestions / classification actions) | extracted → `src/insight/` | done | resolved |
| Drawing (draw / drawBodyTile / drawCard* / drawGlobalDisplayFallbacks) | ~3180–4000 | ~750 | **high** |
| Input/hit-test, rebuild wiring, export, note menu | scattered | remaining | mid–high |
> Line numbers drift; re-anchor with `grep -n` when starting (view.ts is a god-file).

## Staged plan (safe → risky)
### ✅ Tier 1 (done) Settings UI sections → `src/panel/settings-sections.ts`
- **Status**: done. ~12 settings-UI components extracted; the `view.ts` side became thin delegators.
  The free-function (DI) approach was validated.

### ✅ Tier 2 (done) Settings tabs → `src/panel/settings-tabs.ts`
- **Status**: done. `renderSettingsView/Filter/Sort/Display/Encode/Layers` and `renderFilterBody`
  extracted, dissolving the giant rendering block in `view.ts`. The DI pattern works at the tab level too.

### ✅ Tier 3 (done) Insight → `src/insight/{compute.ts, render.ts, actions.ts}`
- **Status**: done. `computeCognitiveLoad` / `computeTagSuggestions` are mostly pure (nodes/settings
  passed as args, leaving room for unit tests). `renderInsight*` and the classification actions
  (`applyGolderClassification` / `convertToNestedTag`) are free functions receiving `app` (file ops) via deps.

### Tier 4 (deferred, high-risk) Drawing `draw*`
- `draw()` is tightly coupled to `this.laid/zoom/panX/panY/ctx/canvas/encParams/activeStatusColors…`.
  Parameterising it would create a huge `deps` object that hurts readability instead of helping.
- Approach: keep `draw()` **as a thin orchestrator inside view**. The heavy per-mode drawing is already
  split into `draw-card.ts`/`draw-matrix.ts`/`draw-heatmap.ts`/`draw-stream.ts`/`draw-lattice.ts`/
  `draw-upset.ts` etc. If needed, extract the remaining `drawBodyTile`/`drawCardGrid`/`drawClusterLabels`
  the same way (last, carefully).

## Expected outcome & metrics
- 6512 lines → core view.ts ~3500 lines + several <1000-line modules (Tier 1–3 already moved ~1300 lines out; view.ts is now ~5200 lines).
- Metrics: trend of `wc -l src/view.ts`, keeping `npm run verify` green, smaller review units.

## How to proceed
- **One extraction = one commit** (`refactor(view): extract <section> to panel/settings-sections (no behavior change)`).
- Before starting, follow `AGENTS.md` (verify required / `grep -a` for layout.ts / E2E reflection check + cleanup).
- Note: this versioned design doc is tracked under `docs/0.3.17/`; superseded notes live in `docs/old/`.
