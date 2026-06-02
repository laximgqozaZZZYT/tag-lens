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

The settings panel (the sliders icon in the view's toolbar) is shared by every
mode: WHERE / GROUP_BY / HAVING / ORDER_BY / LIMIT expressions filter the data;
NODE DISPLAY controls card sizing; GRAPH DISPLAY toggles per-mode display
options (e.g. matrix `Group identical rows` / `Collapse groups`).

## Note navigator

A floating panel — available in **every** view mode — lists all notes (after
WHERE / GROUP_BY / HAVING / LIMIT), with the same content regardless of the mode:

- **Folder** and **Tag** trees. The tag tree groups notes by `#tag` and adds
  multi-tag **combination sub-groups** (e.g. `#a · #b`) so notes that belong to
  several tags are easy to find.
- **Search** by plain text, `#tag` (hierarchical) or frontmatter `key:value`,
  with live suggestions.
- **Show / hide** notes on the graph via a checkbox on each row; folder
  checkboxes cascade to their notes (tri-state), and **Select all / Deselect all**
  toggle everything at once.
- Click a note to focus / locate / open it.

The panel is **movable, resizable and minimisable** (drag the header to move, the
bottom-right corner to resize, double-click the header to minimise); show or hide
it from the settings panel.

## Install

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the latest
   [release](../../releases/latest).
2. Copy them into `<vault>/.obsidian/plugins/tag-lens/`.
3. In Obsidian: Settings → Community plugins → enable **Tag Lens**.
4. Open the view: ribbon icon (forked-graph) or command palette
   "Open Tag Lens".

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

- Click the ribbon **Tag Lens** icon (or run the command
  "Open Tag Lens") to open a tab with the view.
- Use the toolbar sliders button to toggle the right-hand settings panel.
- Pick a **View mode** at the top of the panel; mode-specific controls
  appear in their relevant sections (HAVING for tag filters, ORDER_BY for
  ordering, GRAPH DISPLAY for display toggles).
- Hover any node / cell for a tooltip; click a note row / card to open the
  underlying file.

## Settings overview

- **WHERE** — filter source notes by a query (`field:value`, `AND`, `OR`,
  `XOR`, `NOR`, `NAND`, glob, fuzzy).
- **GROUP_BY** — partition by `tag:*` or a frontmatter field.
- **HAVING** — drop clusters whose count fails the predicate. The matrix mode
  adds a `Min column size` here (drop singleton-tag columns); the heatmap mode
  adds a `Min tag size`.
- **ORDER_BY** — sort criterion + asc/desc. Matrix mode replaces the criterion
  list with `co-occurrence` / `block-priority`; heatmap mode with
  `co-occurrence` / `size`.
- **LIMIT** — `limit N` / `brief M` tiers for per-cluster top-N display.
- **NODE DISPLAY** — card size (m × n cells, scaled by degree if chosen).
  Hidden in matrix / heatmap (cells are fixed-size).
- **MIN FONT SIZE** — screen-pixel floor below which text is not drawn (LOD).
- **GRAPH DISPLAY** — `Show nodes` / `Show enclosures` / `Show edges` /
  `Show grid`. Matrix mode adds `Group identical rows` / `Collapse groups`.
  Heatmap mode adds `Jaccard color scale`.

## Privacy & data access

Tag Lens reads the **tags** (frontmatter `tags` and inline `#tag` markers),
**note links** (inline `[[…]]` and frontmatter links — used for the Icon
Gallery's link / backlink ring), and basic metadata (path, basename,
frontmatter fields used by WHERE / GROUP_BY / ORDER_BY) of **every Markdown
note in the current vault** so it can build the visualisations. This is
required for the plugin's core purpose. The reads happen entirely **locally** —
the plugin makes **no network requests** and sends nothing to any server.

## Compatibility

Requires Obsidian **1.5.0** or later. Works on desktop and mobile (the heavy
modes — Euler family in the Experimental section — are best on desktop).

## Licence

MIT — see [`LICENSE`](LICENSE).
