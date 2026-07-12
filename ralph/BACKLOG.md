# Ralph backlog — Tag Lens

Single source of truth for the autonomous loop. **Ordered smallest/safest first.**
The loop picks the topmost open `- [ ]` item it can finish *and* `npm run verify`
in one iteration. Large items must be decomposed into sub-steps rather than attempted
whole. Check off `- [x]` with the commit short-hash; append discovered follow-ups.

> Conventions: commit subject `Kaizen:`/`Feat:`/`Fix:`; gate = `npm run verify`;
> never push; pure-module-plus-test is preferred over editing inside `view.ts`.

## Open

### Highest priority — user-facing correctness bug

- [x] **`.base` filter grammar — `containsAny`/`containsAll` etc. (graph goes empty).**
      `file.tags.containsAny("書籍","小説")` matches 0 notes because `unquote` mangles the
      multi-arg string and `evalCond` only knows `contains`. Full spec + decomposed
      tasks T1–T4 in `docs/superpowers/plans/2026-06-30-base-filter-grammar.md`. Do ONE
      sub-task (T1→T4) per iteration. Keep `src/bases/parser.ts` & `resolve.ts` pure
      (no `obsidian`) and **never throw** on unknown grammar. **DONE** (T1–T4). — 5a9b24a
  - [x] **T1 — `BaseCond` multi-value.** Added optional `args?: string[]` to `BaseCond`
        (`src/bases/types.ts`) alongside the single-value `rhs`; complementary, so the
        single-value path stays backward-compatible. Type-only, no behaviour change. — 3b4a1b6
  - [x] **T2 — parse multi-arg method forms.** `parseCond` method form now uses a
        `splitArgs` helper (top-level comma split, quoted commas preserved) → `unquote`
        each into `args[]`; `args[0]` mirrored into `rhs`. Blank arg list → `args:[]`,
        `rhs:""`. Never throws. Added containsAny/quoted-comma/single-arg/empty-arg cases
        to `test/bases-parser.test.ts`. — c690bb4
  - [x] **T3 — `evalCond` operators.** Added `containsAny`/`containsAll`/`containsNone`
        (tag-aware with `#` optional + generic over array fields / scalar substrings),
        `startsWith`/`endsWith` over scalars, and a defensive array-aware `IN`. Unknown
        op still falls back to `false` (no throw). Added true/false cases (incl. the real
        `containsAny("書籍","小説")` bug + non-tag array field + unknown-op) to
        `test/bases-resolve.test.ts`. — 0bf5d39
  - [x] **T4 — finish.** New `test/bases-containsany-smoke.test.ts` drives the full
        pipeline the way `parseBaseFile` does — `parseBaseStructure` (the object
        `parseYaml` yields) → `resolveElements` — over the bug-report filter
        `file.tags.containsAny("書籍","小説")`, asserting it resolves the two tagged
        notes (graph NON-empty) and no others. `npm run verify` green. CDP/E2E stays
        blocked in the sandbox, so this headless smoke is the behaviour gate. — 5a9b24a

### Small / additive (do these first to build momentum)

- [x] heatmap cell-click detail → `heatmapCellNoteIds(nodeIds, i, j)`
      (`src/interaction/heatmap-detail.ts`) + `test/heatmap-detail.test.ts`. The inline
      diagonal-vs-intersection + dedup block in `view.ts`'s `openHeatmapDetail` (diagonal
      i===j → the whole cell's notes; off-diagonal → the row-i∩row-j intersection in
      first-seen order; both `[...new Set]`-deduped) is now a pure transform; the view
      keeps `heatmapSelected = null` + `switchToCloseup`. Out-of-range indices resolve to
      empty (missing row → no notes, no throw); input never mutated. Not an `ensureNoteMenu`
      seam but a clean pure data-transform discovered while seam-hunting. — c86d597

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
        (same fields/values); already test-covered at `test/note-menu-geom.test.ts`. — 5cdc35e
  - [x] View-mode picker partitioning → `partitionViewModePicker(modes, currentMode)`
        (`src/panel/view-mode-picker.ts`) + `test/view-mode-picker.test.ts`. The three
        inline `VIEW_MODES.filter(...)` calls (closeup / panorama-stable / experimental)
        plus the `expSelected` initial-expand flag in `renderViewModeSection`
        (`settings-sections.ts`) are now a single thin call to a pure builder; the DOM
        section/header/option-loop wiring stays in the view. `isPanorama` import dropped
        from `settings-sections.ts` (now only used in the builder). — 14158ba
  - [x] Bridge-finder Jaccard parse/clamp → `parseGhostJaccard(raw)`
        (`src/panel/jaccard-input.ts`) + `test/jaccard-input.test.ts`. The inline
        `parseFloat` + `!NaN && 0..1` accept/reject rule in `renderSettingsDisplayTab`
        is now a thin call to a pure parser that returns the value on accept or `null`
        to reject (→ keep current + reset input); the toggle/input DOM + save/rebuild
        wiring stay in the view. Behaviour-identical (same parseFloat semantics, same
        closed [0,1] range, same reset-on-reject). — 578728e
  - [x] Bases "Show Edges" edge-kind descriptor list → `basesEdgeKinds()` / `BasesEdgeKind`
        (`src/panel/bases-edge-kinds.ts`) + `test/bases-edge-kinds.test.ts`. The inline
        `edgeKinds` literal array (key↔label mapping) in `renderBasesDisplaySection` is now
        a thin call to a pure builder; the toggle-row DOM + save/rebuild wiring stay in the
        view. Test locks key/label/order against `DEFAULT_SETTINGS` (each key is a real
        boolean field). Mirrors the `noteMenuTopTabs`/`settingsSubTabs` extractions. — 52d9a17
  - [x] Bases cluster/prefix toggle rows → `basesToggleRows()` / `BasesToggleRow`
        (`src/panel/bases-toggle-rows.ts`) + `test/bases-toggle-rows.test.ts`. The two
        byte-identical inline clusterRow/prefixRow blocks in `renderBasesDisplaySection`
        (differing only in settings key + label) are now a single thin render loop over a
        pure descriptor list; test locks key/label/order against `DEFAULT_SETTINGS` (each
        key a real boolean field). Mirrors the `basesEdgeKinds` extraction. — 186b1e7
  - [x] standalone Settings toggle-row descriptors → `bridgeGhostEdgeToggle()` /
        `legendToggle()` / `SettingsToggleRow` (`src/panel/settings-toggle-rows.ts`) +
        `test/settings-toggle-rows.test.ts`. The Bridge-finder "Show ghost edges" row
        (`renderSettingsDisplayTab`) and the "Show legend on canvas" row
        (`renderSettingsEncodeTab`) now read their key↔label from pure descriptors;
        the handler-specific side effects (save+rebuild for ghost; legendHiddenModes
        reset + requestDraw for legend) stay inline in the view. Test locks each
        key/label against `DEFAULT_SETTINGS` (both real boolean fields). Mirrors the
        `basesToggleRows`/`basesEdgeKinds` extractions. — 765a147
  - [x] Min-Jaccard number-input descriptor → `ghostJaccardInput()` /
        `GhostJaccardInputDescriptor` (`src/panel/jaccard-input.ts`, next to its
        parser) + cases in `test/jaccard-input.test.ts`. The inline `"Min Jaccard
        similarity:"` label + `{step:"0.05",min:"0",max:"1"}` attrs in
        `renderSettingsDisplayTab` now read from the pure descriptor; step/min/max
        bounds mirror `parseGhostJaccard`'s closed [0,1] range (test round-trips the
        min/max strings through the parser). The DOM + change-handler wiring stay in
        the view. — 5fc9be4
  - [x] Min-font clamp/descriptor → `clampMinFont(raw)` / `minFontInput()`
        (`src/panel/min-font-input.ts`) + `test/min-font-input.test.ts`. The inline
        `Math.max(0, Math.min(48, Math.floor(Number(v)||0)))` floor-clamp + the
        `{min:"0",max:"48",step:"1"}` number-input attrs in `renderMinFontSection`
        (`settings-sections.ts`) now read from pure builders; bounds round-trip
        through the clamp in the test. Mirrors the `jaccard-input` extraction
        (clamp-not-reject: junk → 0, out-of-range snaps to nearest bound). — 8ce2ec9
  - [x] Heatmap Min-tag clamp/descriptor → `clampHeatmapMinTag(raw)` /
        `heatmapMinTagInput()` (`src/panel/heatmap-min-tag-input.ts`) +
        `test/heatmap-min-tag-input.test.ts`. The inline `Math.max(1, floor(Number(...)
        || 1))` clamp + `min="1"` attr in `renderHeatmapMinTagControl`
        (`settings-sections.ts`) now read from pure builders; the min bound
        round-trips through the clamp in the test. Mirrors the `min-font-input`
        extraction (clamp-not-reject, no upper bound: junk / below-1 → 1). — 1c51fd7
  - [x] `renderNodeDisplaySection` size-row parse/descriptor → `parseNodeSize(raw, max)`
        / `nodeSizeInput()` (`src/panel/node-size-input.ts`) + `test/node-size-input.test.ts`.
        The inline `parseInt` + `Number.isFinite && 1..N` accept/reject rule for the
        "Size (m × n)" inputs now reads from a pure parser (reject-not-snap; caller picks
        max=8 layer / 12 global, preserving the original asymmetry) + a static min/max/step
        descriptor. The override-delete (layer) / keep-current (global) side effects + DOM
        wiring stay in the view. Mirrors the `min-font-input` / `heatmap-min-tag-input`
        extractions. — 2db1b78
  - [x] "Inherit from" `<select>` option list → `inheritFromOptions(clusters, current,
        excludeKey?)` / `InheritFromOption` (`src/panel/inherit-from-options.ts`) +
        `test/inherit-from-options.test.ts`. The two near-duplicate option-list builders
        in `renderSetLayerTab` (no exclusion) and `renderLayerTab` (excludes self) now
        share one pure builder returning `{value,text,selected}[]` including the leading
        `(none)` option; the `createEl("option")` + change-handler wiring stay in the
        view. Test locks the (none)-first order, single-selection rule, and self-exclusion. — cf690af
  - [x] note-menu bulk Select/Deselect-all → `bulkSetHidden(current, keys, hide)`
        (`src/interaction/note-menu.ts`, next to `hideKey`/`nodeIsHidden`) + cases in
        `test/note-menu.test.ts`. The two inline `hiddenNodes` mutation loops in
        `ensureNoteMenu` (per-node indexOf+splice for show / push-if-absent for hide)
        are now a single pure array transform; hide appends de-duped in push order,
        show removes the listed keys, input never mutated. Behaviour-identical
        (dedup-on-add makes filter-all == legacy first-occurrence splice). — a974ba6
  - [x] inactive-tab hover hint → `noteMenuTabHoverStyle()`
        (`src/interaction/note-menu-geom.ts`) + a case in `test/note-menu-geom.test.ts`.
        The two byte-identical inline mouseenter blocks (`b.setCssStyles({color})` +
        `b.setCssStyles({borderBottomColor})`, one in the Data sub-bar loop, one in
        `mkTab`) now apply one pure builder returning just the two hint props; the
        `!== active` guard + mouseleave→`styleDSubs`/`styleTabs` restore stay in the
        view. Behaviour-identical (one merged setCssStyles == two sequential ones). — 2ccf3f8
  - [x] pane display maps → `noteMenuTopTabDisplay(active)` /
        `noteMenuDataSubTabDisplay(active)` (`src/interaction/note-menu-geom.ts`) +
        cases in `test/note-menu-geom.test.ts`. The two inline `display: key === …`
        per-pane ternary blocks in `showTab` (data→flex / settings+insight→block) and
        `showDSubTab` (tree→flex / logic+table+json→block) now read from pure builders
        returning `{data,settings,insight}` / `{logic,tree,table,json}` display strings;
        the show/hide side effects (renderDataLogicBody/renderSettingsBody/renderInsightTab,
        table/json re-render) stay in the view. Test locks "exactly the active pane
        visible, flex-vs-block per pane kind". — 9db684e
  - [x] Tree-pane bulk Select/Deselect-all chrome → `noteMenuBulkBarStyle()`
        (`src/interaction/note-menu-geom.ts`) + a case in `test/note-menu-geom.test.ts`.
        Returns `{bar, btn}` static layout records (the 6px-gap flex row + the small
        muted secondary-bg button pill); the inline `bulkBar`/`mkBulkBtn` `setCssStyles`
        blocks in `ensureNoteMenu` are now thin applications. No state branch; the
        bulk handlers (`bulkSetHidden` + save/draw) stay in the view. — 1100dba
  - [x] Tree-pane group-by radio bar chrome → `noteMenuGroupBarStyle()`
        (`src/interaction/note-menu-geom.ts`) + a case in `test/note-menu-geom.test.ts`.
        Returns `{bar, label}` static layout records (the muted 10px-gap flex row + the
        inline-flex radio label); the inline `groupBar`/`mkGroupRadio` `setCssStyles`
        blocks in `ensureNoteMenu` are now thin applications. No state branch; the
        Folder/Tag radio + change handlers stay in the view. — 66a1fd0
  - [x] Tree-pane search-box chrome → `noteMenuSearchStyle()`
        (`src/interaction/note-menu-geom.ts`) + a case in `test/note-menu-geom.test.ts`.
        Returns `{wrap, input, suggBox, body}` static layout records (the relative
        wrapper, the full-width bordered input, the absolutely-positioned hidden
        autocomplete dropdown, the growing tree scroll body); the four inline
        `setCssStyles` blocks for searchWrap/search/suggBox/body in `ensureNoteMenu`
        are now thin applications. No state branch; query restore + suggestion/event
        wiring stay in the view. — 79eec8e
  - [x] suggestion-kind glyph/colour map → `suggestionKindStyle(kind)`
        (`src/interaction/note-menu-geom.ts`) + cases in `test/note-menu-geom.test.ts`.
        The two inline `Record<Suggestion["kind"], string>` literals (`kindGlyph` /
        `kindColor`) in `ensureNoteMenu`'s suggestion-dropdown machinery are now a
        single pure builder returning `{glyph, color}` per kind (tag #/accent,
        field ⊳/purple, note ·/muted); the `openSuggest` glyph-span render reads it.
        No state branch; suggestion query/event wiring stays in the view. — 0e19a40
  - [x] note-count hint → `noteMenuNotesHint(count, isDroste)`
        (`src/interaction/note-menu-geom.ts`) + a case in `test/note-menu-geom.test.ts`.
        The Result-pane hint inlined the verb branch (droste→focus / else→locate/open)
        + the faint 10px chrome; now a pure builder returning `{text, style}`, the view
        just creates the div and applies them. The now-single-use `verb` const + comment
        are gone. — 4c28f89
  - [x] suggestion-row chrome → `noteMenuSuggestStyle()`
        (`src/interaction/note-menu-geom.ts`) + a case in `test/note-menu-geom.test.ts`.
        The two inline `setCssStyles` blocks for the autocomplete dropdown row + its
        leading glyph span in `openSuggest` are now thin applications of a pure builder
        returning `{row, glyph}` static layout records; the per-kind glyph colour (from
        `suggestionKindStyle`) is applied on top by the view, and the hover/mousedown
        wiring stays inline. No state branch. — 7a5f831
  - [x] pinned left-edge resize-grip chrome → `noteMenuLeftGripStyle()`
        (`src/interaction/note-menu-geom.ts`) + a case in `test/note-menu-geom.test.ts`.
        The inline `setCssStyles` block for the pinned panel's `lgrip` (the thin
        transparent ew-resize strip down the left border) in `ensureNoteMenu` is now a
        thin application of a pure builder returning the static style record; the
        widen-on-drag-left + canvas re-reserve wiring stays in the view. No state branch. — 1b3207e
  - [x] Tree-pane row chrome → `noteMenuTreeRowStyle(kind, depth, baseBg?)` /
        `NoteMenuTreeRowKind` (`src/interaction/note-menu-geom.ts`) + a case in
        `test/note-menu-geom.test.ts`. The three near-duplicate row style blocks in
        `ensureNoteMenu` (leaf note row / collapsible folder row / "(all)" subtree
        header) now read `{row, label}` from one pure builder; `padding` precedes
        `paddingLeft` so the depth indent survives. The leaf highlight colour, hover
        background swaps, and checkbox/expand wiring stay in the view. — 7a1747e
  - [x] Data ▸ JSON tab chrome → `noteMenuJsonLabelStyle(margin)` /
        `noteMenuJsonTextareaStyle(height)` / `noteMenuJsonButtonRowStyle()`
        (`src/interaction/note-menu-geom.ts`) + cases in `test/note-menu-geom.test.ts`.
        The three repeated style blocks in `renderDataJsonBody` (export/import section
        labels, the read-only/paste textareas, the Copy/Save · Import/Bundled button
        rows) are now thin applications of pure builders; only the label margin and
        textarea height differ between the two occurrences of each, so those are params.
        The DOM creation + click/mousedown wiring stays in the view. — 30422cd
  - [x] Data ▸ JSON tab title + status chrome → `noteMenuJsonTitleStyle()` /
        `noteMenuJsonStatusStyle(hasErrors)` (`src/interaction/note-menu-geom.ts`) +
        cases in `test/note-menu-geom.test.ts`. The static section heading and the
        last-import/bundled-load status block in `renderDataJsonBody` (summary line
        flips warning↔muted on `errors.length`; per-error + "…and N more." lines
        static) are now thin applications of pure builders; the slice/loop + DOM
        creation stay in the view. The `hasErrors` branch is the only logic. — b3c8bd8
  - [x] settings sub-tab hover dedup → `renderSettingsBody`'s mouseenter handler still
        ran the two inline `setCssStyles` calls (muted color + faint borderBottomColor)
        byte-identical to the already-extracted, test-covered `noteMenuTabHoverStyle()`
        (used at `view.ts:3027`/`3083`); collapsed into the same single application. One
        merged `setCssStyles` == two sequential ones, behaviour-identical. Last
        duplicated tab-hover block gone. — 25e416c
  - [x] bottom-right resize-grip chrome → `noteMenuBottomRightGripStyle()`
        (`src/interaction/note-menu-geom.ts`) + a case in `test/note-menu-geom.test.ts`.
        The inline `setCssStyles` block for the SE-corner invisible 16×16 resize hit
        target in `ensureNoteMenu` is now a thin application of a pure builder returning
        the static style record (mirrors `noteMenuLeftGripStyle`); the resize-from-corner
        + rect-persist wiring stays in the view. No state branch. — 590fb21
  - [x] Data ▸ JSON Export bundle → `buildViewStateBundle(nodes, settings)` /
        `ViewStateBundle` (`src/interaction/preset-io.ts`, next to `serializePresets`)
        + cases in `test/preset-io.test.ts`. The inline node-stripping (volatile
        `ageDays`/`mtime`), schema/version wrapping, and `lensPresets`→`presets` split
        in `renderDataJsonBody` are now a pure builder; the view just JSON-serializes
        it. Behaviour-identical (same constants/fields, inputs untouched). — 5a8214a
  - [x] view-shell root/canvas chrome → `viewRootStyle()` / `viewCanvasStyle()`
        (`src/view-shell-style.ts`) + `test/view-shell-style.test.ts`. The 7 inline
        `setCssStyles` calls in `onOpen` (3 root: no-pad/clip/relative; 4 canvas:
        100%×100%/block/grab) are now thin applications of pure static builders.
        Not strictly `ensureNoteMenu`, but the same chrome-extraction pattern and a
        clean self-contained seam. No state branch. — 0474c5b
  - [x] Settings sub-tab bar chrome → `noteMenuTabBarStyle("settings")`
        (`src/interaction/note-menu-geom.ts`) + a case in `test/note-menu-geom.test.ts`.
        The inline `setCssStyles` block for `renderSettingsBody`'s `subBar` (wrapping
        flex + 1px gap + divider, spaced below via `marginBottom:6px` instead of the
        Data sub bar's padded-in edge) is now a thin application of a new `"settings"`
        kind on the existing tab-bar builder; the sub-button/event wiring stays in the
        view. No state branch. — 8f0c4b3
  - [x] search-box dropdown keyboard reducer → `suggestKeyAction(key, state)` /
        `SuggestKeyState` / `SuggestKeyAction` (`src/interaction/note-menu.ts`, next to
        `suggestQuery`/`currentToken`) + cases in `test/note-menu.test.ts`. The inline
        ArrowDown/ArrowUp/Enter/Escape branching in the search `keydown` handler is now
        a thin switch over a tagged action (open/move/accept/search/close, each carrying
        which default behaviours to suppress); all DOM/event side effects stay in the
        view. First `ensureNoteMenu` *behaviour* seam (vs the earlier CSS-chrome ones).
        Behaviour-identical (wrap-around, accept-vs-search on Enter, Escape close). — a24d8f2
  - [x] search-box suggestion token apply → `applySuggestionToken(value, text)`
        (`src/interaction/note-menu.ts`, next to `currentToken`) + cases in
        `test/note-menu.test.ts`. The inline token-replace string math in
        `acceptSuggestion` (replace the trailing token with the accepted text;
        trailing space unless the completion ends in `":"`) is now pure; the view
        just assigns the result to `search.value` and keeps the close/focus/redraw
        side effects inline. Second `ensureNoteMenu` behaviour seam (after
        `suggestKeyAction`). Behaviour-identical. — c233f0e
  - [x] navigator folder triangle-label → `folderToggleLabel(text, open)`
        (`src/interaction/note-menu.ts`, next to `buildFolderPathKey`) + cases in
        `test/note-menu.test.ts`. The disclosure-triangle prefix (▾ open / ▸ closed)
        was inlined 6× across the tree builder (regular folder rows + the "(all)"
        subtree header, each at initial render and on open/close) with an
        inconsistent literal-vs-`\u` escape glyph spelling; now one pure builder.
        Behaviour-identical (same glyphs, same single space). — f3d0494
  - [x] count-noun plural idiom dedup → `pluralize(count, singular)`
        (`src/util/pluralize.ts`, the first module under the new `src/util/`) +
        `test/pluralize.test.ts`. The trailing-`s` plural `${n} word${n === 1 ? "" :
        "s"}` was repeated 5× across the Data ▸ JSON tab labels in `renderDataJsonBody`
        (export header node+preset counts, import result, bundled-load result) and the
        mode-legend size suffix (`draw/mode-legend-input.ts`); all collapsed into one
        pure builder. Behaviour-identical (regular-`s`; multi-word "bundled preset"
        pluralizes on the tail). — d713f89
  - [x] tree leaf "current note" highlight → `noteMenuLeafHighlight(isCurrent)`
        (`src/interaction/note-menu-geom.ts`, next to `noteMenuTreeRowStyle`) + cases in
        `test/note-menu-geom.test.ts`. The leaf-row highlight was two scattered
        conditionals on the same `id === currentMenuHighlightId()` predicate: the `baseBg`
        magic hex `#2d6cdf55` (a hardcoded copy of `draw/theme.ts`'s `accent: "#2d6cdf"`
        at ~33% alpha — threaded into the row style + restored on mouseleave) and the
        `var(--color-yellow)` label colour. Now one pure builder returning `{rowBg,
        labelColor?}`; the view computes the predicate once and applies the records.
        Behaviour-identical (same hex/yellow/empty-bg default). — 2cde31e
  - [x] Data ▸ JSON status error-list formatter → `formatJsonStatusLines(errors,
        cap = JSON_STATUS_ERROR_CAP)` (`src/interaction/preset-io.ts`, next to
        `buildViewStateBundle`) + cases in `test/preset-io.test.ts`. The status block in
        `renderDataJsonBody` inlined the error presentation twice over the magic cap 20
        (`• ${e}` bullets on the first 20, then "…and N more." overflow); now one pure
        builder returning `{errorLines, moreText}`, the view loops the strings + applies
        the already-extracted status styles. Behaviour-identical (same glyph/cap/overflow
        text, input untouched). — 99fb8ea
  - [x] tag self-or-subtag predicate dedup → `isTagOrSubtag(candidate, tag)`
        (`src/insight/tag-path.ts`, next to `isValidTagName`) + cases in
        `test/tag-path.test.ts`. The `s === tag || s.startsWith(`${tag}/`)` nesting
        match was inlined 5× in `convertToNestedTag` (`src/insight/actions.ts`): the
        `#`-prefixed `cache.tags` hit-test (called with `#${tag}`) plus four bare-form
        spots (fmTags array/string hit-test, the array `.map` rewrite, the string
        rewrite). Now one pure predicate; `/`-delimited descendant only (bare prefix
        "foobar" vs "foo" is NOT a hit, locked by test). Behaviour-identical. Not a
        note-menu/F2 seam but a genuine duplicate discovered while seam-hunting. — cf70a6b
  - [x] minimize body/grip display map → `noteMenuMinimizeDisplay(minimized)`
        (`src/interaction/note-menu-geom.ts`, next to `noteMenuTopTabDisplay`/
        `noteMenuDataSubTabDisplay`) + a case in `test/note-menu-geom.test.ts`. The two
        body+grip `setCssStyles({display})` pairs in `applyMinimizedState`'s
        minimized/expanded branches (`bodyWrap` none↔flex, `grip` none↔default) are now
        one pure builder returning `{body, grip}` applied once before the height branch;
        the panel-height computation (`noteMenuHeight` + restore-rect bookkeeping) stays
        in the view. Behaviour-identical (same display strings per state). — 727c84b
  - [x] suggestion-row selection highlight → `noteMenuSuggestSelectionStyle(selected)`
        (`src/interaction/note-menu-geom.ts`, next to `noteMenuSuggestStyle`) + a case in
        `test/note-menu-geom.test.ts`. The inline `{ background: i === selIdx ?
        "var(--background-modifier-border)" : "" }` ternary in `renderSelection`'s
        per-row `forEach` (the keyboard/hover dropdown highlight) is now a thin
        application of a pure builder, centralizing the magic CSS var; the view keeps
        the `selIdx` state + the row loop. Behaviour-identical (selected → modifier-border
        bg, others → cleared). — 82bcb6a
  - [x] tri-state checkbox aria-checked mapping → `checkboxAriaChecked(state)`
        (`src/interaction/note-menu.ts`, next to `folderCheckState`, sharing its
        `FolderCheckState` type) + cases in `test/note-menu.test.ts`. The custom
        `gim-nav-cb` span's `setCbState` inlined the tri-state → aria-checked ternary
        (indeterminate → "mixed", checked → "true", unchecked → "false"); now a pure
        builder, and the local `CbState` alias reuses `FolderCheckState`. Centralizes
        the WAI-ARIA tri-state contract; behaviour-identical. — cad3aa0
  - [x] row-checkbox initial DOM descriptor → `noteMenuRowCheckboxSpec()` /
        `NoteMenuRowCheckboxSpec` (`src/interaction/note-menu.ts`, next to
        `checkboxAriaChecked`) + cases in `test/note-menu.test.ts`. The custom
        tri-state row checkbox `<span>` (`gim-nav-cb`, every leaf + folder row)
        seeded its `cls`/WAI-ARIA `attr`/initial `data-state` from an inline
        literal in `mkRowCheckbox`; now a pure `{cls, state, attr}` descriptor
        whose initial `aria-checked` derives from the same `state` through
        `checkboxAriaChecked` (aria seed can't drift from the data-state seed).
        The view applies it. Behaviour-identical (gim-nav-cb / role checkbox /
        aria-checked "false" / tabindex "0" / data-state "unchecked"). — 5e32495
  - [x] floating-panel rect → px mapping dedup → `noteMenuRectStyle(rect)`
        (`src/interaction/note-menu-geom.ts`, next to `noteMenuPanelStyle`) + a case in
        `test/note-menu-geom.test.ts`. The `{left,top,width,height}` px-string mapping was
        derived twice: `noteMenuPanelStyle`'s floating branch and `applyRect`'s four
        separate `setCssStyles` calls in `ensureNoteMenu` (view.ts). Now one pure builder
        both consume — the panel-init and every live drag/resize re-apply can't drift.
        The four-call `applyRect` collapses to one `setCssStyles(noteMenuRectStyle(r))`.
        Behaviour-identical; test locks the four props + that the floating panel reuses
        the same mapping. Mirrors the `clampPinnedWidth` chrome dedups. — 30d604f
  - [x] legend point-in-rect hit-test dedup → `pointInRect(px, py, {x,y,w,h})`
        (`src/util/point-in-rect.ts`, next to `clampZoom`/`pluralize`/`jaccard`) +
        `test/point-in-rect.test.ts`. The inclusive-bounds `px >= r.x && px <=
        r.x+r.w && py >= r.y && py <= r.y+r.h` test was re-derived inline 4× in
        `view.ts`'s on-canvas legend interactions (mousedown legend-drag start + its
        × guard, click-to-dismiss ×, wheel-scroll over the panel); all four are now
        thin calls. Behaviour-identical (edges/corners inclusive, locked by an
        inline-equivalence grid). The `{x0,y0,x1,y1}` droste-hit test at
        `view.ts:3649` keeps its own inline form (different rect shape). — 5ccef41
  - [x] Data ▸ JSON export label → `jsonExportLabel(nodeCount, presetCount)`
        (`src/interaction/preset-io.ts`, next to `formatJsonStatusLines`) + cases in
        `test/preset-io.test.ts`. The inline `Export View State (${pluralize(nodeCount,
        "node")}, ${pluralize(presetCount, "preset")})` template literal in
        `renderDataJsonBody` (view.ts) is now a thin call to a pure text builder;
        both counts stay pluralized (singular/plural/zero locked in the test).
        Behaviour-identical. Mirrors the `formatJsonStatusLines` extraction.
  - [ ] next seams to peel (pure builders, one per iteration): the numeric parse/clamp
        blocks in `settings-sections.ts` / `settings-tabs.ts` are now all extracted
        (min-font, heatmap-min-tag, node-size, jaccard) and the inherit-from option list
        is done. Remaining inline structure in these files is checkbox/radio/text rows
        whose only logic is a single settings-field toggle — extract only if a genuine
        duplicate descriptor list emerges (mirror `basesToggleRows`). Otherwise pivot to
        the `ensureNoteMenu` body-builder seams or F2.
  - [x] aggregation-group hit-test → `hitTestAggregationGroup(wx, wy, groups, cardW,
        cardH, zoom)` (`src/interaction/hit-test.ts`, next to `hitTest`) +
        `test/hit-test-aggregation.test.ts`. The first branch of `MiniGraphView.hitTest()`
        inlined the Junihitoe-stack AABB scan (each stack = one card footprint centred on
        the group position, widened by `slackPx = 1/zoom`, first containing group wins);
        now a pure function returning the `aggregationGroup` HoverTarget or null, the view
        keeps the card-size source (`nodes[0]`) + the size/non-empty guard. Test locks the
        inclusive bounds, slack-scales-with-1/zoom, first-match, and empty/miss cases. Not
        an `ensureNoteMenu` CSS seam but a clean pure hit-test seam discovered while
        seam-hunting. Behaviour-identical. view.ts 4328 → 4324; ratchet tightened. — 0e3e945
  - [x] legend scrollbar thumb geometry → `legendScrollbarGeom(panelH, maxScrollY,
        showClose)` (`src/interaction/legend-scrollbar.ts`) + `test/legend-scrollbar.test.ts`.
        The 6-line trackTop/trackH/thumbH/maxThumbY block was byte-identical between the
        legend scrollbar's mousedown (click-to-jump / thumb-drag start) and mousemove
        (drag) handlers in `attachInputs`; now one pure builder both destructure.
        Behaviour-identical (20/4 top gap, 4px bottom, 20px thumb floor, proportional
        thumbH). Not a note-menu seam but a clean self-contained interaction-geometry
        seam. view.ts 4324 → 4323; ratchet tightened. — b921ca8
        **Follow-up:** `draw/legend-layout.ts:257` paints the thumb with the same rule
        in its own render-space vars (`showClose`, `box.height`, `drawHeight`); a 3rd
        dedup would need `draw/` → `interaction/` import (layering question).
  - [x] hover-tooltip text builders → `heatmapCellTipText` / `ghostEdgeTipText` /
        `clusterTipText` / `aggregationGroupTipText` (`src/interaction/hover-tip-text.ts`,
        each returning `{title, sub}`) + `test/hover-tip-text.test.ts`. The four pure-data
        branches in `view.ts`'s `showHover` (heatmap cell diagonal-vs-Jaccard, ghost-edge
        shared-tag `#tag` truncation to 3 + `(+N)` overflow, cluster label/member-count,
        aggregation-group `prefix:value` tail) now read from pure builders; the `node`
        branch stays inline (needs a vault lookup). `jaccardFromCounts` moved into the
        heatmap builder, so its now-unused `view.ts` import was dropped. Not an
        `ensureNoteMenu` seam but a clean self-contained draw/hover seam. Behaviour-identical. — 0201e7e
  - [x] count-based Jaccard dedup → `jaccardFromCounts(sizeA, sizeB, intersection)`
        (`src/util/jaccard.ts`, next to `jaccardSimilarity`) + cases in
        `test/jaccard.test.ts`. The intersection-over-union-from-counts score
        (`uni = |A|+|B|-∩`; 0 on empty union) was re-derived inline in the heatmap
        cell colour intensity (`draw/draw-heatmap.ts`) and its hover tooltip
        (`view.ts`); both now call the pure helper. Behaviour-identical (view's
        `uni>0 ? … : "0.00"` folds into the helper's empty-union→0 then `.toFixed(2)`).
        A count-based sibling of the earlier set-based `jaccardSimilarity` dedup. — a132f57
  - [x] Jaccard set-similarity dedup → `jaccardSimilarity(a, b)`
        (`src/util/jaccard.ts`, next to `pluralize`) + `test/jaccard.test.ts`. The
        intersection-over-union score `inter / union` (0 on empty union) was
        re-derived inline in the related-notes scorer (`view.ts` — via two throwaway
        `new Set` allocations behind a size-guard) and the redundant-tag-pair finder
        (`insight/compute.ts` — behind an unreachable `union===0` guard, both sets
        already size ≥ 2). Both now call the pure helper, which folds the empty-union
        → 0 case in and iterates the smaller set. Behaviour-identical. — 94c101f
        **Follow-up:** `query/bridge-finder.ts` keeps its own loop because it also
        collects `sharedTags` while scanning; a `jaccardWithShared(a, b)` variant
        could dedup that third site if wanted.
  - [x] pinned left-grip resize clamp dedup → the inline
        `Math.min(Math.max(NOTE_MENU_MIN.width, raw), Math.max(NOTE_MENU_MIN.width,
        Math.floor((cw||320)*0.8)))` in the pinned `lgrip` `onMove` handler was
        byte-identical to the existing pure `clampPinnedWidth(raw, cw)` (the same
        floor-to-min / ceiling-to-80%-of-container rule the initial dock width uses);
        collapsed it into a thin `clampPinnedWidth(raw, cw)` call. Behaviour-identical
        (raw is always a number, so `?? 320` is inert); already test-covered at
        `test/note-menu-geom.test.ts:56`. — 152614b
  - [x] folder disclosure display/label pair → `folderDisclosure(text, open)`
        (`src/interaction/note-menu.ts`, next to `folderToggleLabel`, which it reuses)
        + cases in `test/note-menu.test.ts`. The four open/close handlers in the
        navigator tree builder (openAll/closeAll for the "(all)" header,
        openFolder/closeFolder for regular folders) inlined the same `{display, label}`
        pair (open → kids "block" + ▾-label, closed → "none" + ▸-label); now one pure
        builder returning `{display, label}`. Centralizes the block↔open / none↔closed
        mapping (mirrors `noteMenuTopTabDisplay`/`noteMenuMinimizeDisplay`); the view
        applies display to the kids-div + label to the span, event wiring stays inline.
        Initial-render label-only spots keep `folderToggleLabel`. Behaviour-identical. — fee6321
  - [x] folder-checkbox cascade decision → `folderCascadeHide(descKeys, hiddenSet)`
        (`src/interaction/note-menu.ts`, next to `folderCheckState`) + cases in
        `test/note-menu.test.ts`. The tri-state folder/group checkbox's inline
        `folderCheckState(...) === "checked"` hide-vs-show decision in `renderTree`
        (`ensureNoteMenu`) is now a named pure predicate (true = hide-all): a
        fully-checked group hides on toggle, an unchecked OR indeterminate group
        shows all. The existing cascade test now drives the predicate (evaluated ONCE
        before the toggle loop, mirroring the view — mid-loop state change must not
        flip it) instead of re-modelling the rule inline. Behaviour-identical.
  - [x] leaf-row hover background swap → `noteMenuLeafRowHoverStyle(hover, rowBg)`
        (`src/interaction/note-menu-geom.ts`, next to `noteMenuLeafHighlight`) + cases
        in `test/note-menu-geom.test.ts`. The two inline mouseenter/mouseleave
        `setCssStyles` blocks in `leafRow` (enter → modifier-border wash, leave →
        restore `hl.rowBg`) are now thin applications of a pure builder; centralizes
        the magic hover CSS var shared with `noteMenuSuggestSelectionStyle`.
        Behaviour-identical. — a35cca2
  - [x] tab-prefix id-strip dedup → the `${tag}\t${origPath}` Euler-copy id → path
        strip (`const sep = id.indexOf("\t"); sep >= 0 ? id.slice(sep+1) : id`) was
        re-derived inline 5× in `view.ts` (buildLatticeNamedLabels, drawLattice
        `nameOf`, drawCard, openFile, tooltip), each byte-identical to the existing
        pure `stripTabPrefix` (`src/interaction/note-menu.ts`, already imported + used
        at 3297). Collapsed all five into thin `stripTabPrefix(id)` calls.
        Behaviour-identical. Mirrors the `clampPinnedWidth`/`tag-path` dedups. — 810b7cd
        **Follow-up:** `src/draw/draw-droste.ts:532` keeps the same inline strip; a
        6th dedup would need `draw/` to import from `interaction/note-menu` (layering
        question) or a shared `stripTabPrefix` moved to a neutral `util/` module.
  - [x] 6th strip dedup + neutral relocation → moved the canonical `stripTabPrefix`
        to `src/util/tab-prefix.ts` (next to `pluralize`/`jaccard`), re-exported from
        `interaction/note-menu` so its many call sites + downstream importers keep the
        stable API, and pointed `draw/draw-droste.ts:532` at the util directly (no
        cross-layer `draw/`→`interaction/` import). New `test/tab-prefix.test.ts`
        locks the behaviour (first-tab split, plain-path passthrough).
        Behaviour-identical. — a85a37c
  - [x] panorama-fit content bounds → `contentBounds(clusters, nodes)`
        (`src/layout/content-bounds.ts`) + `test/content-bounds.test.ts`. The inline
        min/max accumulation over `laid.clusters` (top-left `x,y,width,height`) + a
        second pass over `laid.nodes` (centre-anchored `x ± width/2`) in `fitPanorama`
        is now a pure builder returning `{minX,minY,maxX,maxY}` or `null` (folds the
        `hasContent` guard + the `!Number.isFinite(minX)` bail into the null return).
        The view keeps the panel-width/padding fit math + pan/zoom assignment. Not a
        note-menu seam but a clean self-contained layout-geometry seam discovered while
        seam-hunting; behaviour-identical (stray NONE_BUCKET cards still folded in). — 8a07a6d
  - [x] fit-zoom clamp dedup → `clampZoom(value, min, max = 2)`
        (`src/util/clamp-zoom.ts`, next to `pluralize`/`jaccard`/`tab-prefix`) +
        `test/clamp-zoom.test.ts`. The two-sided fit clamp
        `Math.min(max, Math.max(min, x))` was re-derived inline 5× across the initial
        view-fit paths in `view.ts` (upset/lattice/heatmap/panorama/droste), in both
        min/max orderings; all collapsed into the pure helper. Behaviour-identical
        (`min <= max` at every site makes the clamp order-independent, so both old
        spellings fold in; droste passes an explicit `max` of 3). Mirrors the
        `clampPinnedWidth`/`pluralize` util dedups. — a17e1a9

- [ ] **F2 — first-class scatter mode.** 2D quantitative axes + zoom/pan as a proper
      view mode. Plan written: **`docs/0.3.21/f2-scatter-mode.md`**. Key finding —
      the axis machinery already exists as an *encoding overlay* (pure `axisLayout`
      + `applyAxisLayout` gated to euler/bubblesets/droste + `drawAxisGrid`/
      `draw-helpers` axis rendering + shared zoom/pan); F2 is **promotion, not
      invention**. Do one sub-step per iteration, each verify-green.
  - [x] short plan under `docs/0.3.21/f2-scatter-mode.md` (mode id `"scatter"`,
        panorama, reuse card layout + `axisLayout`; 8 implementation sub-steps).
  - [x] **F2.2 types + picker** — added `"scatter"` to the `ViewMode` union
        (`src/types.ts`) + a `VIEW_MODES` entry (`experimental: true`, panorama
        via default-absent `perspective`). No picker-test change needed:
        `test/view-mode-picker.test.ts` partitions `VIEW_MODES` generically (no
        hardcoded count). Type-safe — the two `mode` switches (`mode-legend`
        `buildModeLegendBody`, `legendAnchor`) both have `default` cases and the
        `Record<ViewMode>` uses are `Partial`, so no per-mode handling needed.
        Mode is selectable; renders fallback until F2.3 layout lands. — 657f257
  - [x] **F2.3 layout dispatch** — flat card layout for `viewMode === "scatter"`
        via new pure `layoutScatter` (`src/layout/scatter-layout.ts`) +
        `test/scatter-layout.test.ts`; wired into `layout()`'s dispatch
        (`src/layout/layout.ts`). One PositionedNode per displayed note (id = note
        id, NO per-tag duplication), no clusters / edges, full membership +
        encoding-attr propagation, deterministic overlap-free row-major grid as the
        pre-axis fallback. Edges left empty for now — F2.5 (draw) decides whether
        scatter renders relation lines between dots. — 72af79e
  - [x] **F2.4 axis placement on** — pure `scatterAxisDefaults(bindingX, bindingY)`
        (`src/encoding/scatter-axis-defaults.ts`) + `test/scatter-axis-defaults.test.ts`
        returns the effective X/Y bindings (user's enabled binding wins; else default
        quantitative `degree`/`ageDays` on a linear scale — axes always on in scatter).
        Wired into `applyAxisLayout` (`src/view.ts`): scatter defaults the bindings via
        the helper before the early no-axis guard, and `"scatter"` joins euler/bubblesets
        in `isCardMode` so the existing card axis-placement path (axisLayout + world-centre
        shiftSpec) fires. No behaviour change for the euler/bubblesets overlay. The
        `axisX`/`axisY` channel `appliesTo` (excludes scatter) is untouched — applyAxisLayout
        reads bindings directly, bypassing the channel registry; channel `appliesTo` is an
        F2.6/F2.7 concern. — 605f819
  - [x] **F2.5 draw** — scatter already routes through the card path: `draw()`
        falls past the lattice/droste/heatmap/upset guards (all undefined for
        scatter) into the world-map tiling → `drawBodyTile` (cards; empty
        clusters/edges = no enclosures/edges) + `drawCardGrid` (reads `laid.axes`
        for the axis grid). So F2.5 is **proof, not wiring**: new
        `test/scatter-render-smoke.test.ts` drives the actual `drawCardGrid` +
        `drawCard` over `layout(viewMode:"scatter")` + a pure `axisLayout` pass
        (mirroring `applyAxisLayout`'s degree/ageDays defaults + world-centre
        shift) with the recording-ctx mock. Asserts: one node per note / no
        clusters / no edges, **both axes populated with ticks** (the always-on
        reflection), and grid+card draw ops emitted without throwing. `window`
        is stubbed for `drawCardGrid`'s DPR read. — 11a5327
  - [x] **F2.6 settings** — Scatter X/Y attr + scale pickers (reuse encoding
        controls); default-mode merge guard in `main.ts` if needed. Closed by F2.6a
        (option lists) + F2.6b (picker DOM); 6b confirmed no `main.ts` merge guard is
        needed (bindings live in the existing `settings.encoding[]`, no new field).
    - [x] **F2.6a option lists** — pure `scatterAxisFieldOptions()` /
          `scatterAxisScaleOptions()` (`src/panel/scatter-axis-options.ts`) +
          `test/scatter-axis-options.test.ts`. The X/Y attribute dropdown options are
          exactly the quantitative field sources (new exported `listFieldSources()`
          in `field-sources.ts` is the single source of truth; categorical/temporal
          excluded) and the scale dropdown is the three quantitative scales
          (linear/log/quantile, a typed subset of `ScaleConfig["type"]`). Pure
          descriptor builders only — not yet wired into the panel; the picker DOM +
          binding save/rebuild wiring is the next F2.6 sub-step. Mirrors the
          `basesEdgeKinds`/`settingsSubTabs` descriptor extractions. — 7c51d9e
    - [x] **F2.6b picker DOM** — Scatter X/Y attr + scale `<select>`s rendered in the
          Encode tab (`renderScatterAxisSection`/`renderScatterAxisRow` in
          `settings-tabs.ts`), surfaced only when `viewMode === "scatter"`. New pure
          bridge `scatterAxisSelection` / `setScatterAxisBinding`
          (`src/panel/scatter-axis-binding.ts`) + `test/scatter-axis-binding.test.ts`:
          seeds the dropdowns from the user's enabled `axisX`/`axisY` binding (else the
          scatter default, scale narrowed to the quantitative subset) and upserts an
          enabled binding on change — preserving the unspecified dimension and other
          channels, never mutating input. Each select sends only its own changed
          dimension → save → rebuild. No new settings field, so no `main.ts` merge
          guard needed (bindings live in the existing `settings.encoding[]`). — 62a0b8a
  - [x] **F2.7 applicability + per-mode guards** — sync
        `display-applicability.ts` + `draw()` guard table for scatter. Closed by F2.7a
        (`displayToggleApplies("scatter", …)` drops the inert enclosure/edge toggles)
        + F2.7b (draw() kept data-driven no-op, locked by `assertNoEnclosureOrEdgeOps`
        in `test/scatter-render-smoke.test.ts`).
    - [x] **F2.7a applicability** — `displayToggleApplies("scatter", …)`
          (`src/visual/display-applicability.ts`) now returns false for
          `showEnclosures`/`showEdges` (layoutScatter emits no clusters/edges, so
          those overlays are inert), true for the rest; cases added to
          `test/display-applicability.test.ts`. The six existing modes stay all-true.
          The Display panel's "Graph display" filter + the Bridge-finder section
          gate (both call `displayToggleApplies`) now drop the inert toggles in
          scatter automatically. — b45df2b
    - [x] **F2.7b draw() guard table** — kept the data-driven no-op (no explicit
          `mode === "scatter"` guard added to the builders) and LOCKED it with a new
          render-smoke assertion (`assertNoEnclosureOrEdgeOps` in
          `test/scatter-render-smoke.test.ts`, run for both datasets). It drives the
          REAL gating builders (`computeEnclosureDrawInput`/`computeEdgeDrawPlan`) +
          the actual painters (euler/bubblesets enclosures, ghost/base/accent edges)
          with showEnclosures/showEdges/showGhostEdges all ON over a fresh recorder,
          asserts the gates are NON-suppressed (toggles really on), then asserts
          `!drewSomething(rec)` — so the zero-ops proof can only come from scatter's
          empty clusters/edges, not a suppressed gate. Adding a `mode === "scatter"`
          short-circuit was rejected as redundant: it would duplicate the empty-data
          contract the layout already guarantees (`layoutScatter` emits no
          clusters/edges) without changing any output. — db5a0ce
  - [ ] **F2.8 E2E** — CDP scenario: switch to scatter, bind X/Y, verify
        *reflection* (node count unchanged, `laid.axes.x/y` populated, distinct
        positions), not just "no exception".
    - [x] **F2.8a headless reflection (distinct positions).** CDP is unrunnable in
          this env (fresh-profile workspace init fails), so the in-app reflection
          the scenario would observe is now locked at the layout+axis level in
          `test/scatter-render-smoke.test.ts`: after `placeScatterAxes`, assert the
          dots occupy **>1 distinct X and >1 distinct Y** (both datasets vary degree
          and ageDays), proving the axes actually spread the figure rather than
          stacking it. Node-count-unchanged + axes-populated were already asserted. — d4854b1
    - [ ] **F2.8b CDP scenario (BLOCKED in this env).** The actual CDP-driven
          switch-to-scatter + bind-X/Y reflection check still needs a real Obsidian;
          run when the CDP harness is unblocked.
  > BLOCKER (F2.8b only): CDP/E2E harness blocked in the agent sandbox
  > (fresh-profile workspace init "No tab group found"); headless smoke is the gate.

## Done

(loop appends `- [x] <item> — <short-hash>` here)

- [x] **R5′ — settings type-rot guard test.** Already covered by
      `test/settings-parity.test.ts` (no-undefined defaults + JSON round-trip +
      inventory key-set lock on `DEFAULT_SETTINGS`). No new work needed.
- [x] **P4 — `view.ts` line-count ratchet.** `test/view-line-ratchet.test.ts`
      fails if `src/view.ts` exceeds baseline 4478 (ratchet only goes down). — 4045e0e
  - [x] **ratchet tighten 4478 → 4374.** Prior pure-module extractions (through
        `fee6321`) shrank `view.ts` to 4374 without lowering the ratchet, leaving
        104 lines of slack; tightened `BASELINE` to the current 4374 (the test's
        own documented companion action) to lock in the gains. No src change. — f358fa3
  - [x] **ratchet tighten 4374 → 4328.** Further pure-module seam extractions shrank
        `view.ts` to 4328 (46 lines of slack under the old baseline); tightened
        `BASELINE` to lock in the gains. Test-only change. — 451026f
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
