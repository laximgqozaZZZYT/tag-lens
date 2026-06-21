# Tag Lens — Detailed Design (v0.3.18)

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

### rebuild-pipeline.ts
- Orchestrates the full rebuild cycle: parser → query → layout → encoding evaluation.
- Extracted from `view.ts` to reduce coupling and improve testability.

---

## 2. Layout layer

### layout.ts — `layout(layoutData, sized, opts): LaidOut`
- Branches on `opts.viewMode` (use **`grep -a`**):
  - `euler-true`→`layoutEulerTrue` (also reused by bubblesets), `euler-venn`→`layoutEulerVenn`, else→`layoutEulerNested`.
  - upset/matrix/heatmap/lattice/bipartite/stream each have their own `*-layout.ts`.
- **Attribute propagation into PositionedNode**: every `nodes.push({...})` MUST carry
  `mtime/fmStatus/fmMaturity/ageDays` (a past bug dropped them in euler-true/venn, silently disabling overlays).
- `LaidOut`: `nodes/edges/clusters` + optional `upset/matrix/heatmap/lattice/drosteGallery/stream/setNodeIds`.

### axis-layout.ts — Cartesian axis engine
- `axisLayout(nodes, ctx, opts)` → `{positions, axes, width, height}` with variable-width categorical bands
  and quantitative ticks (`AxisSpec`).
- Shared by card modes and Icon Gallery (via `droste-axis.ts`).

### droste-axis.ts — Icon Gallery axis integration
- Adapts the shared axis engine for the droste tile grid.
- Assigns `(col,row)` from axis bindings, keeping the tile renderer intact.

### Helpers
`cluster-bbox.ts`, `anchor-placement.ts`, `edge-routing.ts`, `subgroup-*.ts`,
`region-layout.ts` (euler family), `layout-shared.ts`, `cell-snap.ts`, `aggregate-snap.ts`.

---

## 3. Draw layer

### view.ts `draw()` — per-mode dispatch
- matrix/heatmap/lattice/droste/stream call their dedicated `draw-*.ts` and return.
- Card modes: world-map tiling → `drawBodyTile`→`drawCard`, enclosure/grid/edges.
- **Per-mode guards** (must match `display-applicability.ts`).

### draw-card.ts `drawCard(ctx, n, opts)` — pure card renderer
- Fill priority: highlighted → SET → tint → **`encFillColor`** → default `canvasBgAlt`.
- `statusColor` (outline), freshness alpha, maturity badge.
- **Never assign a number to fillStyle** (use `hsl()`/`theme().swatch`).

### Interaction
- `hit-test.ts`: click/hover target resolution for all view modes.
- `marquee-controller.ts`: rectangular selection on the canvas.
- `highlight.ts`: transient visual highlighting (search, hover, Active Note).
- `spreadsheet-pan.ts`: spreadsheet-style pan for screen-space modes.

---

## 4. Visual Encoding (src/encoding/) — Color, Position

### Responsibility (non-negotiable)
Attribute → visual-channel mapping only. **Never changes the displayed node set.**

### types.ts
- `FieldSource`, `VisualChannel`, `EncodingBinding`, `ScaleConfig`, `ScaledValue`, `NodeDrawParams`, `EncContext`.

### field-sources.ts (registry)
- `registerFieldSource()` / `resolveFieldSource(id)`. Built-ins: status / maturity / ageDays / tag / degree / inDegree / outDegree.

### channels.ts (registry)
- `registerChannel()` / `resolveChannel(id)`. Built-ins: `color`, `axisX`, `axisY`.

### scales.ts — `prepareScale(config, rawValues) → {apply, legend}`
- quantitative: linear/log/quantile, auto domain, p95 clamp, reverse → `{t:0..1}`.
- categorical/ordinal: palette override or `autoColor` → `{category, output:hsl}`.

### evaluate.ts — `evaluateEncoding(nodes, bindings, ctx, mode?)`
- **Invariants (test-pinned)**: input nodes are not mutated / `params.size == nodes.length`.

### migrate.ts
- `synthesizeEncodingFromLegacy(settings)` / `effectiveEncoding(encoding, legacy)`.

### Tests
`test/encoding-{scales,evaluate,migrate}.test.ts` (pure, Obsidian-free).

---

## 5. Insight (src/insight/)
- `compute.ts`: `computeCognitiveLoad`, `computeTagSuggestions`. **Mostly pure.**
- `render.ts`: `renderInsightOverview/Alerts/Suggest` (Alerts = Gap/Bridge/Stalled cluster/Ripening backlog).
- `actions.ts`: `applyGolderClassification`, `convertToNestedTag`.

## 6. Panel UI (src/panel/)
- `panel-sections.ts`: `renderToggleSection`/`renderOrderBySection` (free functions, DI pattern).
- `panel/settings-sections.ts`, `panel/settings-tabs.ts`: settings UI extracted from view.ts.
- `note-menu.ts`: navigator (folder/tag trees, search, show/hide, pin to sidebar).

## 7. Settings / types / applicability
- `types.ts`: `MiniSettings` / `DEFAULT_SETTINGS` / `ViewMode` / `GraphNode` / `EncodingBinding`.
  When adding a field, update **both the interface and DEFAULT_SETTINGS**.
- `display-applicability.ts`: `displayToggleApplies(mode,key)`.

---

## 8. Gotchas (mirror of AGENTS.md)
1. `src/layout.ts` NUL bytes → **`grep -a`**.
2. `src/view.ts` ~5200 lines → re-anchor with `grep -n`.
3. `npm run build`/`npm test` skip types → **`tsc --noEmit`** is the only gate.
4. Encoding never changes the displayed set.
5. E2E: check **actual reflection**, not just "no exception". Separate profile + cleanup.
