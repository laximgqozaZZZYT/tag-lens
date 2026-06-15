# Tag Lens — Improvement Proposals & Future Roadmap (v0.3.17)

Covers both short-term refinements and longer-term feature candidates. Items are
grouped by area and tagged with effort/impact where helpful.

---

## 1. Visual Encoding Engine — Channel Expansion

The encoding engine was designed as a registry: adding a channel should be a single
`registerChannel()` call. Only **Color** and **Position X/Y** are currently shipped.
The original design brief (`docs/old/design-encoding-engine.md`) planned the following
growth path.

| Channel | id | Purpose | Effort |
|---|---|---|---|
| **Size** | `size` | Map a quantitative field (e.g. degree, wordCount) to node scale factor (`sizeScale`). Currently `nodeSizeMode` uses a fixed enum; migrating it to a Size encoding unifies the model. | Low |
| **Opacity** | `opacity` | Generalise the freshness overlay: any quantitative field → alpha. Subsumes `freshnessOverlay`/`staleDays`. | Low |
| **Shape / Icon** | `shape` | Show a categorical badge or glyph per node (e.g. maturity → icon). Subsumes `showMaturity`. | Medium |
| **Border** | `border` | Map a categorical field to outline colour. Subsumes `statusField`/`statusColors`. | Low |
| **Group / Facet** | `group` | Split the figure into sub-plots by a categorical field (small multiples). | High |
| **Label** | `label` | Override or annotate the node's displayed label with a computed field. | Low |

> **Goal**: once Size + Opacity + Border are shipped, the legacy toggles
> (`freshnessOverlay`, `statusField`, `nodeSizeMode`) become thin wrappers around
> encoding bindings, and the "Encode" tab becomes the single surface for all visual
> parameter customisation.

### 1a. Colour Ramp Customisation
- Let users pick a custom sequential / diverging / qualitative palette in the Encode UI
  (currently only an auto-generated HSL ramp or per-category auto-colour).
- Provide preset palettes (Viridis, Inferno, Tableau 10, …) accessible from a dropdown.

### 1b. Additional Field Sources
- `wordCount` — quantitative; useful for identifying stubs vs. long-form notes.
- `folder` — categorical (directory path); enables folder-based colouring.
- `createdDate` / `ctime` — temporal; age reckoned from creation rather than mtime.
- `tagCount` — quantitative; how many tags a note has.
- `linkCount` — quantitative (outgoing links); distinct from degree.
- `backlinksCount` — quantitative (incoming links).
- Custom computed fields: let users define a JavaScript expression evaluated per node.

---

## 2. View Modes

### 2a. Stabilise Experimental Modes → GA
Several modes are marked `experimental`. A dedicated stabilisation pass per mode would
help promote them to GA:

| Mode | Blocking Issue |
|---|---|
| **UpSet** | Performance on vaults with many intersection signatures (>100 columns). |
| **Matrix** | Row-per-note model scales poorly past ~1000 notes; collapsed signature blocks help but UX needs polish. |
| **Tag Graph (bipartite)** | "Clustered" layout pins multi-membership notes to one island; a proper between-cluster placement is needed. |
| **Euler family** | Overlapping rectangles hairball on hierarchy-less vaults. A heuristic auto-filter (hide tags below threshold) could help. |
| **Stream** | Binning logic for non-date sequential fields; axis label formatting. |

### 2b. New Mode Candidates
- **Timeline**: horizontal lane-per-note Gantt-style chart using mtime/ctime ranges.
  Complements Sequence Stream (which is tag-oriented) by being note-oriented.
- **Chord Diagram**: circular tag-pair arcs weighted by co-occurrence count.
  More compact than the heatmap for identifying top pairs at a glance.
- **Treemap**: nested rectangles by tag hierarchy (tag/subtag) with area ∝ note count.
  Natural for hierarchical tag systems (`#project/alpha`, `#project/beta`).
- **Sankey / Alluvial**: track how notes flow between categorical states
  (e.g. `status: draft → review → done`) over time or through tag transitions.

---

## 3. Insight Dashboard

### 3a. Additional Insight Alerts
The original F9 brief listed 8–12 insight types. Currently shipped: Gap Finder,
Bridge Finder, Stalled cluster, Ripening backlog. Candidates to add:

| Insight | Detection | Value |
|---|---|---|
| **Orphan Notes** | Notes with zero tags AND zero links. | Immediate cleanup target. |
| **Redundant Tag Pair** | Two tags with Jaccard ≥ 0.9 (near-identical membership). | Merge / alias candidates. |
| **Over-broad Tag** | Tag covering > N% of all notes (e.g. 40%). | Splitting / sub-tagging suggestions. |
| **Naming Inconsistency** | Edit distance / phonetic similarity between tag names. | Typo / variant detection. |
| **Hub Note** | Notes with inDegree above the 95th percentile. | Highlight important reference notes. |
| **Singleton Tags** | Tags used by exactly one note. | Cleanup or enrichment candidates. |
| **Tag Hierarchy Suggestion** | Detect co-occurrence clusters that form a natural parent/child hierarchy. | Propose `#parent/child` restructuring. |
| **Stale Cluster** | All notes in a cluster older than `staleDays`. | Flag dormant projects. |

### 3b. Insight Export
- **Copy to clipboard / Save as Markdown**: export the current Insight panel content
  (overview metrics, alerts, suggestions) as a Markdown file for journaling or review.
- **Periodic Digest**: optional command that generates a weekly summary of vault health
  changes (new orphans, resolved gaps, etc.).

### 3c. Insight → Action Deep Integration
- "Apply" buttons on each alert that pre-fill the Filter tab's WHERE clause to show
  only the affected notes (e.g. click "Orphan Notes" → `links:0 AND tags:0`).
- "Fix" buttons for Suggest items: one-click tag rename / merge / nest.

---

## 4. Performance & Scalability

### 4a. Web Worker Offloading
- Move the compute-heavy pipeline stages (parser, query, layout, encoding evaluation)
  to a Web Worker so the UI thread stays responsive during `rebuild()`.
- Particularly important for vaults with > 5000 notes where layout can take seconds.

### 4b. Incremental Rebuild
- Current `rebuild()` recomputes everything from vault metadata on any filter change.
- An incremental approach: cache the parsed `GraphNode[]`; on metadata change, diff the
  affected files and patch the cache rather than full re-parse.
- Layout/draw can then benefit from structural diffing (only re-layout changed clusters).

### 4c. Canvas Virtualisation (Tile-Based Rendering)
- Card modes already have `drawBodyTile` tiling; extend this to pre-render tiles at
  various zoom levels (MIP-map) so extreme zoom-out on large graphs doesn't repaint
  thousands of cards every frame.
- WebGL rendering path for vaults exceeding 10k nodes (future / stretch).

### 4d. Mobile Optimisation
- Reduce default layout density on mobile (auto-aggregate more aggressively).
- Touch gesture improvements: pinch-zoom smoothness, long-press context menu.
- Detect low-memory conditions and cap concurrent DOM / canvas allocations.

---

## 5. Architecture & Code Quality

### 5a. view.ts Split — Tier 4 (Drawing)
`view.ts` is still ~5200 lines. The deferred Tier 4 extraction (`drawBodyTile`,
`drawCardGrid`, `drawClusterLabels`) would bring it below ~4000. Risk is high
(tight coupling to pan/zoom/ctx state), so the approach should be:
1. Create a `DrawContext` interface bundling `{ctx, canvas, zoom, panX, panY, dpr, …}`.
2. Extract `drawBodyTile` → `draw-body-tile.ts` as a free function taking `DrawContext`.
3. Same for `drawClusterLabels`, `drawAxisGrid`, `drawGlobalDisplayFallbacks`.

### 5b. Automated Visual Regression Testing
- Capture reference screenshots from E2E runs and diff against baselines.
- Currently E2E checks are reflection-based (inspecting JS state); pixel-diff would
  catch rendering bugs (wrong colour, clipped text, z-order issues).
- Tool candidates: Playwright screenshot comparison or a custom Canvas-pixel hash.

### 5c. Unit Test Coverage Expansion
- Current: 543 assertions across a handful of test files.
- Target: cover every layout function (`*-layout.ts`) with at least one structural test
  (input nodes → output positions satisfy expected invariants).
- Cover `query-pipeline.ts` / `query-filters.ts` edge cases (XOR/NOR/NAND, dvjs mode).

### 5d. Plugin Settings Migration Framework
- As `MiniSettings` grows, a formal migration system (version number + migrator chain)
  would prevent breakage when field semantics change or fields are removed.
- Currently handled ad-hoc by `{...DEFAULT_SETTINGS, ...raw}` merge + `migrate.ts`.

---

## 6. UX & Interaction

### 6a. Undo / Redo for Filter Changes
- Maintain a stack of filter states so users can quickly revert accidental WHERE/HAVING
  changes without manually re-typing.

### 6b. Cross-View Drill-Down
- Click a cell in the heatmap → seamlessly transition to the lattice or Icon Gallery
  showing exactly that tag intersection's notes.
- Currently closeup mode exists but the transition is abrupt (full rebuild). Animate
  the zoom/pan transition for spatial continuity.

### 6c. Multi-Window / Linked Views
- Allow opening two Tag Lens tabs side-by-side (e.g. heatmap + lattice) with
  synchronised filters: changing WHERE in one tab updates the other.
- Useful for comparing different perspectives on the same data simultaneously.

### 6d. Keyboard Navigation
- Arrow keys to move focus between nodes; Enter to open; Escape to deselect.
- `/` to focus the search box; `1`–`4` to switch panel tabs.
- Accessibility benefit: screen-reader–friendly focus management on the panel.

### 6e. Tooltip Enhancement
- Rich tooltips on hover: show note preview (first N characters), tag list, link count,
  maturity badge, encoding legend indicator — all in a compact popup.
- Delay-based: short hover → simple tooltip; sustained hover → expanded preview.

### 6f. Annotation / Bookmarking
- Let users place persistent annotations (text/arrow) on the canvas that survive
  rebuild, anchored to cluster or coordinate positions.
- "Bookmark this view" = save pan/zoom/filter state as a named bookmark (beyond Saved
  Lenses, which don't capture pan/zoom).

---

## 7. Ecosystem Integration

### 7a. Dataview Deep Integration
- Beyond `dv.pages()` as a filter source: let users bind Dataview inline fields
  (e.g. `rating:: 4`) as encoding field sources without manual `frontmatter:<key>`.
- Auto-detect Dataview-annotated fields in the vault and surface them in the Encode
  field picker dropdown.

### 7b. Canvas (Obsidian Canvas) Export
- Export the current graph layout as an Obsidian Canvas (`.canvas` JSON) so users can
  further annotate and arrange nodes in Obsidian's native spatial canvas.

### 7c. Publish / Share
- "Export as standalone HTML" — bundle the current view (data + rendering) into a
  self-contained HTML file that can be shared without Obsidian.
- SVG export alongside the existing PNG export for vector-quality output.

### 7d. Graph View Interop
- Highlight Tag Lens's current filter set in Obsidian's built-in graph view (and vice
  versa) via workspace events.

---

## 8. Internationalisation (i18n)

- Extract all user-facing strings (panel labels, insight texts, tooltips) into a
  locale file (`en.json`, `ja.json`, etc.).
- The plugin's author and user base include Japanese speakers; native i18n support
  would improve adoption.
- Insight copy (alert messages, suggestion texts) should be professionally localised,
  not machine-translated, for quality.

---

## 9. Documentation

### 9a. User-Facing Documentation
- **Getting Started guide**: a step-by-step tutorial with screenshots walking through
  the first 5 minutes of using Tag Lens (open → filter → switch mode → encode → insight).
- **View Mode Comparison Chart**: visual guide showing when to use which mode.
- **FAQ / Troubleshooting**: common issues (empty canvas, slow rebuild, mode not rendering).

### 9b. Developer Documentation
- **Contributing Guide** (`CONTRIBUTING.md`): PR workflow, code style, test expectations.
- **Architecture Diagram**: Mermaid diagram of the data flow pipeline (parser → query →
  layout → encoding → draw) embedded in README or basic-design.md.
- **API / Extension Points**: document the encoding registry pattern so third-party
  plugins could theoretically register custom channels / field sources.

### 9c. Versioned CHANGELOG Automation
- Adopt Conventional Commits and auto-generate CHANGELOG entries from commit messages
  using a tool like `standard-version` or `changesets`.

---

## Priority Matrix (suggested)

| Priority | Items | Rationale |
|---|---|---|
| **P0 — Next** | Size/Opacity/Border channels (§1), Orphan/Redundant/Overbroad alerts (§3a), view.ts Tier 4 split (§5a) | Low effort, high value; completes the encoding vision and cleans architecture. |
| **P1 — Soon** | Incremental rebuild (§4b), Colour ramp presets (§1a), Cross-view drill-down animation (§6b), Getting Started guide (§9a) | Improves daily usability and onboarding. |
| **P2 — Medium** | Web Worker (§4a), Stabilise UpSet/Matrix/Stream (§2a), Insight export (§3b), Keyboard nav (§6d), i18n (§8) | Addresses scaling and accessibility gaps. |
| **P3 — Later** | New view modes (§2b), Canvas export (§7b), Standalone HTML export (§7c), Visual regression tests (§5b), Annotation (§6f) | Significant effort or niche value; pursue after core stabilisation. |
