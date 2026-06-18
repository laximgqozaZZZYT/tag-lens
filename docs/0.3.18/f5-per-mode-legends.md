# F5 — Per-mode on-canvas legends

Status: design (2026-06-18). Follows F4 (encoding legend). Supersedes the
encoding-only `drawLegend` call at `src/view.ts:2312`.

## Problem

The on-canvas legend (F4) only renders the user's **encoding bindings**
(`encLegends`), hardcoded to `bottom-left`, gated by `showLegend &&
encLegends.length`. So:

- Modes with no encoding binding show **no legend at all**, even though most
  modes have an INTRINSIC visual encoding the viewer needs decoded.
- The legend type is always "categorical swatch / blue gradient", which does
  not match what each mode actually paints (density ramps, size-by-count,
  tag-hue keys).
- It can collide with mode-fixed UI (upset footer, matrix/heatmap label bands).
- It cannot be dismissed from the canvas.

## Requirements (from user)

1. Every view mode shows a legend.
2. The legend KIND matches the mode's nature (e.g. Icon Gallery → node-colour
   key; Co-occurrence heatmap → count-intensity ramp).
3. An `×` button dismisses the legend; dismissal is **per-mode** (hides only the
   current viewmode's legend; other modes still show theirs).
4. The legend must not overlap mode-fixed elements (e.g. the Upset footer).
5. INVARIANT (carried from the colour fix): the legend must correspond to what
   the displayed nodes / display units actually show.

## Per-mode intrinsic encodings (survey)

| Mode | Intrinsic encoding | Legend kind |
|---|---|---|
| droste (Icon Gallery) | per-tag hue (③ single-tag), amber (② pair), accent (① focus) | categorical colour key |
| euler / euler-true / euler-venn | cluster-hue enclosure fill (`clusterHue(groupKey)`) | categorical colour key |
| bipartite | node fill = membership hue (`clusterHue(memberships[0])`) | categorical colour key |
| bubblesets | cluster-hue contours + card fill | categorical colour key |
| matrix | dot hue = column tag (`clusterHue(col.key)`) | categorical colour key |
| heatmap | diagonal amber lightness ∝ log(tag size); off-diagonal blue lightness ∝ co-occurrence (Jaccard/raw) | TWO gradient ramps |
| stream | row hue = tag; circle radius ∝ count | categorical colour key + size key |
| upset | footer dot = set membership; size bar ∝ set size; column count ∝ √count | colour key + size key (anchored away from footer) |
| lattice | LOD-dependent; overview bar height ∝ count | size key |

When the user HAS a colour/shape encoding bound (decision), the legend shows the
**bound encoding** (it is what the cards actually paint after the F4 colour fix),
not the intrinsic tag-hue. Intrinsic legends apply when no encoding overrides.

## Design

### Module 1 — `src/draw/legend-spec.ts` (new, pure)

Unify "what to render" behind one model so the renderer is mode-agnostic:

```ts
export type LegendKind = "categorical" | "gradient" | "size";
export interface LegendSpec {
  title: string;                 // "Co-occurrence", "Color · Tag", "Circle ∝ notes"
  kind: LegendKind;
  entries?: { label: string; color?: string; shape?: NodeShape }[]; // categorical
  ramp?: { stops: string[]; minLabel: string; maxLabel: string };   // gradient (n stops)
  sizes?: { label: string; radius: number; color?: string }[];      // graduated circles
}
```

Adapter `encodingToSpecs(BindingLegend[]): LegendSpec[]` converts the existing
F4 encoding legends (categorical → categorical, quantitative → gradient using the
SAME ramp the colour channel paints — reuse `sequentialColorRamp`/`categoricalColor`).

### Module 2 — `src/draw/mode-legend.ts` (new, pure)

```ts
export interface ModeLegendInput {
  encodingSpecs: LegendSpec[];   // from encodingToSpecs(encLegends); may be empty
  tags: { key: string; hue: number }[];   // distinct tags/clusters present + hues
  counts?: { min: number; max: number };   // for size/gradient ramps
  heatmap?: { jaccard: boolean };
}
export function buildModeLegend(mode: ViewMode, input: ModeLegendInput): LegendSpec[];
```

- If `input.encodingSpecs` non-empty → return those (decision: bound encoding wins).
- Else switch on mode to emit the intrinsic spec(s) per the table above.
- droste/euler*/bipartite/bubblesets/matrix → ONE categorical colour key from
  `input.tags` (capped, "+N more").
- heatmap → two gradient specs (amber "Tag size", blue "Co-occurrence"); append
  "(Jaccard)" to the co-occurrence title when on.
- stream → categorical tag key + one size spec ("Circle ∝ notes").
- upset → categorical "In set" key + size "Bar ∝ set size".
- lattice → size "Bar ∝ notes".

### Module 3 — anchor table

```ts
export function legendAnchor(mode: ViewMode): LegendAnchor;
```

Avoids each mode's fixed bands (from survey):
- matrix, heatmap → `bottom-right` (left label band + top header occupied)
- upset → `top-right` is taken by toolbar; footer takes bottom → use `bottom-right`
  only if it clears the footer height, else `top-right` below a small inset. Use
  `bottom-right` with a footer-aware bottom margin passed from the caller.
- stream, lattice, droste → `bottom-right` (left/bottom margins occupied)
- euler*, bipartite, bubblesets → `bottom-left` (current; only meta badges
  top-left, toolbar top-right).

### Module 4 — renderer extension (`legend-layout.ts`)

`drawLegend` rewritten to consume `LegendSpec[]` and render all three kinds:
categorical (swatch/shape), gradient (n-stop ramp, reuses the channel ramp), size
(graduated circles). Returns the painted screen rect (for hit-testing) plus the
`×` rect.

### Module 5 — `×` dismiss + per-mode hide

- Paint a small `×` glyph at the legend box's top-right. **Skip the `×` when
  `exportDprMul !== 1`** (export keeps the legend, drops the button).
- Settings: add `legendHiddenModes: Partial<Record<ViewMode, boolean>>` (default
  `{}`). Gate: `showLegend && !legendHiddenModes[mode]`.
- Hit-test: in the pointerdown handler (`attachInputs`, alongside the existing
  matrix/heatmap/stream screen-space hits), if the click is inside the cached `×`
  rect → set `legendHiddenModes[mode] = true`, save, redraw.
- Re-show: the existing Encode-tab `showLegend` toggle (F4-6) clears the current
  mode's hidden flag when re-enabled.

### Wiring (`view.ts`)

Replace the `src/view.ts:2312` block: build `ModeLegendInput` from `laid`/mode
geom, `const specs = buildModeLegend(mode, input)`, render at
`legendAnchor(mode)` when `showLegend && !legendHiddenModes[mode] && specs.length`.

## Phases (one commit each, repo cadence)

- **F5-1** legend-spec.ts model + encodingToSpecs adapter + tests.
- **F5-2** drawLegend rewrite to LegendSpec[] (categorical/gradient/size) + tests;
  encoding legend keeps working (regression via existing F4 E2E).
- **F5-3** mode-legend.ts builder + legendAnchor table + tests.
- **F5-4** settings `legendHiddenModes`; × paint (export-gated) + hit-test +
  per-mode hide; wire view.draw to buildModeLegend.
- **F5-5** live E2E across 11 modes: legend present + correct kind; × hides only
  current mode; export contains legend but not ×; anchor clears fixed bands.

## Testing

- Pure unit tests per module (model, adapter, each mode's spec, anchor table).
- Settings parity: `legendHiddenModes` in DEFAULT_SETTINGS + MiniSettings (R5').
- Live E2E (CDP) — the only way to confirm no overlap + the × hit-region + export
  exclusion on real Obsidian.

## Out of scope / latent

- Legend pagination beyond "+N more".
- Honoring `scale.reverse` for categorical (separate known gap).
