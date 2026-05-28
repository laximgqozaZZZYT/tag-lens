# Tag Lens

Lightweight tag-membership visualisations for an Obsidian vault: a connection
matrix, a tag co-occurrence heatmap, an UpSet plot, and a bipartite tag graph.

Designed for vaults where notes are tagged in deeply overlapping ways and a
single force-directed graph would just hairball. Each view answers a different
question.

## View modes

| Mode | What it shows |
|---|---|
| **Connection matrix** | Rows = notes, columns = tags, a dot marks membership. Rows and columns are seriated (Jaccard barycenter) so co-occurring tags / similar notes sit together. Same-signature rows can be bundled into ×N blocks and collapsed to a summary. |
| **Tag co-occurrence heatmap** | Symmetric tag × tag grid; cell shade = how many notes share two tags (Jaccard by default; raw count on a log/p95 scale). Diagonal = tag size. Click a cell to list the notes shared by that tag pair. |
| **UpSet plot** | Stack of cards per intersection signature + dot matrix at the bottom — handles ≥ 4-way intersections that diagrams can't draw. |
| **Bipartite tag graph** | Notes and tags are both nodes; an edge marks membership. Three placements: `Force` (spring embedder, default), `Concentric` (tags on an inner ring, notes on outer ring(s) with arc edges), `Clustered` (one main tag per note; notes packed in concentric rings around their main tag's "island"). |
| **BubbleSets** | Containment layout drawn as rectangular iso-contour bubbles. |
| Experimental (beta) | Nested set diagram / Containment map / Euler diagram — region/containment views that break on giant-tag, hierarchy-less vaults but are kept selectable. |

The settings panel (the sliders icon in the view's toolbar) is shared by every
mode: WHERE / GROUP_BY / HAVING / ORDER_BY / LIMIT expressions filter the data;
NODE DISPLAY controls card sizing; GRAPH DISPLAY toggles per-mode display
options (e.g. matrix `Group identical rows` / `Collapse groups`).

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

Tag Lens reads the **tags** (frontmatter `tags` and inline `#tag` markers) and
basic metadata (path, basename, frontmatter fields used by WHERE / GROUP_BY /
ORDER_BY) of **every Markdown note in the current vault** so it can build the
matrix / heatmap / UpSet / tag-graph visualisations. This is required for the
plugin's core purpose. The reads happen entirely **locally** — the plugin makes
**no network requests** and sends nothing to any server.

## Compatibility

Requires Obsidian **1.5.0** or later. Works on desktop and mobile (the heavy
modes — Euler family in the Experimental section — are best on desktop).

## Licence

MIT — see [`LICENSE`](LICENSE).
