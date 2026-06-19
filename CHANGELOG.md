# Changelog

All notable changes to Tag Lens are documented here.

## 0.3.18

### Added — Dynamic HAVING Expressions
- **Variable Support**: Introduced `_noteCount` variable representing total vault notes in HAVING expressions (e.g., `count >= _noteCount * 0.05`).
- **Complex Logic**: Added support for `AND` operator, arithmetic multiplication (`*`), and parentheses `()` in HAVING grammar.
- **Improved Defaults**: `AUTO HAVING` now seeds the HAVING field with a formulaic expression relative to vault size for better stability across different vaults.
- **Transparency**: Auto-thresholds are now visible and editable in the Data > Logic > HAVING field when active.

## 0.3.17

Cumulative changes since 0.3.1.

### Added — Visual Encoding Engine
- **Visual Encoding Engine** (`src/encoding/`): declaratively bind note attributes (e.g. frontmatter `status`, computed `ageDays`, `degree`) to visual channels.
  - **Color** channel: map any categorical or quantitative field to node fill colour with automatic or custom palettes.
  - **Position X / Position Y** channels: Cartesian axis layout that arranges nodes by attribute (e.g. x = tag, y = degree) with variable-width categorical bands and quantitative ticks.
  - Extensible registry pattern (`registerFieldSource` / `registerChannel`).
  - Field sources: `status`, `maturity`, `ageDays`, `tag`, `degree`, `inDegree`, `outDegree`, dynamic `frontmatter:<key>`.
  - Scales: linear, log, quantile, categorical/ordinal, p95 clamp, reverse, auto-legend.
  - Legacy migration: existing status overlay settings are automatically synthesized into encoding bindings.

### Added — Insight Dashboard
- **Insight tab** in the unified control panel with three sub-tabs:
  - **Overview**: real-time Cognitive Load Metric based on visible nodes, edges, and clusters, with actionable complexity advice.
  - **Alerts**: automatic detection of statistical gaps (Gap Finder), unlinked similar notes (Bridge Finder / ghost edges), stalled clusters, and ripening backlogs.
  - **Suggest**: tag categorization suggestions based on Golder & Huberman's functional classification (Role, Type, Property, Context, Status) for batch refactoring.
- `applyGolderClassification` writes tag-page frontmatter `golder_type`.
- `convertToNestedTag` for taxonomy restructuring.

### Added — Sequence Stream View
- **Sequence Stream**: time-series transposed heatmap. X-axis = time bins (month, week) or sequential fields (chapters); Y-axis = tags.
- "Dropped threads" markers warn when a tag suddenly stops appearing.
- Dropped threads surface in the Insight Alerts panel.

### Added — Bridge Finder (Ghost Edges)
- Discovers "ghost edges" between notes with high Jaccard tag similarity but no physical link.
- Drawn as dashed lines on the canvas.
- "Link candidates" alert in the Insight panel with configurable similarity threshold.

### Added — Gap Finder
- Statistical analysis overlay identifying missing connections between tags that should theoretically have content.
- Highlights "empty" intersections for uncovering blind spots.

### Added — Active Note View
- **Active Note View** mode: auto-follow the active note in Obsidian's editor and instantly visualise its context (links, backlinks, shared tags).
- Toggled from the Settings → View tab.

### Added — Saved Lenses
- Save and restore filter/display/encoding presets as named lenses.
- Lenses are also registered as Obsidian commands for quick switching.

### Added — DataviewJS Filter Mode
- Bypass the built-in `WHERE` parser and use Obsidian Dataview's JavaScript API (`dv.pages()`).
- Returns a dynamic list of notes while still respecting `GROUP_BY` and `HAVING` layout structures.

### Added — Note Navigator Enhancements
- **Pin to Sidebar**: dock the navigator panel to the right edge of the canvas for persistent access alongside visualizations.
- **Tag tree combination sub-groups**: multi-tag combination nodes (e.g. `#a * #b`) for heavily overlapping notes.
- **Select all / Deselect all** toggle.
- **Marquee selection**: rectangular drag-select on the canvas.

### Added — Cartesian Axis Layout
- Variable-width categorical bands and quantitative ticks for card modes and Icon Gallery.
- Axis grid drawing with responsive label truncation and anti-overlap.
- `axis-layout.ts` (shared engine), `droste-axis.ts` (Icon Gallery integration).

### Added — Display & Overlay Improvements
- Freshness overlay (staleDays-based alpha fade).
- Status overlay (frontmatter-driven outline colours with configurable status-field and colour map).
- Note maturity badge (frontmatter + heuristic-based maturity assessment).
- `showNodes` / `showEnclosures` / `showEdges` / `showGrid` toggles, universal across all 11 view modes.
- Global minimum font size (`minFontPx`) setting.
- `display-applicability.ts` enforces per-mode toggle guards.

### Added — PNG Export
- High-resolution local save and clipboard export for every view mode.

### Changed — Architecture
- **Unified control panel**: floating, movable, resizable, minimisable, dockable panel with four tabs (Filter / Notes / Settings / Insight).
- Settings tab restructured into sub-tabs: View, Display, Encode, Layers.
- **view.ts refactoring** (Tier 1–3 done): settings UI → `panel/settings-sections.ts`, settings tabs → `panel/settings-tabs.ts`, insight engine → `insight/{compute,render,actions}.ts`. God-file reduced from ~6500 to ~5200 lines.
- `rebuild-pipeline.ts` extracted for rebuild cycle orchestration.
- `hit-test.ts`, `marquee-controller.ts`, `highlight.ts`, `spreadsheet-pan.ts` extracted for interaction concerns.
- `card-sizing.ts`, `node-display.ts` extracted for display logic.

### Changed — Filter
- `HAVING` mode supports `"filter"` (drop) and `"highlight"` (keep + emphasise).
- Query language extended: `XOR`, `NOR`, `NAND`, glob, fuzzy matching.

### Fixed
- Attribute propagation in euler-true/venn layouts (mtime/fmStatus/fmMaturity/ageDays were silently dropped).
- Co-occurrence heatmap closeup now correctly renders intersection notes without recursive neighbourhood expansion.
- Multiple view modes no longer render simultaneously with semi-transparency.
- Settings changes now reliably trigger canvas re-renders.

## 0.3.1

### Added — Note navigator (mini-menu)

A floating mini-menu, available in **every** view mode, that lists all notes
(after WHERE / GROUP_BY / HAVING / LIMIT) and lets you:

- Browse notes as a **Folder** tree or a **Tag** tree — the tag tree groups by
  `#tag` and adds multi-tag **combination sub-groups** (e.g. `#a * #b`, where `*`
  means AND / `|` means OR) so notes
  belonging to several tags are easy to find.
- **Search** by plain text, `#tag` (hierarchical) or frontmatter `key:value`,
  with live suggestions.
- **Show / hide** notes on the graph with a checkbox on each row; folder
  checkboxes cascade to their notes (tri-state), plus **Select all / Deselect
  all** to toggle everything at once.
- Click a note to focus / locate / open it.

The panel is **movable, resizable and minimisable** (drag the header to move, the
bottom-right corner to resize, double-click the header to minimise), its content
is identical in every view mode, and it can be shown or hidden from the settings
panel.
