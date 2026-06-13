# 設計プラン — `src/view.ts`(6512行) の段階的分割

## 目的
`MiniGraphView`(`src/view.ts`, 元約6512行) が god-file 化。レビュー性・テスト性・複雑度を下げるため、
**挙動を完全保存したまま**、関心事ごとに別モジュールへ退避する。
※Tier 1〜2完了時点で設定UIおよびタブ群の分離に成功し（view.tsは5500行台へ減少）、安全な分割手法の有効性が確認されています。

## 制約と方針（重要）
- **TS に partial class は無い**。「クラスを複数ファイルに割る」のではなく、各メソッドを
  **`deps` を受け取る自由関数**に切り出し、view 側は薄い委譲にする。
- **この repo に実績パターンあり**：`src/panel-sections.ts` の `renderToggleSection` /
  `renderOrderBySection` が `{ settings, save, redraw }` 等の deps を受け取る自由関数として抽出済み。
  **同パターンを横展開**するのが最小リスク。
- **挙動完全保存リファクタ**。1モジュール抽出ごとに **`npm run verify`**(tsc&&test&&build) 緑 → コミット、
  の小さな PDCA を回す（途中で中断しても安全）。E2E(`test/e2e-display.mjs` 系)で反映回帰も確認。

## 現状クラスタ（行範囲・概算）
| クラスタ | おおよその範囲 | 概算行 | 結合度 |
|---|---|---|---|
| ✅ 設定UIセクション群（renderMinFont/NodeDisplay/OrderBy 等） | 抽出完了 | 完了 | 解決済 |
| ✅ 設定タブ群（Settings Tabs / FilterBody 等） | 抽出完了 | 完了 | 解決済 |
| Insight（computeCognitiveLoad / renderInsight* / computeTagSuggestions / 分類アクション） | 851–1568 | ~700 | 中 |
| 描画（draw / drawBodyTile / drawCard* / drawGlobalDisplayFallbacks） | 3180–4000付近 | ~750 | **高** |
| 入力/ヒット判定・rebuild配線・export・note menu | 各所 | 残り | 中〜高 |
> 行番号は今後ずれる。着手時に `grep -n` で取り直すこと（view.ts は god-file）。

## 段階プラン（安全→危険）
### ✅ Tier 1（完了済）設定UIセクション → `src/panel/settings-sections.ts`
- **ステータス**: 完了。12の設定UIコンポーネント抽出に成功し、`view.ts` 側は薄い委譲メソッドに置き換わりました。純粋関数化による設計健全化が実証されました。

### ✅ Tier 2（完了済）設定タブ → `src/panel/settings-tabs.ts`
- **ステータス**: 完了。`renderSettingsView/Filter/Sort/Display/Encode/Layers` および `renderFilterBody` を抽出し、`view.ts` 内の巨大なレンダリングブロックを解消しました。DIパターンがタブレベルでも機能することが証明されました。

### 🚧 Tier 3（次期ターゲット・中リスク）Insight → `src/insight/{compute.ts,render.ts}`
- `computeCognitiveLoad` / `computeTagSuggestions` は**ほぼ純粋**（nodes/settings を引数化）→ 単体テスト追加余地。
- `renderInsight*` と分類アクション（`applyGolderClassification`/`convertToNestedTag`）は
  `app`(ファイル操作) 等を deps で受ける自由関数化。

### Tier 4（保留・高リスク）描画 draw*
- `draw()` は `this.laid/zoom/panX/panY/ctx/canvas/encParams/activeStatusColors…` に密結合。
  引数化すると巨大 deps で可読性が逆に悪化しがち。
- 方針: `draw()` は**オーケストレータとして view に残し薄くする**。モード別の重い描画は
  既に `draw-card.ts`/`draw-matrix.ts`/`draw-heatmap.ts`/`draw-stream.ts`/`draw-lattice.ts`/
  `draw-upset.ts` 等へ分離済み。残る `drawBodyTile`/`drawCardGrid`/`drawClusterLabels` 等を
  必要なら同様に切り出す（最後・慎重に）。

## 効果見込み・測定
- 6512行 → 中核 view.ts ~3500行 + 各 <1000行モジュール（Tier1〜2 で既に約1000行退避済）。
- 測定: `wc -l src/view.ts` の推移、`npm run verify` 緑維持、レビュー単位の縮小。

## 進め方
- **1抽出 = 1コミット**（`refactor(view): extract <section> to panel/settings-sections (no behavior change)`）。
- 着手前に `AGENTS.md`（verify必須 / layout.ts は `grep -a` / E2Eは反映検査+後始末）を順守。
- 注: 本ファイルは `docs/*`（gitignore対象）。版管理したいなら `docs/superpowers/` 配下へ移動 or 明示追跡。
