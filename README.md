# Tag Lens

Lightweight tag-membership visualisations for an Obsidian vault: a per-note
**Icon Gallery**, an intersection lattice, a tag co-occurrence heatmap, an
UpSet plot, and BubbleSets — plus several experimental region / graph views.

Designed for vaults where notes are tagged in deeply overlapping ways and a
single force-directed graph would just hairball. Each view answers a different
question.

## View modes

| Mode | What it shows |
|---|---|
| **Icon Gallery** | One compact icon per note, tiled in a grid. From the note outward, each icon nests: the note itself, notes that share **all** its tags, groups of notes that share **some** of its tags (colour-coded per tag), and the note's **links / backlinks**. Pan/zoom to browse; an always-on search + folder-tree panel jumps to any note; hover for the file tip, click to open. |
| **Intersection lattice** | Degree-tiered Hasse-style layout of exact tag intersections with subset links; each node auto-switches between overview / density / individual rendering by count and zoom. |
| **Tag co-occurrence heatmap** | Symmetric tag × tag grid; cell shade = how many notes share two tags (Jaccard by default; raw count on a log/p95 scale). Diagonal = tag size. Click a cell to list the notes shared by that tag pair. |
| **UpSet plot** | Stack of cards per intersection signature + dot matrix at the bottom — handles ≥ 4-way intersections that diagrams can't draw. |
| **BubbleSets** | Containment layout drawn as rectangular iso-contour bubbles. |
| Experimental (beta) | **Connection matrix** (notes × tags dot grid, seriated), **Tag graph** (bipartite notes + tag nodes), and the region/containment family — **Nested set diagram / Containment map / Euler diagram** — kept selectable but with known scaling caveats on giant-tag, hierarchy-less vaults. |

## Unified Control Panel

The floating settings panel is now a **unified control center** available in every view mode. It is divided into four main tabs to help you filter, navigate, display, and analyze your graph:

### 1. Filter
Control exactly what data enters the graph. Switch between modes using the toggle icon at the top right of the tab.
- **SQL Mode**: Use the built-in expression engine to filter notes.
  - **WHERE**: Filter source notes by a query (`field:value`, `AND`, `OR`, glob, fuzzy).
  - **GROUP_BY**: Partition by `tag:*` or a frontmatter field.
  - **HAVING**: Drop clusters whose count fails the predicate.
  - **Sort (ORDER_BY / LIMIT)**: Sort criteria and limit tiers for per-cluster top-N display.
- **DataviewJS Mode (New)**: Bypass the built-in `WHERE` parser and use Obsidian Dataview's JavaScript API (`dv.pages()`). Returns a dynamic list of notes to feed into the graph while still perfectly respecting the `GROUP_BY` and `HAVING` layout structures.

### 2. Notes (Note Navigator)
A list of all notes surviving the filter pipeline.
- **Folder** and **Tag** trees. The tag tree groups notes by `#tag` and adds multi-tag combination sub-groups (e.g. `#a * #b`) so heavily overlapping notes are easy to find.
- **Search** by plain text, `#tag` (hierarchical) or frontmatter `key:value`, with live suggestions.
- **Show / hide** notes on the graph via a checkbox on each row; folder checkboxes cascade to their notes (tri-state), and **Select all / Deselect all** toggle everything at once.
- Click a note to focus / locate / open it.

### 3. Settings
Global graph display configurations and behavior.
- **Active Note View (New)**: Enable auto-following of the currently active note in your Obsidian editor. Tag Lens will automatically center and contextually visualize its links, backlinks, and shared tags.
- **NODE DISPLAY**: Card size (m × n cells, scaled by degree if chosen).
- **MIN FONT SIZE**: Screen-pixel floor below which text is not drawn (LOD).
- **GRAPH DISPLAY**: `Show nodes` / `Show enclosures` / `Show edges` / `Show grid`. Mode-specific toggles also appear here.

### 4. Insight (New)
Analyzes your current graph state to help you manage complexity.
- **Cognitive Load Metric**: Computes a real-time score based on visible nodes, edges, and clusters. Provides actionable advice when the graph becomes too complex.
- **Suggest**: Provides categorization suggestions and structural insights based on your frontmatter tag properties.

## Install

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the latest [release](../../releases/latest).
2. Copy them into `<vault>/.obsidian/plugins/tag-lens/`.
3. In Obsidian: Settings → Community plugins → enable **Tag Lens**.
4. Open the view: ribbon icon (forked-graph) or command palette "Open Tag Lens".

### From source

```bash
git clone https://github.com/laximgqozaZZZYT/tag-lens.git
cd tag-lens
npm install
npm run build
# main.js is produced at the repo root; copy main.js / manifest.json /
# styles.css into your vault's plugins/tag-lens/ folder.
```

## Usage

- Click the ribbon **Tag Lens** icon (or run the command "Open Tag Lens") to open a tab with the view.
- The floating **Unified Control Panel** will appear on the canvas. Drag its header to move it, the bottom-right corner to resize, or double-click the header to minimise.
- Navigate between the **Filter**, **Notes**, **Settings**, and **Insight** tabs to interact with your data.
- Hover any node / cell for a tooltip; click a note row / card to open the underlying file.

## Privacy & data access

Tag Lens reads the **tags** (frontmatter `tags` and inline `#tag` markers), **note links** (inline `[[…]]` and frontmatter links), and basic metadata (path, basename, frontmatter fields used by WHERE / GROUP_BY / ORDER_BY) of **every Markdown note in the current vault** so it can build the visualisations. This is required for the plugin's core purpose. The reads happen entirely **locally** — the plugin makes **no network requests** and sends nothing to any server.

## Compatibility

Requires Obsidian **1.5.0** or later. Works on desktop and mobile (the heavy modes — Euler family in the Experimental section — are best on desktop).

## Licence

MIT — see [`LICENSE`](LICENSE).
