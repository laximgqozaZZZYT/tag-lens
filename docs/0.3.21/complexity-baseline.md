# Cognitive-complexity baseline — Tag Lens v0.3.21

Captured by Ralph backlog item **P1**. This is a **measurement snapshot**, not an
enforced gate yet.

## Status of the rule

`complexity/noExcessiveCognitiveComplexity` is enabled in `biome.json` at
**`warn`** level (max allowed = Biome default **15**). Warnings do **not** fail
`biome lint` (no `--error-on-warnings`), so `npm run verify` stays green — the
rule only reports. Flipping it to `error` is a **later** backlog item, to be done
once the biggest methods have shrunk below the threshold.

To reproduce the count:

```sh
npx biome lint src test --max-diagnostics=none 2>&1 | grep -c noExcessiveCognitiveComplexity
```

## Snapshot (this baseline)

- **Total offenders: 111** (`src/`: 108, `test/`: 3)
- **Max score: 163** (`src/draw/draw-helpers.ts:121`, against max 15)

### Worst offenders by file (count ≥ 3)

| count | file |
|---:|---|
| 16 | `src/view.ts` |
| 5 | `src/draw/draw-helpers.ts` |
| 5 | `src/draw/draw-droste.ts` |
| 4 | `src/layout/layout.ts` |
| 4 | `src/interaction/note-menu.ts` |
| 4 | `src/insight/compute.ts` |
| 3 | `src/layout/edge-routing.ts` |
| 3 | `src/layout/cluster-bbox.ts` |
| 3 | `src/layout/block-table-venn.ts` |
| 3 | `src/draw/mode-legend-input.ts` |
| 3 | `src/draw/draw-lattice.ts` |

The `view.ts` cluster and the `draw/` + `layout/` hotspots line up with the
existing view-split and BubbleSets work in `refactor-view-split.md`; reducing those
methods will move this number down without any rule change.

## How to use this as a ratchet

When a later backlog item shrinks a hotspot, re-run the count above. Progress is the
total dropping below **111**. Once it reaches a small, stable number, flip the rule
to `error` and add a test/CI assertion so it cannot regress.

## Full ranking (score, location)

| score | location |
|---:|---|
| 163 | `src/draw/draw-helpers.ts:121` |
| 137 | `src/layout/cluster-bbox.ts:172` |
| 125 | `src/layout/layout.ts:783` |
| 107 | `src/layout/lattice-layout.ts:219` |
| 92 | `src/draw/draw-bubblesets.ts:5` |
| 89 | `src/query/query.ts:190` |
| 83 | `src/draw/draw-heatmap.ts:47` |
| 78 | `src/draw/draw-enclosures.ts:25` |
| 76 | `src/draw/mode-legend-input.ts:31` |
| 67 | `src/insight/compute.ts:28` |
| 60 | `src/draw/draw-droste.ts:292` |
| 57 | `src/query/bridge-finder.ts:8` |
| 54 | `src/interaction/highlight.ts:62` |
| 54 | `src/view.ts:2472` |
| 53 | `src/draw/draw-droste.ts:216` |
| 53 | `src/layout/layout.ts:382` |
| 52 | `src/draw/canvas-utils.ts:96` |
| 51 | `src/layout/aggregate-snap.ts:47` |
| 51 | `src/layout/axis-layout.ts:168` |
| 51 | `test/aggregation-properties.test.ts:86` |
| 47 | `src/view.ts:1075` |
| 46 | `src/visual/node-display.ts:58` |
| 45 | `src/draw/legend-layout.ts:123` |
| 45 | `src/main.ts:85` |
| 43 | `src/panel/settings-tabs.ts:378` |
| 42 | `src/view.ts:4285` |
| 42 | `test/bubblesets-invariants.test.ts:47` |
| 41 | `src/draw/mode-legend-input.ts:257` |
| 41 | `src/layout/droste-layout.ts:238` |
| 41 | `src/view.ts:3886` |
| 40 | `src/panel/menu-notes.ts:28` |
| 40 | `src/view.ts:1382` |
| 39 | `src/insight/compute.ts:266` |
| 38 | `src/view.ts:2219` |
| 36 | `src/insight/render.ts:133` |
| 35 | `src/draw/draw-card.ts:116` |
| 35 | `src/draw/draw-upset.ts:257` |
| 35 | `src/layout/cell-snap.ts:13` |
| 34 | `src/draw/draw-droste.ts:490` |
| 34 | `src/draw/mode-legend-input.ts:48` |
| 32 | `src/draw/draw-helpers.ts:28` |
| 32 | `src/interaction/hit-test.ts:34` |
| 32 | `src/layout/block-table-venn.ts:74` |
| 32 | `src/view.ts:4103` |
| 31 | `src/layout/edge-routing.ts:126` |
| 31 | `src/view.ts:578` |
| 30 | `src/bases/project.ts:71` |
| 30 | `src/draw/draw-droste.ts:137` |
| 30 | `src/draw/draw-helpers.ts:486` |
| 30 | `src/draw/legend-layout.ts:42` |
| 30 | `src/layout/heatmap-layout.ts:12` |
| 30 | `src/view.ts:2105` |
| 29 | `src/aggregation/compute.ts:22` |
| 29 | `src/insight/render.ts:237` |
| 28 | `src/draw/draw-droste.ts:122` |
| 28 | `src/layout/aggregate-util.ts:10` |
| 28 | `src/layout/upset-layout.ts:49` |
| 28 | `src/panel/query-builder.ts:66` |
| 27 | `src/insight/compute.ts:318` |
| 27 | `src/interaction/note-menu.ts:443` |
| 25 | `src/layout/aggregate-util.ts:47` |
| 25 | `src/view.ts:4019` |
| 24 | `src/insight/actions.ts:62` |
| 24 | `src/interaction/note-menu.ts:711` |
| 24 | `src/layout/layout.ts:1186` |
| 24 | `src/query/limit.ts:18` |
| 24 | `src/query/query.ts:42` |
| 23 | `src/bases/relations.ts:117` |
| 23 | `src/draw/draw-helpers.ts:564` |
| 23 | `src/draw/draw-lattice.ts:298` |
| 23 | `src/draw/draw-lattice.ts:383` |
| 23 | `src/layout/block-table-venn.ts:243` |
| 23 | `src/layout/droste-axis.ts:154` |
| 23 | `src/panel/settings-sections.ts:145` |
| 22 | `src/encoding/scales.ts:72` |
| 22 | `src/interaction/note-menu.ts:609` |
| 22 | `src/layout/label-collision.ts:135` |
| 21 | `src/bases/parser.ts:80` |
| 21 | `src/bases/relations.ts:63` |
| 21 | `src/insight/compute.ts:207` |
| 21 | `src/layout/droste-layout.ts:76` |
| 21 | `src/view.ts:3639` |
| 20 | `src/bases/parser.ts:103` |
| 20 | `src/bases/resolve.ts:21` |
| 20 | `src/draw/mode-legend.ts:232` |
| 20 | `src/view.ts:3553` |
| 19 | `src/bases/build-index.ts:13` |
| 19 | `src/encoding/scales.ts:57` |
| 19 | `src/layout/axis-layout.ts:62` |
| 19 | `src/layout/cluster-bbox.ts:318` |
| 19 | `src/layout/cluster-relations.ts:25` |
| 19 | `src/visual/svg-recorder.ts:281` |
| 18 | `src/draw/draw-edges.ts:71` |
| 18 | `src/draw/draw-helpers.ts:393` |
| 18 | `src/interaction/note-menu.ts:422` |
| 18 | `src/layout/cluster-bbox.ts:39` |
| 18 | `src/panel/data-table-view.ts:18` |
| 18 | `src/panel/settings-sections.ts:98` |
| 17 | `src/draw/draw-lattice.ts:691` |
| 17 | `src/insight/actions.ts:67` |
| 17 | `test/aggregation-properties.test.ts:41` |
| 16 | `src/interaction/highlight.ts:17` |
| 16 | `src/layout/block-table-venn.ts:88` |
| 16 | `src/layout/edge-routing.ts:181` |
| 16 | `src/layout/edge-routing.ts:215` |
| 16 | `src/layout/layout-shared.ts:58` |
| 16 | `src/layout/layout.ts:941` |
| 16 | `src/view.ts:2919` |
| 16 | `src/view.ts:3524` |
| 16 | `src/view.ts:4172` |
| 16 | `src/view.ts:4445` |
