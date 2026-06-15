# Tag Lens — Basic Design (v0.3.12)

An Obsidian community plugin that visualises **tag-membership relationships** across
a vault's notes through many figure types, and adds analysis, tag refactoring, and
attribute-driven visual encoding on top.

- Form: a single `ItemView` (tab `tag-lens-view`) rendering to an **HTML5 Canvas (2D)**.
- Constraints: `minAppVersion 1.5.0` / desktop + mobile / **fully local (no network)**.
- Build: TypeScript + esbuild → `main.js`. Type checking is separate: `tsc --noEmit` (`npm run verify`).

---

## 1. Layered architecture (data flow)

```
Vault (Markdown)
   │  metadataCache (tags / links / frontmatter / mtime)
   ▼
[parser]  buildGraph        … node creation (GraphNode: tags=memberships, links/backlinks, fmStatus/fmMaturity/ageDays)
   ▼
[query]   WHERE/GROUP_BY/HAVING/ORDER_BY/LIMIT  … "which notes/clusters to show" = DATA-SELECTION layer
   │       (filterMode: "sql" built-in engine, or "dvjs" DataviewJS)
   ▼
[layout]  layout() → per-mode layout fns … geometry (PositionedNode / LaidOut)
   ▼
[encoding] evaluateEncoding … attribute → visual channel (colour, …) for displayed nodes. **Never changes the shown set** = VISUAL layer
   ▼
[draw]    draw() → per-mode draw-*.ts … render to Canvas
   ▲
[UI panel] unified control panel (Filter / Notes / Settings(View/Display/Encode/Layers) / Insight)
```

**Most important design principle: the data-selection layer (query, SQL/dvjs) and the
visual layer (encoding) are separate concerns.** Encoding never changes *which* notes
are shown — it only assigns per-node draw parameters.

---

## 2. View modes (11)

Modes are grouped by **perspective** in the View-mode picker:
- **Close-up**: per-note detail views (currently Icon Gallery only)
- **Panorama**: vault-wide structural overviews

| id | Name | Summary | Kind | Perspective |
|---|---|---|---|---|
| `droste` | Icon Gallery | Per-note icon (nested groups of same/partial-shared tags + links/backlinks), tiled | single diagram | Close-up |
| `lattice` | Intersection lattice | Degree-tiered Hasse-style layout + subset links; overview/density/individual auto-switch by count/zoom | screen-space | Panorama |
| `heatmap` | Co-occurrence heatmap | tag×tag co-occurrence grid (Jaccard or log+p95 count); gap overlay | screen-space | Panorama |
| `upset` | UpSet plot | Cards per intersection signature + dot matrix (handles ≥4-way) | hybrid (experimental) | Panorama |
| `matrix` | Connection matrix | notes×tags dot grid (seriated) | screen-space (experimental) | Panorama |
| `bipartite` | Tag graph | bipartite notes + tag nodes (force / concentric / clustered) | card (experimental) | Panorama |
| `bubblesets` | BubbleSets | containment layout as rectangular iso-contours | card (experimental) | Panorama |
| `euler` / `euler-true` / `euler-venn` | Nested set / Containment map / Euler | containment/overlap rectangle family | card (experimental) | Panorama |
| `stream` | Sequence Stream | tag × time/value-bin stream (dropped-thread detection) | screen-space (experimental) | Panorama |

> "Card modes" = those drawing world-space cards via drawBodyTile/drawCard
> (euler family / bipartite / bubblesets / upset). Overlays (status colour, freshness,
> maturity, encoding colour) take effect in card modes.

---

## 3. Key features

- **Unified control panel**: a floating panel (movable / resizable / minimisable / dockable). Tabs = Filter / Notes (navigator) / Settings / Insight.
- **Filter**: built-in SQL-like expressions (WHERE/GROUP_BY/HAVING/ORDER_BY/LIMIT) or DataviewJS.
- **Display**: showNodes/Enclosures/Edges/Grid, minFontPx, freshness/status overlay, maturity badge.
- **Encode**: the Visual Encoding Engine (bind attributes → visual channels; first scope = Color).
- **Insight**: cognitive-load metric / Alerts (Gap finder, Bridge finder, Stalled cluster, Ripening backlog) / Suggest (tag-classification suggestions).
- **Saved Lenses**: presets of filter/display settings, savable/appliable (also as commands).
- **Active Note View**: follow the active note and visualise its context (links/backlinks/shared tags).
- **PNG export**: high-resolution local save / clipboard for every mode.
- **Note navigator**: folder/tag trees, search, show/hide toggles.

---

## 4. Module map (src/)

| Area | Files |
|---|---|
| Entry | `main.ts` (plugin, command, ribbon), `view.ts` (MiniGraphView core, ~4800 lines) |
| Data | `parser.ts` (buildGraph), `query.ts` / `query-*.ts` / `qp-1d.ts` (query), `types.ts` (GraphNode/MiniSettings/ViewMode/EncodingBinding …) |
| Layout | `layout.ts` (dispatch), `*-layout.ts` (upset/matrix/bipartite/heatmap/lattice/stream/region/droste), `cluster-bbox.ts`, `anchor-placement.ts`, `edge-routing.ts`, … |
| Draw | `draw-*.ts` (card/matrix/heatmap/lattice/upset/droste/stream/edges/enclosures/helpers), `theme.ts`, `canvas-utils.ts` |
| **Encoding** | `encoding/{types,field-sources,channels,scales,evaluate,migrate}.ts` |
| **Insight** | `insight/{compute,render,actions}.ts` |
| **Panel UI** | `panel/{settings-sections,settings-tabs}.ts`, `panel-sections.ts`, `note-menu.ts` |
| Features | `freshness.ts`, `status-overlay.ts`, `tag-classification.ts`, `gap-finder.ts`, `bridge-finder.ts`, `lens-presets.ts`, `display-applicability.ts`, `image-export.ts` |

---

## 5. Key data structures (overview)
- `GraphNode`: id (path), label, memberships (tags), mtime, fmStatus, fmMaturity, ageDays.
- `PositionedNode`: GraphNode + x/y/width/height (after layout).
- `LaidOut`: nodes/edges/clusters + per-mode meta (upset/matrix/heatmap/lattice/stream/drosteGallery).
- `MiniSettings`: all persisted settings (viewMode, where/groupBy/having/…, per-mode settings, statusField/statusColors, freshnessOverlay/staleDays, showMaturity, **encoding: EncodingBinding[]**, …).
- `EncodingBinding`: { channelId, fieldId, scale, enabled } (visual encoding).

---

## 6. Design principles (invariants)
1. **Data selection ⊥ visual encoding**: encoding never changes the displayed node set.
2. **Extend via registry**: encoding channels/fields grow by a single `register*()` call.
3. **Verification gate**: `npm run verify` (tsc && test && build) green is the merge condition. esbuild ignores types, so `tsc` is the only type gate.
4. **Refactors are behaviour-preserving + verify-green + one-extraction-one-commit** (see `refactor-view-split.md`).

See **detailed-design.md** / **AGENTS.md** in this directory for more.
