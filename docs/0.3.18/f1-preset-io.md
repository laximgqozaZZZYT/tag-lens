# F1 — Encoding/Lens preset import/export + bundled presets

Accessible from a NEW **Data ▸ JSON** sub-tab (Data is an existing top-level tab
with sub-tabs Logic/Tree/Table; JSON is added as the 4th).

## Conflict analysis (vs existing features) — DONE
- **PNG export** (`view.ts openExportMenu` → `exportImage` → `saveBlobToVault`/
  `copyBlobToClipboard`, files `tag-lens-<mode>-<stamp>.png`): **no functional
  conflict** — different state (preset = settings.lensPresets vs PNG = stateless),
  different file type (.json vs .png), independent code paths. The ONLY overlap is
  the word "Export": keep "Export image (PNG)" on the toolbar and put preset
  Export/Import inside Data ▸ JSON — never merge preset I/O into openExportMenu.
- **Lens preset system ALREADY EXISTS** (`src/interaction/lens-presets.ts`:
  captureLens/applyLens/upsertPreset/removePreset/validatePresetName; stored in
  `settings.lensPresets: LensPreset[]`; UI `renderPresetSection`; each preset also
  registered as a command via syncLensCommands). It captures **query settings
  ONLY** (LensQuerySettings = filterMode/where/groupBy/having/limit/order/viewMode
  + *Auto). F1 must **EXTEND** this, not rebuild it.
- F3 note: clipboard-copy export is ALREADY shipped (copyBlobToClipboard); F3's
  real remainder is SVG only.

## Design decisions
- **One preset bundles query + encoding.** Add OPTIONAL `encoding?: EncodingBinding[]`
  to `LensPreset` (backward compatible: presets without it behave exactly as today).
  `applyLens` applies encoding only when `preset.encoding` is present, so old
  presets never wipe the current encoding.
- **Invariant preserved**: a preset's query part changes WHICH notes appear (that
  IS the lens/selection layer, intended); the encoding part is display-only. The
  "selection ⊥ encoding" invariant is about encoding never changing selection — still true.
- JSON format: `{ schema: "tag-lens/presets", version: 1, presets: LensPreset[] }`,
  pretty-printed. Parser is tolerant: validates each preset, collects errors,
  ignores unknown fields, never throws.

## Low-risk task decomposition (each = verify-green + 1 commit)
- **F1-1** Pure serialization core `src/interaction/preset-io.ts`:
  `serializePresets(presets)` / `parsePresets(json) → {presets, errors}`.
  + `test/preset-io.test.ts`. No UI, no settings mutation. LOWEST risk; foundation.
- **F1-2** Extend preset to carry encoding (additive): `encoding?` on `LensPreset`,
  new `capturePreset(settings, name)`, `applyLens` applies encoding when present.
  Existing lens-presets.test stays green; add encoding cases. No MiniSettings key
  change (settings-parity unaffected).
- **F1-3** Bundled presets `src/interaction/bundled-presets.ts`: `BUNDLED_PRESETS`
  (a few starter lenses) + `mergeBundled(existing)`. Pure data + test. NOT
  auto-injected into settings (no silent migration); offered via a button.
- **F1-4** Data ▸ JSON sub-tab scaffold: add `"json"` to DataSubTab, jsonTab div,
  wire showDSubTab, `renderDataJsonBody(host)` stub. Additive UI only.
- **F1-5** JSON tab Export UI: read-only textarea of serializePresets(lensPresets),
  "Copy to clipboard" + "Save .json to vault" (new `presetFileName` helper).
- **F1-6** JSON tab Import UI: paste textarea + Import (parsePresets → upsert →
  save → refresh + syncLensCommands), plus "Load bundled presets". Shows errors.

Order: F1-1 → F1-2 → F1-3 (pure cores) → F1-4 (UI shell) → F1-5 → F1-6.

## Guardrails
- `npm run verify` green per commit. Reuse lens-presets.ts/renderPresetSection
  patterns; don't fork a parallel preset system.
- parsePresets must never throw on bad input (collect errors, return partial).
- Preset export writes `.json` via a NEW filename helper — do NOT reuse
  exportFileName (it hardcodes `.png`).
