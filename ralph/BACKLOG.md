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
  - [x] UpSet horizontal pan clamp → `clampUpsetPanX(panX, contentW, canvasW, leftBandPx)`
        (`src/interaction/upset-pan.ts`, a sibling of `clampSpreadsheetPan`) +
        `test/upset-pan.test.ts`. The inline availableW/maxPanX/minPanX + fits-vs-clamp
        branch in `clampPan()`'s UpSet arm (`view.ts`) is now a thin call to a pure
        function; the user-spec 2026-05-26 edge rule (cards pinned to the right of the
        row-label band, never revealing empty canvas past their edges) is locked by the
        test (fits→pin, in-range passthrough, both edges, inline-equivalence grid).
        Not a note-menu seam but a clean self-contained interaction-geometry seam.
        Behaviour-identical. view.ts 4323 → 4316; ratchet tightened. — 847d43a
  - [x] applyAxisLayout world-centre shift → `shiftAxisSpec(spec, offset)`
        (`src/layout/axis-shift.ts`, next to `axisLayout`) + `test/axis-shift.test.ts`.
        The inline `shiftSpec` closure in `applyAxisLayout` (`view.ts`) — which
        re-anchors the `axisLayout` bands/ticks into world space by subtracting the
        figure-centre `cx`/`cy` from every positional field (band start/end/center,
        tick pos) so the axis stays aligned with the world-centred dots — is now a
        pure, non-mutating module. The `AxisSpec`/`AxisBand`/`AxisTick` type imports
        moved out of `view.ts` (now only in the pure module). Test locks
        undefined-passthrough, per-field categorical + quantitative offsets,
        label/min/max preservation, zero-offset identity-clone, and non-mutation.
        Sibling of the `contentBounds`/`*Fit` layout-geometry seams; behaviour-identical.
        view.ts 4273 → 4266; ratchet tightened. — 1078a6c
  - [x] canvas backing-store sizing → `canvasBackingSize(clientW, clientH, dpr)`
        (`src/draw/canvas-backing.ts`) + `test/canvas-backing.test.ts`. The inline
        `Math.max(1, Math.floor(w * dpr))` device-pixel buffer math in `resize()`
        (`view.ts`) is now a thin call to a pure builder returning `{width, height}`;
        the floor (integer pixel buffer) + min-1 guard (never a 0-dim canvas from a
        collapsed/detached element) are locked by the test (dpr 1/2, fractional-floor,
        zero→1×1, negative-dimension clamp with sibling unaffected). Sibling of the
        `*Fit` geometry seams; behaviour-identical. view.ts held at the 4256 ratchet.
  - [x] click-vs-drag slop predicate → `exceedsClickSlop(dx, dy, slop = CLICK_SLOP_PX)`
        (`src/util/click-slop.ts`, next to `point-in-rect`) + `test/click-slop.test.ts`.
        The inline `Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4`
        dead-zone test in the mousemove handler (`view.ts`) that flips `pointerMoved`
        (so a released pan is never mistaken for a click that opens a file) is now a
        thin call to a pure Manhattan-radius predicate, centralizing the magic 4px
        slop as `CLICK_SLOP_PX`. Test locks the strict-`>` boundary (sum == 4 → inside),
        sign-independence, custom-slop, and an inline-equivalence grid. Behaviour-identical.
        view.ts 4256 → 4255; ratchet tightened.
  - [x] Data ▸ JSON import/bundled status messages → `jsonImportMessage(count)` /
        `bundledLoadMessage(added)` (`src/interaction/preset-io.ts`, next to
        `jsonExportLabel`/`formatJsonStatusLines`) + cases in `test/preset-io.test.ts`.
        The two inline status-message templates in `renderDataJsonBody`'s Import and
        "Load bundled presets" handlers (`view.ts`) — the `count > 0 ? Imported N presets.
        : No valid presets found.` branch and the `Added N bundled presets.` line — are
        now thin calls to pure pluralized-text builders (mirrors the `jsonExportLabel`
        extraction). The now-only-use `pluralize` import dropped from `view.ts`.
        Behaviour-identical. view.ts 4227 → 4223; ratchet tightened. — 7ae91e0
  - [x] drosteFocus neighborhood sort+cutoff → `partitionNeighborhood(scored, maxSize)`
        (`src/query/related-score.ts`, next to `relatedNoteScore`) + cases in
        `test/related-score.test.ts`. The inline `scoredNodes.sort((a,b)=>b.score-a.score)`
        + `i < maxNeighborhoodSize` index loop in the droste focus scorer (`view.ts`) that
        marks the top-N by relevance visible and the rest `filtered` is now a thin call to
        a pure, non-mutating partition returning `{visible, filtered}`; the view just flips
        each node's `filtered` flag. Stable sort (ties keep input order), maxSize≤0 filters
        all / ≥length keeps all, input array not mutated — all locked by the test.
        Behaviour-identical. view.ts 4223 → 4217; ratchet tightened. — 825860b
  - [x] export-menu descriptor list → `exportMenuItems()` / `ExportMenuEntry`
        (`src/visual/image-export.ts`, next to `exportFileName`/`exportCanvasDims`) +
        cases in `test/image-export.test.ts`. The eight inline `menu.addItem`/
        `addSeparator` closures in `openExportMenu` (`view.ts`) — four PNG copy/save/
        whole + a separator + three SVG copy/save/whole — are now a pure, ordered
        descriptor list; the view loops it, mapping `separator` → `menu.addSeparator()`
        and `item` → `menu.addItem` wiring title/icon + an onClick that dispatches on
        `action.format` to `exportImage`/`exportSvg`. `ExportMenuAction` stays module-
        private (inferred at the call site) so knip is clean. Test locks order (4 PNG,
        separator at idx 4, 3 SVG), the first/last item's exact title/icon/action, and
        the single 4× entry. Behaviour-identical. view.ts 4217 → 4197; ratchet tightened. — 1930556
  - [x] drosteFocus scorer tag-set dedup → `cachedTagSet(tags)`
        (`src/query/related-score.ts`, next to `jaccardSimilarity`'s callers) + cases in
        `test/related-score.test.ts`. The scorer (`updateViewContextToElement`, `view.ts`)
        built the lowercased tag set from a file's metadataCache twice with the same
        inline `cache?.tags?.map(t => t.tag.toLowerCase()) || []` + `new Set(...)` (active
        note + each candidate); both collapse to a thin call, the now-unused
        `activeTags`/`nodeTags` locals drop. Undefined/absent tags → empty set (no throw),
        case-folded + deduped so the tag Jaccard compares canonically. Test locks
        undefined/empty→empty, case-fold+dedup, and distinct-lowercased. Behaviour-identical. — ad380b3
  - [x] `draw()` empty-figure gate → `figureIsEmpty(laid)`
        (`src/draw/figure-empty.ts`) + `test/figure-empty.test.ts`. The three inline
        `upsetHasColumns`/`heatmapHasCells`/`latticeHasNodes` consts + the compound
        "no nodes anywhere" condition in `draw()`'s "No nodes match current filters"
        hint gate (`view.ts`) are now a pure predicate: empty iff every mode's content
        slot is empty at once (world cards → `nodes`, UpSet → `upset.columns`, heatmap
        → `heatmap.n`, lattice → `lattice.nodes`). Test locks all-empty→true, each
        populated slot→false, and present-but-empty slots→still empty. Sibling of the
        `computeGlobalFallbackPlan`/`figure`-shaped draw seams; behaviour-identical.
        view.ts 4110 → 4103; ratchet tightened. — 137bc0d
  - [x] UpSet column signature-key dedup → `upsetColumnKey(signature)`
        (`src/layout/upset-layout.ts`, next to `layoutUpset`) +
        `test/upset-column-key.test.ts`. The `signature.join("|")` column-identity
        key was re-derived at three sites in three files — the layout bucketing pass
        (`upset-layout.ts`), the `draw-upset.ts` highlight match, and the view's
        `clearStaleSelection` stale-selection guard — that MUST produce byte-identical
        keys or a selected column can't be re-found (or dropped) after a relayout. Now
        one pure builder carrying the {ab,c}/{a,bc}-collision-avoiding "|" contract
        (documented once, at the function). Test locks the pipe join, empty/single,
        the collision-avoidance, and order-sensitivity (callers pre-sort). Mirrors the
        `undirectedPairKey`/`stripTabPrefix` idiom dedups; a correctness-relevant
        contract, not just a chrome seam. view.ts held at 4103 (the new import offset
        by tightening the now-`upsetColumnKey`-referencing field comment).
        Behaviour-identical. — 6529f89
  - [ ] next seams to peel (pure builders, one per iteration): the numeric parse/clamp
        blocks in `settings-sections.ts` / `settings-tabs.ts` are now all extracted
        (min-font, heatmap-min-tag, node-size, jaccard) and the inherit-from option list
        is done. Remaining inline structure in these files is checkbox/radio/text rows
        whose only logic is a single settings-field toggle — extract only if a genuine
        duplicate descriptor list emerges (mirror `basesToggleRows`). Otherwise pivot to
        the `ensureNoteMenu` body-builder seams or F2.
  - [x] lattice stale-key prune → `pruneLatticeKeys(nodeKeys, namedKeys, selectedKey)`
        (`src/layout/lattice-key-prune.ts`) + `test/lattice-key-prune.test.ts`. The
        inline named-checkbox-key delete loop + selected-key clear in
        `clearStaleSelection` (`view.ts`) — which prunes `latticeNamedKeys` and
        `latticeSelectedKey` against the surviving lattice-node keys after a relayout
        re-buckets the intersections (tier culled by Min size / signature top-N
        collapsed into "Other") so the named set never grows unboundedly and a stale
        selection can't linger — is now a pure, non-mutating builder returning
        `{namedKeys, selectedKey}`; the view reassigns both fields + keeps the
        `latticeHoverKey = null` reset. The empty-string selection is left untouched to
        mirror the view's original truthy `&&` short-circuit. Test locks named-key
        survival, selected keep/clear/null, empty-string passthrough, non-mutation, and
        empty-node total-clear. Behaviour-identical. view.ts 4103 → 4102; ratchet
        tightened.
  - [x] `(all)` subtree guard dedup → `allFolderLeaves(node, isTagTree)`
        (`src/interaction/note-menu.ts`) + cases in `test/note-menu.test.ts`. The
        tag-tree-only "(all)" collapsible subtree gate (`isTag && node.folders.size
        > 0` → `collectDescendantLeaves(node)` → non-empty check) was inlined
        identically at both `ensureNoteMenu` call sites (root list in `draw()` +
        each expanded folder in `openFolder()`); now one pure predicate returning
        the leaves to list (or `[]` when the row must not appear). `collectDescendant
        Leaves` becomes module-private (only caller is `allFolderLeaves`). Test locks
        folder-mode→empty, tag-root lists-all-distinct, sub-folder-node→descendants,
        leaf-only-node→empty. Behaviour-identical. — 8ce1a63
  - [x] Bases enabled-edge-kinds Set → `basesEnabledEdgeKinds(settings)`
        (`src/panel/bases-edge-kinds.ts`, next to `basesEdgeKinds`) + cases in
        `test/bases-edge-kinds.test.ts`. The inline three-`if` `Set<BaseEdgeKind>`
        build in `buildGraph` (`view.ts`) — one `.add(kind)` per enabled
        `basesLinkEdges`/`basesSharedTagEdges`/`basesSharedPropEdges` boolean —
        now derives from the existing `basesEdgeKinds()` descriptor list (each
        entry gained an `edge: BaseEdgeKind` field), so the key↔projection-kind
        mapping has one source of truth shared by the UI checklist and the graph
        build. The now-unused `type BaseEdgeKind` import dropped from `view.ts`.
        Test locks all-off→∅, all-on→3, per-key gating, and the descriptor
        edge-order. Behaviour-identical. view.ts 4125 → 4123; ratchet tightened.
  - [x] export size-cap notice → `exportScaleCapMessage(requestedScale, effectiveScale)`
        (`src/visual/image-export.ts`, next to `exportCanvasDims`) + cases in
        `test/image-export.test.ts`. The `exportImage` handler (`view.ts`) inlined the
        `dims.scale < opts.scale - 1e-6` cap detection + the `.toFixed(1)` "limited to
        N×" Notice text; now a pure builder returning the message string when the
        effective scale fell below the requested one (beyond the epsilon) else null.
        Centralizes the epsilon + format; the view just shows whatever it gets back.
        Mirrors the `jsonImportMessage`/`bundledLoadMessage` text builders. Test locks
        equal-scale→null, within-epsilon→null, real-cap→formatted, one-decimal rounding.
        Behaviour-identical. view.ts 4185 → 4182; ratchet tightened. — 0371e47
  - [x] undirected pair-key idiom dedup → `undirectedPairKey(a, b)`
        (`src/util/pair-key.ts`, next to `pluralize`/`jaccard`/`tab-prefix`) +
        `test/pair-key.test.ts`. The dictionary-ordered `a < b ? `${a}|${b}` :
        `${b}|${a}`` key that makes an unordered id pair collapse to one string was
        re-derived inline twice: the ghost-edge `linkedPairs` builder in `buildGraph`
        (`view.ts`, over each edge's source/target) and the bridge-finder seen-pair
        guard (`query/bridge-finder.ts:75`, over nodeA.id/idB); both now call the pure
        helper. The bridge-finder OUTPUT ordering (a/b lexical min/max at 93–94) keeps
        its own inline form (picks the tuple, not the joined key). Test locks argument-
        order independence, self-pair, and lexical (not numeric) ordering.
        Behaviour-identical. view.ts 4182 → 4181; ratchet tightened.
  - [x] visible fit-area width dedup → `visibleFitWidth(clientWidth, panelWidth)`
        (`src/layout/visible-fit-width.ts`, sibling of the `*Fit` builders that
        consume it) + `test/visible-fit-width.test.ts`. The `Math.max(1,
        this.canvas.clientWidth - panelW)` fit-area width (canvas client width minus
        the docked note-menu panel, floored at 1 so the `*Fit` builders never divide
        by ≤0) was re-derived inline in both `fitToView` mode branches (lattice at
        1880–1881 + default card at 1910–1911), each preceded by a throwaway `panelW =
        this.pinnedMenuWidth()` const; both collapse to one thin call that inlines the
        `pinnedMenuWidth()` read. Test locks the subtract, panel-0 passthrough, and the
        floor-to-1 when the panel meets/exceeds the width. Behaviour-identical.
        view.ts 4181 → 4180; ratchet tightened.
  - [x] Euler edge-routing loop dedup → `routeEdges(edges, idToRect, lanes, slotW,
        slotH, channelW, channelH, obstacles)` (`src/layout/layout-shared.ts`, next to
        `buildIdToRect`/`buildRouteObstacles`) + `test/route-edges.test.ts`. The two
        byte-identical `for (const e of …edges)` loops in `applyEulerLayout` (`view.ts`)
        — the real-edges pass and the ghostEdges pass, each a `routeZ(...)` call with the
        `<2-point → straight [a,b]` fallback writing `e.path` — are now one thin in-place
        batch router (minimal `RoutableEdge = {source,target,path}` so `layout-shared`
        stays free of a `layout` value import); the view keeps `new LaneRegistry()` and
        threads the SAME `lanes` across both calls so parallel wires still fan apart
        across real+ghost. `routeZ` import dropped from `view.ts`. Test locks valid→
        multi-point, missing-endpoint→path-untouched, coincident→2-point [a,b] fallback,
        in-place mutation, and shared-lanes-across-batches. Behaviour-identical.
        view.ts 4180 → 4145; ratchet tightened. — c9be296
  - [x] navigator error-banner box → `noteMenuErrorBannerBox(measuredTextWidth,
        clientWidth)` / `NoteMenuErrorBanner` (`src/interaction/note-menu.ts`, next to
        `noteMenuErrorText`) + cases in `test/note-menu.test.ts`. The inline padX/padY
        + `Math.min(measuredW, max(0, cw-16))` text clamp + `fillRect(8,8,tw+16,22)` /
        `fillText(…, max(0, cw-24))` geometry for the non-fatal navigator error banner
        in `draw()` (`view.ts`) is now a pure builder returning `{x,y,w,h,textX,textY,
        maxTextWidth}`; the view keeps `ctx.measureText`/`fillRect`/`fillText`. The box
        hugs the text yet never exceeds the canvas (text clamped to cw−16), text render
        clamped tighter (cw−24), both floored ≥0 — all locked by the test. Sibling of the
        `canvasBackingSize`/`*Fit` geometry seams; behaviour-identical. view.ts 4192 → 4191. — 2e0832d
  - [x] Tree grouping-selector radios → `noteMenuGroupOptions()` / `NoteMenuGroupBy`
        (`src/interaction/note-menu-geom.ts`) + a case in `test/note-menu-geom.test.ts`.
        The inline `mkGroupRadio("folder","Folder")`/`("tag","Tag")` pair in
        `ensureNoteMenu` (`view.ts`) is now a thin loop over a pure descriptor list, and
        the exported `NoteMenuGroupBy` type is the single source of truth for both the
        `noteMenuGroupBy` field and the rendered radio values (mirrors
        `noteMenuTopTabs`/`noteMenuDataSubTabs`). The label/radio DOM + change wiring stay
        in the view. Test locks value/label/order (Folder default first). — 033da69
  - [x] minimize collapse-to-header height → `noteMenuHeaderOnlyHeight(headHeight,
        panelBorder)` (`src/interaction/note-menu.ts`, next to `noteMenuHeight`) +
        cases in `test/note-menu.test.ts`. The inline `headerOnlyHeight` closure in
        `ensureNoteMenu` (`view.ts`) — header bar + the panel's measured top+bottom
        border, with the 0-measurement→2px fallback and the floor-to-1 guard so a
        detached/unstyled panel never collapses to a header-clipping or 0-height box
        — is now pure; the view keeps the two DOM reads (`head.offsetHeight`,
        `panel.offsetHeight - panel.clientHeight`). Test locks measured-border,
        zero/negative→2px fallback, and the floor. Sibling of `noteMenuHeight`.
        Behaviour-identical. view.ts 4195 → 4192; ratchet held. — 4155b0b
  - [x] set-layer resolver deps → `setLayerDeps(base, setKey, clusterKeys, full)`
        (`src/visual/node-display.ts`, next to `resolveFromCluster`) +
        `test/set-layer-deps.test.ts`. The inline supersets-clone + `full`-gated
        own-override drop in `resolveSetLayer` (`view.ts`) — which builds the modified
        `NodeDisplayDeps` a synthetic ∩/∪ set-layer resolves against (real single-tag
        clusters attached as its supersets; the layer's OWN override dropped only when
        it opts into FULL inheritance) — is now a pure, non-mutating builder; the view
        just gathers `clusterKeys`/`full` and threads it into `resolveFromCluster`. Test
        locks superset attachment (+ pre-existing preserved), full-drop cascade to
        superset/global, non-full own-override retention, and input non-mutation.
        Behaviour-identical. view.ts 4196 → 4195; ratchet held. — 9d0815e
  - [x] layout signature → `layoutSignature(s)` / `DISPLAY_ONLY_KEYS`
        (`src/layout/layout-signature.ts`) + `test/layout-signature.test.ts`. The
        private static `DISPLAY_ONLY_KEYS` set + private `layoutSignature` method in
        `view.ts` (sort keys → drop display-only → JSON.stringify, so a display-only
        toggle produces the SAME signature and `updateSettings` skips the relayout) are
        now a pure module; all three `this.layoutSignature(...)` call sites became thin
        `layoutSignature(...)` calls, removing the method + static wholesale. Test locks
        key-order stability, display-only-toggle invariance, a layout-key change flipping
        the signature, each display-only key being a real settings field + excluded from
        the JSON, and non-mutation. Behaviour-identical. view.ts 4255 → 4230; ratchet
        tightened.
  - [x] Graph-display checklist descriptors → `graphDisplayToggles()` /
        `GraphDisplayToggle` (`src/panel/graph-display-toggles.ts`) +
        `test/graph-display-toggles.test.ts`. The inline `gdToggles` literal in
        `renderSettingsDisplayTab` (`settings-tabs.ts`) pairing showNodes/showEnclosures/
        showEdges/showGrid with their labels is now a thin call to a pure builder; the
        per-mode `displayToggleApplies` filter stays at the call site. Test locks
        key/label/order against `DEFAULT_SETTINGS` (each key a real boolean field). A
        genuine duplicate descriptor list per the guidance above; mirrors the
        `basesEdgeKinds`/`basesToggleRows` extractions. Behaviour-identical. — 79190e6
  - [x] global display-fallback gating → `computeGlobalFallbackPlan(deps)`
        (`src/draw/global-fallback-plan.ts`) + `test/global-fallback-plan.test.ts`.
        The 7 inline per-mode `if` conditions in `drawGlobalDisplayFallbacks` (grid /
        enclosure frame / decorative edges / node-count badge / maturity+size+jaccard
        meta badges) — all gated on the same `isEuler = euler|bubblesets` +
        `mode !== droste|upset` rules — now read from a pure `{drawGrid, drawEnclosures,
        drawEdges, drawNodesBadge, drawMaturityBadge, drawSizeBadge, drawJaccardBadge}`
        plan; the view keeps the ctx drawing + the vertical badge stacking. Deps read
        straight off settings via `{ ...this.settings, mode }` (mode last so it wins).
        Same pattern as `computeEdgeDrawPlan`. Behaviour-identical; ratchet held (4289). — 1126db4
  - [x] meta indicator badges → `metaBadges(plan, nodeRows, nodeCols)` /
        `MetaBadge`/`MetaBadgeGates` (`src/draw/meta-badges.ts`) +
        `test/meta-badges.test.ts`. The three inline Maturity/Size/Jaccard
        `drawBadge(...)` `if` blocks in `drawGlobalDisplayFallbacks` now read their
        label/colour/stacking-order from a pure builder (takes the existing
        `GlobalFallbackPlan` structurally for its three `draw*Badge` gates); the view
        keeps the `drawBadge` ctx fillRect/fillText loop. Test locks label/colour/order
        + Size `RxC` interpolation + the gate-skip hole-close. Companion to
        `computeGlobalFallbackPlan` (which decides *whether* each badge fires; this
        decides *what* it says). Behaviour-identical. view.ts 4266 → 4261; ratchet
        tightened. — 53674e8
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
  - [x] legend scrollbar thumb↔scroll conversions → `scrollToThumbY` / `thumbYToScroll`
        (`src/interaction/legend-scrollbar.ts`, next to `legendScrollbarGeom`) + cases in
        `test/legend-scrollbar.test.ts`. The proportional thumb-travel ↔ scroll-offset
        map was re-derived inline 3× in `view.ts`'s legend scrollbar handlers: scroll→
        thumbY once (mousedown, to locate the current thumb for thumb-drag-vs-track-jump)
        and thumbY→scroll twice, byte-identical (mousedown track-jump + mousemove drag).
        All three now call the pure inverse pair; test locks the inverse pairing, the
        `maxThumbY === 0` no-travel guard (never divides by 0), and a scroll round-trip.
        Behaviour-identical (same `maxThumbY > 0 ? … : 0` divide guard). view.ts held at
        the 4256 ratchet (each 1-line inline expr → 1-line call). — e778373
  - [x] legend scrollbar mousedown zone classifier → `legendScrollbarZone(sx, sy,
        panel, thumbTop, thumbH, gutterPx = LEGEND_SCROLLBAR_GUTTER_PX)` /
        `LegendScrollbarZone` (`src/interaction/legend-scrollbar.ts`, next to the geom
        + thumb↔scroll maps) + cases in `test/legend-scrollbar.test.ts`. The two magic-
        number decisions in the legend mousedown handler (`attachInputs`) — the
        right-edge gutter test `sx >= pr.x + pr.w - 12` and the inclusive thumb-band
        test `sy ∈ [curThumbY, curThumbY+thumbH]` — are now one pure classifier
        returning `"thumb"`/`"track"`/`null` (null → panel drag). The `12`px gutter is
        centralized as `LEGEND_SCROLLBAR_GUTTER_PX` (wider than the 4px painted thumb).
        The handler restructures to compute geom whenever scrollable, then branch on the
        zone; behaviour-identical (left-of-gutter or not-scrollable → panel drag, thumb →
        relative drag, track → jump-then-drag). Single-site behaviour seam, mirrors
        `hitTestAggregationGroup`/`suggestKeyAction`. view.ts 4229 → 4227; ratchet
        tightened. — dcb38f4
  - [x] WheelEvent input math → `normalizeWheelDelta(deltaY, deltaMode)` /
        `wheelZoomFactor(deltaY, sensitivity)` (`src/interaction/wheel.ts`) +
        `test/wheel.test.ts`. The two inline pure computations in `view.ts`'s `wheel`
        handler are now thin calls: the legend-scroll deltaMode normalization ternary
        (`deltaMode===1 ? *20 : deltaMode===2 ? *300 : deltaY`, centralized as
        `WHEEL_LINE_PX`/`WHEEL_PAGE_PX`) and the zoom-on-wheel `Math.exp(-deltaY*0.0015)`
        (centralized as `WHEEL_ZOOM_SENSITIVITY`, param for testability). Test locks the
        three deltaMode branches + unknown-mode passthrough + inline-equivalence grid, and
        the zoom factor's identity/reciprocal-symmetry/inline-Math.exp/custom-sensitivity.
        The single-use `factor` local was inlined into the `zoomAroundPointer` call to
        offset the new import line. Behaviour-identical. view.ts held at the 4227 ratchet.
  - [x] hover-tooltip text builders → `heatmapCellTipText` / `ghostEdgeTipText` /
        `clusterTipText` / `aggregationGroupTipText` (`src/interaction/hover-tip-text.ts`,
        each returning `{title, sub}`) + `test/hover-tip-text.test.ts`. The four pure-data
        branches in `view.ts`'s `showHover` (heatmap cell diagonal-vs-Jaccard, ghost-edge
        shared-tag `#tag` truncation to 3 + `(+N)` overflow, cluster label/member-count,
        aggregation-group `prefix:value` tail) now read from pure builders; the `node`
        branch stays inline (needs a vault lookup). `jaccardFromCounts` moved into the
        heatmap builder, so its now-unused `view.ts` import was dropped. Not an
        `ensureNoteMenu` seam but a clean self-contained draw/hover seam. Behaviour-identical. — 0201e7e
  - [x] Droste (Icon Gallery) cell hit-test → `hitDrosteRect(dx, dy, rects)`
        + `DrosteHitRect` type (`src/interaction/hit-test.ts`, next to `hitTest` /
        `hitTestAggregationGroup`) + `test/hit-droste-rect.test.ts`. The reverse-scan
        AABB loop inside `MiniGraphView.drosteHitTest()` (topmost/last-painted rect wins,
        all four edges inclusive) is now a pure function; the view keeps the dpr scaling
        (`sx*dpr, sy*dpr`) + the `drosteGallery` guard. `this.drosteHit` is retyped to
        `DrosteHitRect[]`. Test locks empty→null, inside/outside, four-corner inclusivity,
        overlap-topmost-wins, and disjoint/gap cases. Not an `ensureNoteMenu` CSS seam but
        a clean self-contained interaction hit-test seam. Behaviour-identical.
        view.ts 4276 → 4273; ratchet tightened.
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
  - [x] count-with-shared Jaccard dedup → `jaccardWithShared(a, b)`
        (`src/util/jaccard.ts`, next to `jaccardSimilarity`) returning `{jaccard,
        shared}` + cases in `test/jaccard.test.ts`. Closes the follow-up above: the
        bridge-finder (`query/bridge-finder.ts`) re-derived intersection-over-union
        inline behind its own scan because it also collects `sharedTags`. The variant
        iterates the first arg so `shared` keeps `a`'s order (no smaller-set shortcut);
        the inline loop + `unionSize === 0` skip collapse into a thin call plus an
        explicit `setA.size === 0 && setB.size === 0` empty-union guard (exactly
        equivalent). Test locks score-parity, a's-order shared, arg-order flip,
        empty-union, and disjoint. Behaviour-identical. — 7ea099c
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
  - [x] 7th strip dedup → the node-contextmenu ("Set maturity") handler in
        `attachInputs` still re-derived the same `indexOf("\t")` + slice inline
        (`sepIdx`/`baseId`), missed by the a85a37c sweep; collapsed into a thin
        `stripTabPrefix(hit.nodeId)` call. Behaviour-identical. view.ts 4230 →
        4229; ratchet tightened. — c325f23
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
  - [x] lattice initial-fit geometry → `latticeFit(worldWidth, worldHeight, visW,
        visH, gutter)` (`src/layout/lattice-fit.ts`) + `test/lattice-fit.test.ts`.
        The inline vertical-first fit (`zoomY`/`zoomX` + readability-floor
        `clampZoom`) plus the per-axis centre-if-fits-else-pin pan math (X pinned
        past the tier gutter, Y pinned to the top pad) in the view's initial-fit
        `laid.lattice` branch is now a pure builder returning `{zoom,panX,panY}`;
        the view keeps the panel-width/visW/visH derivation + the zoom/pan
        assignment. Sibling of `contentBounds`/`heatmapGeom`. Behaviour-identical
        (zoom still capped at clampZoom's default max 2; degenerate zero-world
        stays finite via the `Math.max(1, …)` guards). view.ts 4316 → 4302;
        ratchet tightened. — 1f804d0
  - [x] UpSet initial-fit geometry → `upsetFit(cardSlotH, cardsWorldHeight,
        cardsWorldWidth, footerH, canvasW, canvasH, leftBandPx)`
        (`src/layout/upset-fit.ts`) + `test/upset-fit.test.ts`. The inline
        ~8–20-row vertical fit + past-the-row-label-band horizontal fit
        (`min(zoomFromRows, zoomFromW)` with clampZoom floor 0.05 / ceiling 2)
        plus the bottom-anchored `panY = cardsBandH - cardsWorldHeight*zoom` and
        `panX = 0` in the view's `fitToView` `laid.upset` branch is now a pure
        builder returning `{zoom,panX,panY}`; the view keeps the screen-space
        `upsetFooterHeight` derivation + the zoom/pan assignment. Sibling of
        `latticeFit`. Behaviour-identical (row clamp 8..20, tall stacks pan above
        the canvas via negative panY). view.ts 4302 → 4292; ratchet tightened. — f312197
  - [x] heatmap initial-fit geometry → `heatmapFit(h, canvasW, canvasH)`
        (`src/layout/heatmap-fit.ts`) + `test/heatmap-fit.test.ts`. The inline
        `heatmapGeom`-derived availW/availH fit + `clampZoom(…, 0.05)` floor and the
        band-pinned pans (`panX = labelBand`, `panY = headerH`) in the view's
        initial-fit `laid.heatmap` branch are now a pure builder returning
        `{zoom,panX,panY}`; the view keeps only the zoom/pan assignment. Sibling of
        `latticeFit`/`upsetFit`. Behaviour-identical: labelBand/headerH are
        zoom-independent, so the original three `heatmapGeom` reads (one at zoom 1
        for the fit, two at the fitted zoom for the pins) collapse into one, and the
        clampZoom ceiling (2) / floor (0.05) both round-trip in the test. `heatmapGeom`
        stays imported for `clampPan`. view.ts 4292 → 4289; ratchet tightened. — 945ee2f
  - [x] default card-figure initial-fit → `contentFit(bounds, visW, visH)`
        (`src/layout/content-fit.ts`) + `test/content-fit.test.ts`. The last inline
        `*Fit` in `fitToView` — the euler/bubblesets/scatter/panorama branch's padded
        fit (side 20 / top 36 / bottom 20), `clampZoom(…, 0.005)` floor, and
        world-centre pan — is now a pure builder returning `{zoom,panX,panY}`; the view
        keeps the visW/visH derivation (panel-width subtraction) + the zoom/pan
        assignment. Sibling of `latticeFit`/`upsetFit`/`heatmapFit`, so every `fitToView`
        mode branch now reads from a pure fit builder. Behaviour-identical: off-origin
        boxes, floor/ceiling (0.005/2) clamps, and the degenerate zero-box `Math.max(1,…)`
        guard all locked in the test. view.ts 4289 → 4277; ratchet tightened. — 47b86af
  - [x] Icon Gallery centre-on-cell fit → `drosteFit(cell, cw, ch, cellSize)`
        (`src/layout/droste-fit.ts`) + `test/droste-fit.test.ts`. `centerDrosteOn`'s
        inline readable-icon zoom (~55% of the smaller canvas dim per cell, clamped
        [0.05,3]) + the pan landing the focus cell's world centre at the canvas centre
        is now a pure builder returning `{zoom,panX,panY}` (a single-cell sibling of the
        whole-figure `latticeFit`/`upsetFit`/`heatmapFit`/`contentFit`); the view keeps
        the zoom/pan assignment + requestDraw. `clampZoom` moved into the module (its last
        view.ts use), so that import was dropped. Behaviour-identical: inline-equivalence
        grid, zoom floor/ceiling, zero-dim `|| 1` guard, and cell-centre→canvas-centre all
        locked in the test. view.ts 4277 → 4276; ratchet tightened. — 3bafddf
  - [x] legend scrollbar `[0, max]` clamp dedup → `clampScroll(value, max)`
        (`src/util/clamp-scroll.ts`, next to `clampZoom`) + `test/clamp-scroll.test.ts`.
        The `Math.max(0, Math.min(max, value))` offset clamp was re-derived inline 3× in
        the on-canvas legend scrollbar machinery (`view.ts`): the track click-to-jump
        thumb-Y (`[0, maxThumbY]`) plus the thumb-drag and wheel-scroll positions (both
        `[0, maxScrollY]`); all now thin calls. Distinct from `clampZoom` (two-sided
        readable-zoom clamp with a default max) — this always floors at 0 and takes the
        ceiling explicitly. Behaviour-identical (inline-equivalence grid + degenerate
        max-0 locked in the test). The import cost was offset by inlining the now-clamped
        thumb-Y expression, so the ratchet holds (4266). Mirrors the `clampZoom`/
        `pointInRect` util dedups.
  - [x] pre-axis fallback world span → `axisFallbackSpan(nodeCount, slotW, slotH)`
        (`src/layout/axis-fallback-span.ts`) + `test/axis-fallback-span.test.ts`. The
        inline `nSpan = max(20, ceil(sqrt(n))*4)` + force-even + `nSpan * slotW/slotH`
        block in `applyAxisLayout` (`view.ts`) — the default figure box `axisLayout`
        falls back to (sized off node count, forced EVEN so the world-centre
        `cx=width/2`/`cy=height/2` fed to `shiftAxisSpec` land on integer cell
        boundaries) — is now a pure builder returning `{nSpan,width,height}`; the view
        keeps the `axisLayout` call + centre-shift. Sibling of `axis-shift`. Test locks
        the 20-floor, sqrt growth, always-even nSpan over a count sweep, and independent
        slot scaling. Behaviour-identical. view.ts 4261 → 4260; ratchet tightened. — 1a93487
  - [x] navigator error-banner text → `noteMenuErrorText(err, max = NOTE_MENU_ERROR_MAX)`
        (`src/interaction/note-menu.ts`, next to `suggestKeyAction`) + cases in
        `test/note-menu.test.ts`. The `draw()` on-canvas banner for a non-fatal
        navigator failure (visible on mobile where the console isn't reachable)
        inlined the `⚠ Note menu disabled: ${err}` prefix + the `msg.length > 140 ?
        slice(0,139)+"…" : msg` char-cap; now one pure builder (cap parameterised),
        the view just measures/fills the returned string. Test locks the prefix,
        the exact-cap-kept-whole vs over-cap-clamped-with-ellipsis boundary, and a
        custom max. Behaviour-identical. view.ts 4260 → 4259; ratchet tightened. — 7cf2e84
  - [x] locate-on-canvas pan-to → `locateNodeFit(node, cw, ch, currentZoom, minZoom = 0.6)`
        (`src/layout/locate-fit.ts`) + `test/locate-fit.test.ts`. The inline zoom-floor
        (`Math.max(this.zoom, 0.6)` — zoom IN to a readable card, never zoom out) +
        world-centre pan (`panX = cw/2 - node.x*zoom`, same for Y) in the view's
        `locateNodeOnCanvas` (the navigator/menu "locate" click path) is now a pure
        builder returning `{zoom,panX,panY}`; the view keeps the `cw/ch || 1` guard +
        the `locatedNoteId`/highlight machinery. A *pan-to* sibling of the *frame*-style
        `drosteFit`/`contentFit` fit family. Test locks the floor snap-up, above-floor
        no-zoom-out, custom min, and node-centre→canvas-centre. Behaviour-identical
        (import offsets the shrink; ratchet holds 4259). — ce963f3
  - [x] related-notes link predicate + score → `hasBidirectionalLink(resolvedLinks,
        a, b)` / `relatedNoteScore(hasLink, jaccard, wLink, wTag)`
        (`src/query/related-score.ts`) + `test/related-score.test.ts`. The drosteFocus
        neighborhood scorer (`updateViewContextToElement`) inlined the asymmetric
        resolved-link guard (`resolvedLinks[a]?.[b]` OR `resolvedLinks[b] &&
        resolvedLinks[b][a]` — a real correctness edge, missing-source keys must not
        throw) collapsed via `||` into a 0/1 flag, plus the `W_link*hasLink +
        W_tag*jaccard` weighted formula; both now pure. The vault/tag reads +
        top-N sort/filter stay in the view. Test locks forward/backward/both/none,
        empty-map + zero-count → false, and the four score corners. Not a note-menu
        seam but a clean graph-relevance seam (sibling of the `jaccard*` dedups).
        Behaviour-identical. view.ts 4259 → 4258; ratchet tightened. — 1cf6723
  - [x] note-menu drag-delta rect math → `moveMenuRect(start, dx, dy)` /
        `resizeMenuRect(start, dx, dy)` (`src/interaction/note-menu-geom.ts`, next to
        `noteMenuRectStyle`) + cases in `test/note-menu-geom.test.ts`. The two `onMove`
        handlers in `wireNoteMenuDrag` (`view.ts`) inlined near-duplicate rect-from-delta
        math: header MOVE translates left/top keeping the size, SE-corner RESIZE keeps the
        position growing width/height. Both now read from pure builders; `start` is already
        the immutable mousedown snapshot rect (applyRect assigns a NEW `noteMenuRect`, never
        mutating it), so the throwaway `baseLeft`/`baseTop` and `baseW`/`baseH` consts drop
        out. Test locks the two transforms + zero-delta identity + non-mutation.
        Behaviour-identical. view.ts 4258 → 4256; ratchet tightened. — 34fc6a2
  - [x] graph-input rebuild signature → `rebuildSignature(data, clusterLabels,
        settings)` (`src/layout/rebuild-signature.ts`, next to `layout-signature.ts`
        which it composes) + `test/rebuild-signature.test.ts`. The inline
        `JSON.stringify({n,e,c,s})` early-out signature in `buildGraph` (`view.ts`) —
        node id/label/memberships + edge endpoints + `[...clusterLabels.entries()]` +
        `layoutSignature(settings)` — is now a pure builder; the view's `rebuildSig`
        line collapses to a thin call. Test locks input-identity stability, node/edge/
        cluster-label change flips, the display-only-toggle invariance (inherited from
        `layoutSignature`), the missing-memberships `?? []` default, and input
        non-mutation. Sibling of the `layoutSignature` extraction; behaviour-identical.
        view.ts 4192 → 4187; ratchet tightened. — 7d7c348
  - [x] transform-apply idiom dedup → `applyTransform(t)` private method (`src/view.ts`).
        The 9 byte-identical `this.zoom = t.zoom; this.panX = t.panX; this.panY = t.panY;`
        blocks scattered across every fit/zoom path (`zoomBy`, `fitToRect`, the four
        `fitToView` mode branches, `centerDrosteOn`, `locateNodeOnCanvas`, the wheel
        handler) — each consuming a `{zoom,panX,panY}` result from `fitTransform` /
        `zoomAroundPointer` / `*Fit` — now call one private helper, so no path can
        copy-paste-drift into setting only two of the three fields. A `this`-mutating
        seam (no pure module/test — covered by tsc + the render-smoke suite), unlike the
        earlier pure-fit-builder seams that produce the `t` this consumes. Behaviour-
        identical. view.ts 4145 → 4137; ratchet tightened.
  - [x] canvas-local pointer coords dedup → `screenPointFromRect(rect, e)` /
        `RectOrigin`/`ClientPoint`/`ScreenPoint` (`src/interaction/pointer-pos.ts`) +
        `test/pointer-pos.test.ts`. The 3-line `const sx = e.clientX - rect.left; const
        sy = e.clientY - rect.top;` (plus one comma-joined variant) that every input
        handler in `view.ts` re-derived after its `getBoundingClientRect()` read —
        mousemove hover-hit (`this.canvas`), the legend mousedown drag-start, the legend
        mousemove pan, the canvas-content mousemove hit, the mouseup click, and the wheel
        handler (all on the captured `c`) — now destructure one pure helper; the DOM
        `getBoundingClientRect()` read stays at each call site. Test locks per-axis
        independence (left↔sx, top↔sy), zero-origin passthrough, and no clamping
        (pointer left/above the canvas → negative). The two inline `scheduleHover`/
        `positionTip` arg re-uses (reuse an already-computed rect) and the scrollbar-drag
        `sy`-only read are left as-is. Behaviour-identical; view.ts 4137 → 4133; ratchet
        tightened.
  - [x] unit-interval clamp dedup → `clamp01(n)` (`src/util/clamp01.ts`, next to
        `clampScroll`/`clampZoom`) + `test/clamp01.test.ts`. The `Math.max(0,
        Math.min(1, t))` clamp-to-`[0,1]` on a normalized interpolation/colour
        parameter was re-derived inline across the draw/encoding layers: a local
        `clamp01` in `draw/mode-legend.ts`, the quantitative scale normalizer
        (`encoding/scales.ts`), the legend gradient sampler (`draw/legend-layout.ts`
        `rampColorAt`), and the shared sequential ramp (`draw/legend-spec.ts`
        `sequentialColorRamp`); all now call the one pure helper (the mode-legend
        local is deleted). The `[0, canvasW-drawWidth]` clamps in `legend-layout.ts`
        keep their own inline form (different ceiling). Test locks both endpoints,
        floor/ceiling, and an inline-equivalence grid. Behaviour-identical. Mirrors
        the `clampScroll`/`clampZoom`/`jaccard` util dedups. — 02d975e
  - [x] Tree-pane bulk Select/Deselect-all button descriptors → `noteMenuBulkActions()`
        (`src/interaction/note-menu-geom.ts`, next to `noteMenuGroupOptions`) + a case
        in `test/note-menu-geom.test.ts`. The two byte-identical `mkBulkBtn` calls in
        `ensureNoteMenu` differed only in the `hide` boolean passed to `bulkSetHidden`
        and the label; both now render from one loop over a pure `{ label, hide }[]`
        descriptor list sharing a single handler. Test locks labels + hide-flag + order
        (Select shows/hide false first, Deselect hides/hide true) — a flipped flag would
        invert the buttons. Mirrors the `noteMenuGroupOptions` extraction. — b6d4a9c
  - [x] legend number formatter dedup → `formatLegendNumber(n)`
        (`src/util/format-number.ts`, next to `clamp01` which both consumers already
        import) + `test/format-number.test.ts`. The compact legend-label formatter
        (non-finite → em-dash, round to 2dp, normalize a rounded `-0` → `"0"`) was
        defined twice as byte-identical local consts: `fmt` in `draw/mode-legend.ts`
        and `fmtNum` in `draw/legend-spec.ts`; both now call the one pure helper.
        `svg-recorder.ts`'s `num` keeps its own form (3dp + `"0"` on non-finite —
        distinct semantics, not folded in). Test locks non-finite→em-dash, 2dp
        rounding, `-0`→`"0"`, and an inline-equivalence grid. Behaviour-identical.
        Mirrors the `clamp01`/`jaccard` util dedups. — a76059d
  - [x] EncContext `frontmatterOf` dedup → private `frontmatterRecordOf(id)` method
        (`src/view.ts`). The two byte-identical `frontmatterOf` closures — one in
        `buildGraph`'s `EncContext`, one in the Icon Gallery axis pass — each ran
        `getAbstractFileByPath` → `instanceof TFile` → `getFileCache().frontmatter as
        Record<string,unknown>` (else undefined); both now read from one private method,
        with each `EncContext.frontmatterOf` a thin `(id) => this.frontmatterRecordOf(id)`
        arrow. A `this`-coupled Obsidian-adapter seam (no pure module/test — the helper is
        pure Obsidian calls, covered by tsc, like `applyTransform`), not a pure builder;
        `src/util/` stays Obsidian-free. Behaviour-identical. — 89feacc
  - [x] colour-fill tag-based predicate → `colorIsTagBased(bindings)`
        (`src/encoding/color-tag-based.ts`) + `test/color-tag-based.test.ts`. The
        multi-tag stripe / legend-lie guard in `buildGraph` (`view.ts`) — `!colorBinding
        || colorBinding.fieldId === "tag"` over the enabled `color` binding, deciding
        whether the card fill stays free for a note's per-tag stripe hues — is now a pure
        predicate; the `this.colorIsTagBased` assignment collapses to a thin call (the
        throwaway `colorBinding` const drops). Test locks empty→tag-based, color→tag→
        tag-based, color→other→not, disabled-color→inert→tag-based, and non-color-channels
        -ignored. Behaviour-identical (import offsets the shrink; view.ts held at 4131). — 0ad6c20
  - [x] vault path→basename idiom dedup → private `basenameOrPath(path)` method
        (`src/view.ts`, next to `buildLatticeNamedLabels`). The
        `getAbstractFileByPath → instanceof TFile ? basename : path` fallback was
        re-derived byte-identically at 3 sites (`buildLatticeNamedLabels`, the Bases
        `labelOf` closure, the lattice `nameOf` closure); all three collapse to a thin
        call. View-only (touches `app.vault`) so no unit test — same as the
        `frontmatterRecordOf`/`applyTransform` private-method dedups; `tsc` covers it.
        The sibling `mtimeOf` closure (returns `stat.mtime`, different type) stays
        inline. Behaviour-identical. view.ts 4131 → 4129; ratchet tightened. — 2a2e2d9
  - [x] EncContext degree lookup → `degreeInfoOf(id, maps)` / `DegreeInfo`
        (`src/query/rebuild-pipeline.ts`, next to `computeDegreeMaps` which produces
        the `DegreeMaps`) + `test/degree-info.test.ts`. The inline `degreeOf` closure
        in `buildGraph`'s `EncContext` (`view.ts`) — total-degree presence gate then
        `?? 0`-defaulted directional counts — is now a pure lookup the closure calls
        with the local `degrees` struct. **Bonus**: this exposed that `this.degreeMap`/
        `this.inDegreeMap`/`this.outDegreeMap` were write-only (the removed closure was
        their sole reader — encoding's field-sources now read degree via
        `ctx.degreeOf`), so all three persisted fields + their assignments were removed
        (`degrees` stays a rebuild-local). Test locks total+directional resolve, pure-
        sink→outDeg 0, absent→undefined, presence-keys-off-total (a directional-only
        ghost → undefined), and zero-total-still-present. Behaviour-identical.
        view.ts 4123 → 4110; ratchet tightened.

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
