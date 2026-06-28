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

- [x] **P2 — make `view.ts` `draw()` a thin dispatcher.** Each mode already delegates
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
  - [x] cluster enclosures (bubblesets/euler) → `computeEnclosureDrawInput`
        (`src/draw/enclosure-draw-input.ts`) + `test/enclosure-draw-input.test.ts`.
        Returns null when suppressed (toggle off / UpSet); `kind` selects the
        bubblesets-vs-euler painter (both share one arg shape) so `drawBodyTile`
        is now a thin `paint = kind === … ? drawBubbleSets… : drawEuler…` dispatch. — 64a13f2
  - [x] edges (ghost/base/accent) gating → `computeEdgeDrawPlan`
        (`src/draw/edge-draw-plan.ts`) + `test/edge-draw-plan.test.ts`. The three
        inline `if` conditions in `drawBodyTile` now read a `{drawGhost, drawBase,
        drawAccent}` plan; the view keeps the actual draw*Edges calls + live args. — 04e0e72
  - [x] node-card base/highlighted partitioning → `computeNodeDrawList`
        (`src/draw/node-draw-list.ts`) + `test/node-draw-list.test.ts`. The two
        `for (n of laid.nodes)` passes now loop over a pre-partitioned
        `{base, highlighted}` list (skip/aggregated rules in the builder); the
        `drawCard` calls + the junihitoe/aggregate-stack loops stay in the view. — 9fcaaf9
  - [x] junihitoe stacks → `computeJunihitoeStackList`
        (`src/draw/junihitoe-stack-list.ts`) + `test/junihitoe-stack-list.test.ts`.
        Gating (showNodes / non-empty groups / non-empty nodes), card size from
        `nodes[0]`, and the per-group "high iff any member highlighted" rule now live
        in the builder; the view keeps the `drawJunihitoeStack` calls. — f974229
  - [x] aggregate stacks → `computeAggregateStackList`
        (`src/draw/aggregate-stack-list.ts`) + `test/aggregate-stack-list.test.ts`.
        Builder iterates `laid.clusters`, reads `aggregateCount.get(groupKey)`
        (skips falsy counts), `highlightedClusters.has(groupKey)` for `isHigh`, with
        `nodes[0].{width,height}` card size + showNodes/non-empty-count/non-empty-nodes
        gating; the view keeps the `drawAggregateStack` calls. All `draw()` stack
        loops (junihitoe + aggregate) now go through pure builders.
        **P2 complete** — every `draw()` mode/sub-loop now has a pure input builder. — adb45ab

- [x] **BubbleSets visibility & density** — **OBSOLETE, no code change.** The 3-task
      plan at `docs/superpowers/plans/2026-06-22-bubblesets-visibility-and-density.md`
      targets code that no longer exists. Verified against the current tree:
      - Task 1 (degree-cascade `hostTag` selection in `layout.ts`): the whole
        degree-cascade region placement was removed — see the comment at
        `src/layout/layout.ts:1107` ("dead and has been removed"). `hostTag` and
        `test/bubblesets-region-sizing.test.ts` are gone.
      - Task 2 (`drawOverviewLabels` in `draw-helpers.ts`): no such symbol remains;
        only a stale doc-comment reference in `src/layout/label-collision.ts:10`.
      - Task 3 (`siblingOverlapPack` in `src/layout/sibling-overlap-pack.ts`): the
        whole file is deleted.
      Commit `de09d1a` ("Kaizen: …dead-pipeline + junk cleanup", 2026-06-27) rewrote
      bubblesets onto `componentEulerLayout` + box-follow recompute and deleted the
      old sibling-overlap / degree-cascade pipeline (9 modules + 7 tests), making all
      three plan tasks moot. Note that Task 3 had in fact already been implemented
      earlier (`f6dfe51`, then `06ceaea`) before the cleanup removed it.
      **Follow-up (NOT verified — needs fresh investigation):** if the original visual
      symptoms still recur on the new layout — small specific intersections buried
      under a larger cluster's fill, or a tag name appearing twice (chip + giant
      watermark) — they must be re-diagnosed against `componentEulerLayout` /
      `draw-enclosures.ts` / `label-collision.ts`, not this stale plan. File a new
      backlog item with a fresh repro if observed in-app.

- [x] **N2 — `registerView` re-enable robustness.** Rapid plugin disable/enable re-runs
      `registerView` → "existing view type" console error (`src/main.ts` onload).
      Guarded the `onload` registration in a try/catch that rethrows anything other
      than the benign "already registered" race (no public viewRegistry-introspection
      API is typed, so catch is the proportionate guard). — e2ab0fd

### Large (decompose — do last, one sub-step per iteration)

- [ ] **P3 — break up `ensureNoteMenu()` (762 lines, `src/view.ts`).** The single
      largest method. Note-menu is entangled with the settings/data panels, so go
      slow: peel off ONE pure DOM-structure builder (returns a plain descriptor the
      view applies) per iteration, each with a unit test, never changing behaviour.
      Add sub-steps here as you discover the seams.
  - [x] panel/head CSS chrome → `noteMenuPanelStyle` / `noteMenuHeadStyle`
        (`src/interaction/note-menu-geom.ts`) + cases in `test/note-menu-geom.test.ts`.
        The two inline pinned-vs-floating `setCssStyles` blocks are now thin
        applications of pure style builders. — 6568a23
  - [x] Data sub-tab button styling → `noteMenuTabButtonStyle(on, size)`
        (`src/interaction/note-menu-geom.ts`) + cases in `test/note-menu-geom.test.ts`.
        `styleDSubs`'s inline `setCssStyles` block is now a thin application of the
        pure builder; `size` (padding/fontSize) is a param so the same builder
        serves both tab strips. The `D_SUBS` descriptor list + event wiring stay
        in the view. — 9d6041a
  - [x] top-level tab strip → `styleTabs`'s inline `setCssStyles` block is now a thin
        application of `noteMenuTabButtonStyle(on, {padding: "6px 14px", fontSize:
        "11px"})` (already test-covered at `test/note-menu-geom.test.ts:109`). The
        `TABS`/`tabBtns`/event wiring stay in the view. — 9d7faee
  - [x] title-row button descriptors → `noteMenuTitleButtons(pinned)`
        (`src/interaction/note-menu-geom.ts`) + cases in `test/note-menu-geom.test.ts`.
        Returns `{pin, close}` descriptors (each `{style, ariaLabel, icon?}`); the pin
        icon/colour/label flip with `pinned`, close is static. The view applies the
        styles/attrs (`setCssStyles`/`setIcon`/`setAttr`) and keeps all event wiring.
  - [x] body-panel container chrome → `noteMenuBodyPanelStyle(kind, display)`
        (`src/interaction/note-menu-geom.ts`) + cases in `test/note-menu-geom.test.ts`.
        The 7 inline base-style blocks for the body panes (dataTabWrap/treeTab as
        `"column"`; logicTab/tableTab/jsonTab/settingsTab/insightTab as `"scroll"`)
        are now thin applications of the pure builder; `display` carries the initial
        show/hide state. `bodyWrap` stays inline (distinct overflow:hidden); the
        per-tab display toggles in showDSubTab/showTab stay in the view. — 44b0950
  - [x] title-row container chrome → `noteMenuTitleRowStyle()`
        (`src/interaction/note-menu-geom.ts`) + a case in `test/note-menu-geom.test.ts`.
        Returns `{row, btns}` static layout records (the row's space-between flex +
        the right-aligned no-shrink button group); the two inline `setCssStyles`
        blocks for titleRow/headBtns are now thin applications. No state branch.
  - [x] tab-bar chrome → `noteMenuTabBarStyle(kind)`
        (`src/interaction/note-menu-geom.ts`) + a case in `test/note-menu-geom.test.ts`.
        The two static inline `setCssStyles` blocks for the top-level tab bar
        (`"top"`: top gap + 11px text, no wrap) and the Data sub-tab bar
        (`"sub"`: flexWrap + padded edge) are now thin applications; both share the
        bottom divider. No state branch.
  - [x] tab-strip descriptor lists → `noteMenuTopTabs()` / `noteMenuDataSubTabs()`
        (`src/interaction/note-menu-geom.ts`) + cases in `test/note-menu-geom.test.ts`.
        The inline `TABS`/`D_SUBS` literal arrays are now thin calls to pure
        builders, and the new `NoteMenuTab`/`NoteMenuDataSubTab` exported types are
        the single source of truth for both the `activeMenuTab`/`dataSubTab` field
        types and the rendered button keys/labels. The three manual `mkTab(...)`
        calls collapse into one `for (… of TABS) mkTab(key, label)` loop; all event
        wiring stays in the view. — 1b65735
  - [x] Settings sub-tab descriptor list → `settingsSubTabs()` / `SettingsSubTab`
        (`src/panel/settings-tabs.ts`) + `test/settings-sub-tabs.test.ts`. The inline
        `SubKey` type + `SUBS` literal array in `renderSettingsBody` are now a thin
        call to a pure builder, and the exported `SettingsSubTab` type is the single
        source of truth for both the `settingsSubTab` field type and the rendered
        button keys/labels (mirrors the note-menu `noteMenuTopTabs`/`noteMenuDataSubTabs`
        extraction). The `styleSubs`/button/event wiring stays in the view. — 47ae01f
  - [x] Settings sub-tab styling dedup → `renderSettingsBody`'s `styleSubs` inline
        `setCssStyles` block was byte-identical to `noteMenuTabButtonStyle` except
        padding/fontSize (already params); collapsed it into a thin
        `noteMenuTabButtonStyle(on, { padding: "4px 8px", fontSize: "10.5px" })` call,
        killing the last duplicated underline-tab style block. No behaviour change
        (same fields/values); already test-covered at `test/note-menu-geom.test.ts`.
  - [ ] next seams to peel (pure builders, one per iteration): the Settings form-row
        builders inside `renderSettingsViewTab`/`renderSettingsDisplayTab`/
        `renderSettingsEncodeTab` (`settings-tabs.ts`) remain — investigate seams there.

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
