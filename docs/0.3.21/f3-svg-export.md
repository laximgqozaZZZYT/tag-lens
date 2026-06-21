# F3 — SVG (vector) export + clipboard verification

PNG export (raster) and clipboard-copy were already shipped. F3 adds a **vector
(SVG) export** and **verifies the existing PNG clipboard copy actually works** on
real Obsidian.

## STATUS — F3 COMPLETE (2026-06-17)
- **Clipboard verify (pre-req)** — live CDP E2E confirmed PNG clipboard copy works:
  `ClipboardItem` + `navigator.clipboard.write` present in the Electron renderer,
  a valid 312 KB PNG (correct magic bytes) is built and `write` is called exactly
  once, real path emits "view copied to clipboard." No vault pollution.
  Harness: `test/e2e/e2e-clipboard.mjs` (commit aa08853).
- **F3-1** (78032c4) `src/visual/svg-recorder.ts`: pure Canvas2D→SVG recorder
  implementing the exact 2D-context subset src/draw/* uses (35 members; no
  drawImage/gradient/ImageData — figures are pure vector + text). CTM baking
  (setTransform is absolute), clip via wrapping `<g clip-path>` synced to
  save/restore, dash/alpha/arc/rotated-text. measureText delegated to an injected
  measurer. + `test/svg-recorder.test.ts`.
- **F3-2** (ca7294e) `svgFileName(mode,date)` (shared slug/stamp with exportFileName,
  `.svg` extension so SVG and PNG never collide) + tests.
- **F3-3** (9d56347) `saveSvgToVault` (text via vault.create) + `copySvgToClipboard`
  (rich `image/svg+xml` + `text/plain` ClipboardItem → writeText → vault, staged
  fallback) in `src/panel/export-image.ts`.
- **F3-4** (b9e46bf) `view.exportSvg({fit,target})` + toolbar menu items
  ("Copy view as SVG" / "Save view as SVG" / "Save whole figure as SVG"). Same
  ctx-swap strategy as exportImage(): swap `this.ctx` for the recorder, replay
  `draw()`, read `toSvg()`, restore. A real offscreen canvas backs measureText and
  stands in for `this.canvas`.
- **F3-5** (94036f0) live CDP E2E `test/e2e/e2e-svg-export.mjs`: all 11 modes emit
  well-formed SVG (DOMParser, no parsererror), viewBox matches canvas, >0 elements,
  no recorder method gaps; clipboard (rich + text fallback) and vault paths work;
  live draw restored; vault left clean.

All commits verify-green. No conflict with PNG export (separate file ext / I/O /
menu items, shared only the draw() pipeline and the ctx-swap pattern).

## Design
- **Reuse draw(), don't fork it.** The whole figure-drawing pipeline (11 modes)
  stays Canvas2D; SVG is produced by recording the same calls. One recorder, zero
  per-mode duplication.
- canvas `setTransform` is absolute → recorder keeps its own CTM and bakes
  coordinates to absolute user space. `clip()` opens a `<g clip-path>` closed when
  `restore()` unwinds past the enclosing `save()` (clips in absolute space, so
  rotated labels inside a clipped pane clip correctly).
- Stroke widths / dashes scale by the uniform CTM factor; text is emitted with its
  own `transform` matrix so font-size stays in local units.

## Remaining backlog after F3
- F2 — first-class scatter mode (2D quantitative axes + zoom/pan).
- F4 — Encoding channel `shape` + on-canvas legend.
- N2 — registerView re-enable guard (low).
