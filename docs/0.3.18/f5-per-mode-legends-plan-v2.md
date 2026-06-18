# F5 v2 — Per-mode legends: corrected plan (historical reference)

> Historical draft kept for traceability. The authoritative plan is now `docs/0.3.18/f5-per-mode-legends-plan.md`.

## Diagnosed real-app failures (from screenshots, panel + modal removed)

| VIEWMODE | anchor | shown | confirmed problem |
|---|---|---|---|
| droste | bottom-right | Color·Tag | hidden behind settings panel when open; colour ≠ droste's focus/pair/single scheme; hugs right edge |
| euler / euler-true / euler-venn | bottom-left | Color·Tag | overlays dense cards; "+N more" hides most tags |
| bipartite | bottom-left | Color·Tag | overlays graph; "+N more" |
| bubblesets | bottom-left | Color·Tag | overlays contours/cards; "+N more" |
| matrix | bottom-right | Dot·Tag | hidden behind panel; overlaps grid; right-edge |
| heatmap | bottom-right | Tag size + Co-occurrence ramps | hidden behind panel; touches bottom cells. KIND is correct/good. |
| lattice | bottom-right | Bar ∝ notes (size only) | hidden behind panel; **size numbers 1/1 (no count)**; no tag-colour key |
| upset | bottom-right | Dot + Bar ∝ set size | **overlaps footer dot-matrix**; hidden behind panel; size 1/1 |
| stream | bottom-right | Row·Tag + Circle ∝ notes | hidden behind panel; **"+99 more"**; size 1/1; touches time axis |

### Root causes
1. **The settings panel `.gim-panel` (`position:absolute; right:0; width:320px; z-index:100`) overlays the right 320px of the canvas.** All 6 bottom-RIGHT legends are painted behind it when the panel is open → "no legend" in the real app. (v1 E2E hid the panel, so it passed — the verification was divorced from reality.)
2. Size legends always read 1/1 — `PositionedNode` has no per-node count; `buildModeLegendInput` defaulted counts to 1.
3. Categorical legends truncate to 8 with "+N more" (stream has ~99 tags).
4. Legends overlay figure content (semi-transparent) — unavoidable in some modes; the FIX the user chose is **make it draggable** so they can move it off content.

## New requirement A — legend MUST faithfully correspond to the mode's actual rendering (HARD, per user)
User visual verdict: **not one mode's legend currently corresponds correctly to what the mode draws.** The legend for each mode must be derived from, and exactly match, that mode's REAL drawing code — colour scheme, scale, gradient DIRECTION, and labels — confirmed by eye against the rendered figure. Per mode (read the cited draw file and mirror it EXACTLY):
- **droste** (`draw-droste.ts`): show the actual scheme — focus=accent, 2-tag=amber, single-tag = per-tag `TAG_HUES` palette — NOT `clusterHue(memberships[0])`.
- **euler/euler-true/euler-venn/bubblesets** (`draw-enclosures.ts:56`): swatches = `clusterHue(groupKey)` at the SAME alpha (0.42) the enclosures use, labelled by cluster/tag; reflect the HAVING warn override when active.
- **bipartite** (`draw-card.ts`): swatch = `clusterHue(memberships[0])` tint exactly as the card fill.
- **matrix** (`draw-matrix.ts:150-153`): list the actual COLUMN tags with their exact dot colours `swatch(clusterHue(col.key),"fill")`.
- **heatmap** (`draw-heatmap.ts:122,139`): two ramps whose hue AND lightness DIRECTION match the cells — diagonal `hsl(42,85%,L)` L∝log(tag size), off-diagonal `hsl(210,72%,L)` L∝intensity; verify which end is light vs dark; label min/max with REAL values, not "small/large/low/high".
- **stream** (`draw-stream.ts:142`): row swatches = `hsl(clusterHue(tag),65%,55%)` for the actual rows; size key from the REAL radius formula `(cellSize/2)*(0.3+0.7*count/maxCount)` with real counts.
- **upset** (`draw-upset.ts`): dot colour = set hue as drawn; bar size key from real set sizes.
- **lattice** (`draw-lattice.ts`): match the CURRENT LOD (overview bar∝count / density grid / individual cards) — not a fixed "Bar ∝ notes" with 1/1.

Acceptance: for every mode, a screenshot (panel OPEN) shows the legend swatches/ramps visually matching the figure's colours and scales. This is the PRIMARY completion bar — green unit/E2E tests are necessary but NOT sufficient.

## New requirement B
**The legend panel is draggable** — the user can drag it anywhere on the canvas; the position persists per mode. This directly resolves overlap (1 & 4): the user moves the legend off the panel / off content.

## Design (extends v1 modules; no revert)

### Settings (`src/types.ts`, parity test)
- Add `legendPos: Partial<Record<ViewMode, { x: number; y: number }>>` default `{}` (per-mode custom TOP-LEFT origin in CSS px; absent ⇒ use the mode's default anchor). Keep `legendHiddenModes`.

### `drawLegend` (`src/draw/legend-layout.ts`)
- New optional param `origin?: {x:number;y:number}` (explicit top-left). When given, draw there (clamped on-screen); else compute from `anchor`+`margin` as today.
- Return `LegendRender { width; height; panelRect:{x;y;w;h}; closeRect:{x;y;w;h}|null }` — add `panelRect` (the whole panel, for drag hit-testing).

### view.ts wiring
- `legendCloseRect` + new `legendPanelRect` cached each draw.
- Draw at `this.settings.legendPos[mode] ?? anchorOrigin(legendAnchor(mode), box, cw,ch, margin)`. (Compute the anchor origin so a dragged position and an anchor are the same coordinate space.)
- **Drag**: in the pointer handlers (the `click` handler already exists; ADD `pointerdown`/`pointermove`/`pointerup` or use the existing pointer plumbing):
  - pointerdown inside `legendPanelRect` but NOT inside `closeRect` → start drag, record offset.
  - pointermove while dragging → set `legendPos[mode] = clamp(pointer - offset)`, `draw()`.
  - pointerup → `save()`.
  - Guard: dragging must NOT trigger node hit-tests / file open (set a `legendDragging` flag; the existing `click` handler already bails on `pointerMoved`).
- **Default anchors revised** so first-show is visible even with the panel open: AVOID the right 320px. New defaults: heatmap/matrix/lattice/stream/upset/droste → **bottom-left**? No — bottom-left overlaps card content in some. Use mode-aware defaults that clear BOTH the right panel and each mode's fixed bands:
  - matrix/heatmap: top-left is taken by meta badges; left label band exists → default **bottom-left just right of the label band** (origin x = labelBandWidth+8). Simplest robust default: **top-left under the meta badges** for grid modes, **bottom-left** for card modes. Final call during implementation, VALIDATED by screenshot per mode.
- Since draggable, the default only needs to be "visible, not catastrophic"; the user fine-tunes by dragging.

### Count fix (size legends)
- Extend `ModeLegendInput.counts` to be populated with REAL counts:
  - stream: per-cell note counts (from the stream layout data the view holds).
  - upset: per-column set sizes.
  - lattice: per-tier / per-node note counts.
  - If a mode has no meaningful count, OMIT the size spec rather than show 1/1.
- Implement by passing mode-specific min/max into `buildModeLegendInput` (read the actual laid/mode structures in view.ts).

### Overflow
- Raise categorical cap from 8 → 12 and keep "+N more"; acceptable since draggable + the user can read more. (No canvas scrolling.)

## Verification protocol (MANDATORY — both)
1. **E2E** (`test/e2e/e2e-f5-legends.mjs`, strengthened): legend present per mode; drag updates `legendPos[mode]` and the panel moves; × hides per-mode; export keeps legend, drops ×; **assert the default legend origin is NOT within the right-320px panel zone**.
2. **Screenshot, panel OPEN** (the real failure condition): a harness that leaves `.gim-panel` VISIBLE, captures all 11 modes, and I VISUALLY confirm each legend is readable and not hidden/clobbered. Do NOT claim done on green tests alone — confirm by eye, panel open.

## Tasks (inline, no subagents)
- **T1** settings `legendPos` + parity. 
- **T2** drawLegend `origin` param + `panelRect` return + tests.
- **T3** view: draw at legendPos||anchor; cache panelRect; revised default anchors.
- **T4** drag state machine (pointerdown/move/up) + per-mode persist; guard node hits.
- **T5** real counts for stream/upset/lattice size keys (or omit); cap 8→12.
- **T6** E2E (drag + per-mode + panel-zone default) + screenshot harness with panel OPEN; visual confirm all 11.
