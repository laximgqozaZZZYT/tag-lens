# Tag Lens — Detailed Design (v0.3.12)

Per-module detail behind the layers in basic-design.md. Line numbers drift in the
god-file, so re-anchor with `grep -n` (use **`grep -a`** for `layout.ts`).

---

## 1. Data layer

### parser.ts — `buildGraph(app, whereRows, groupByRows, filterMode, dvjsFilter, statusField)`
- Scans every Markdown file and produces `GraphNode[]`.
- Per node: `id=path`, `label=basename`, `memberships` (cluster keys from GROUP_BY), `mtime`,
  `fmStatus` (frontmatter value of `statusField`, lowercased), `fmMaturity` (below), `ageDays`.
- **maturity**: frontmatter `maturity` resolved via `effectiveMaturity(persisted, suggestMaturity(...))`
  (valid value overrides, invalid/absent falls back to the heuristic). Backlink counts are precomputed.
- links/backlinks come from cache.links + frontmatterLinks.

### query.ts / query-pipeline.ts / query-filters.ts / qp-1d.ts
- `parseQuery` / `evalQuery` / `isMatched`, `FileFacts{path, tags, frontmatter, tagProperties}`.
- WHERE/GROUP_BY/HAVING/ORDER_BY/LIMIT. `tagN:` hierarchy, `tag.<key>:` join, AND/OR/XOR/NOR/NAND/glob/fuzzy.
- `havingMode: "filter"|"highlight"` (filter = drop, highlight = keep and emphasise).
- **filterMode**: `"sql"` (built-in) / `"dvjs"` (feed the output of DataviewJS `dv.pages()` into the node set).

---

## 2. Layout layer

### layout.ts — `layout(layoutData, sized, opts): LaidOut`
- Branches on `opts.viewMode` (use **`grep -a`**):
  - `euler-true`→`layoutEulerTrue` (also reused by bubblesets), `euler-venn`→`layoutEulerVenn`, else→`layoutEulerNested`.
  - upset/matrix/heatmap/lattice/bipartite/stream each have their own `*-layout.ts`.
- **Attribute propagation into PositionedNode**: every `nodes.push({...})` MUST carry
  `mtime/fmStatus/fmMaturity/ageDays` (a past bug dropped them in euler-true/venn, silently disabling overlays).
- `LaidOut`: `nodes/edges/clusters` + optional `upset/matrix/heatmap/lattice/drosteGallery/stream/setNodeIds`.
  - When `setNodeIds` (bipartite's SET nodes) is present, the card grid is suppressed.

### Helpers
`cluster-bbox.ts` (cluster bbox/inheritance), `anchor-placement.ts`, `edge-routing.ts`, `subgroup-*.ts`,
`region-layout.ts` (euler family; the legacy spec is at `docs/old/region-layout-spec.md`), and the various `*-layout.ts`.

---

## 3. Draw layer

### view.ts `draw()` — per-mode dispatch
- matrix/heatmap/lattice/droste/stream call their dedicated `draw-*.ts` and return (screen-space or single diagram).
- Card modes go through the world-map tiling → `drawBodyTile`→`drawCard`, drawing enclosure/grid/edges.
- **Per-mode guards** (must match the applicability table in `display-applicability.ts`):
  - `showEnclosures`/`showEdges`/`showGrid` use `!this.laid.upset` (not drawn in upset).
  - grid uses `!this.laid.setNodeIds` (not drawn in bipartite).

### draw-card.ts `drawCard(ctx, n, opts)` — pure card renderer
- Fill priority: highlighted → SET (`fillHue`) → tint → **`encFillColor`** (visual encoding colour) → default `canvasBgAlt`.
  - `encFillColor` is **additive** (no encoding ⇒ unchanged).
- `statusColor` (outline, `!isSet`), freshness `globalAlpha=freshnessAlpha(mtime,now,staleDays)`, maturity badge.
- Numeric→colour goes through `clusterHue` (0..360) wrapped in `hsl()`/`theme().swatch` (**never assign a number to fillStyle**).

### draw-stream.ts and others
- Fonts use `Math.max(floorFontPx, …)` to respect minFontPx. Screen-space modes use `canvas.width/dpr`.

---

## 4. Visual Encoding (src/encoding/) — first scope: Color

### Responsibility (non-negotiable)
Attribute → visual-channel mapping only. **Never changes the displayed node set** (separate layer from query/dvjs).

### types.ts
- `FieldSource{id,label,kind(categorical|quantitative|temporal|ordinal),accessor(node,ctx)}`
- `VisualChannel{id,label,accepts,appliesTo(mode),apply(params,scaled,ctx)}`
- `EncodingBinding{channelId,fieldId,scale?,enabled}` (= `MiniSettings.encoding[]`)
- `ScaleConfig{type,domain?,palette?,reverse?,clampPctl?}` / `ScaledValue{t?,category?,output?,missing?}`
- `NodeDrawParams{fillColor?,fillHue?,sizeScale?,opacity?,icon?,borderColor?,groupKey?,axisX?,axisY?,label?}`
- `EncContext{nowMs, degreeOf?, frontmatterOf?}` (isolates Obsidian-dependent lookups)

### field-sources.ts (registry)
- `registerFieldSource()` / `resolveFieldSource(id)` (dynamic `frontmatter:<key>` made by `frontmatterField()`).
- Built-ins: status / maturity / ageDays / tag / degree / inDegree / outDegree.

### channels.ts (registry)
- `registerChannel()` / `resolveChannel(id)`. Built-in = `color` (`appliesTo:()=>true`, scaled→`fillColor`).

### scales.ts — `prepareScale(config, rawValues) → {apply, legend}`
- quantitative: linear/log/quantile, auto domain, p95 clamp, reverse → `{t:0..1}`.
- categorical/ordinal: palette override or `autoColor` (clusterHue) → `{category, output:hsl}`. `legend` produced too.

### evaluate.ts — `evaluateEncoding(nodes, bindings, ctx, mode?) → {params: Map<id,NodeDrawParams>, legends}`
- Per enabled binding: estimate domain → for each node `accessor→scale→channel.apply`.
- **Invariants (test-pinned)**: input nodes are not mutated / `params.size == nodes.length` (selection non-interference).
- Unknown field/channel ids are skipped silently.

### migrate.ts
- `synthesizeEncodingFromLegacy(settings)` (status overlay → color binding) / `effectiveEncoding(encoding, legacy)`.

### view.ts wiring
- At the end of `rebuild()`, build `EncContext{nowMs:Date.now(), degreeOf:degreeMap, frontmatterOf:metadataCache}`,
  then `evaluateEncoding(this.laid.nodes, settings.encoding, ctx, viewMode)` → `this.encParams/this.encLegends`.
- `drawCard` opts get `encFillColor: encParams.get(n.id)?.fillColor`.
- The "Encode" tab is `renderSettingsEncode` (color row: field binding / scale / reverse / auto-legend).

### Tests
`test/encoding-{scales,evaluate,migrate}.test.ts` (pure, Obsidian-free).

---

## 5. Insight (src/insight/)
- `compute.ts`: `computeCognitiveLoad(k)` (cognitive-load score from visible nodes/edges/clusters),
  `computeTagSuggestions` (per-tag count/ratio + percentile+entropy → Golder classification suggestions). **Mostly pure.**
- `render.ts`: `renderInsightOverview/Alerts/Suggest` (DOM build; Alerts = Gap/Bridge/Stalled cluster/Ripening backlog).
- `actions.ts`: `applyGolderClassification` (writes tag-page frontmatter `golder_type`), `convertToNestedTag`.

## 6. Panel UI (src/panel/)
- `panel-sections.ts`: `renderToggleSection`/`renderOrderBySection`, etc. (free functions taking deps `{settings,save,redraw}`).
- `panel/settings-sections.ts` and `panel/settings-tabs.ts`: settings UI extracted from view.ts (same deps pattern);
  view.ts keeps thin delegators. Further split plan: `refactor-view-split.md`.
- `note-menu.ts`: navigator (folder/tag trees, search, show/hide toggles, tag-page actions).

## 7. Settings / types / applicability
- `types.ts`: `MiniSettings` (all persisted settings) / `DEFAULT_SETTINGS` / `ViewMode` / `VIEW_MODES` / `GraphNode` /
  `EncodingBinding`. When adding a field, update **both the interface and DEFAULT_SETTINGS** (a past type-rot cause).
- `display-applicability.ts`: `displayToggleApplies(mode,key)` (per-mode gating of Display toggles; must match the actual draw guards).

---

## 8. Gotchas (mirror of AGENTS.md)
1. `src/layout.ts` contains NUL bytes → search with **`grep -a`** (plain grep returns empty without warning).
2. `src/view.ts` is a ~4800-line god-file. Re-anchor with `grep -n` before editing.
3. `npm run build`/`npm test` do NOT type-check → **`tsc --noEmit` (`npm run verify`) is the only type gate**.
4. Encoding never changes the displayed set. Dropping attribute propagation in layout causes silent overlay failure.
5. E2E must not pass on "no exception" alone → check **actual reflection** (draw params / laid.nodes values).
   Use a separate profile + dedicated port + cleanup.
