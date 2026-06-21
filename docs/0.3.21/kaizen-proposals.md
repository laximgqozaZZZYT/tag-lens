# Kaizen 改善提案書 — Tag Lens 0.3.18

作成日: 2026-06-15 / 対象コミット: `a9a66d8` (P0-4 Visual Encoding 拡張後)
手法: 現地現物（Genchi Genbutsu）でコード・メトリクスを観察 → なぜなぜ分析 → 改善案策定

---

## 0. 現状把握（観測メトリクス）

| 指標 | 値 | 備考 |
|---|---|---|
| `src/` 総行数 | 22,153 行 | 30 ファイル超 |
| 最大ファイル `src/view.ts` | **5,172 行 / 関数 666** | god-file。次点 layout.ts は 1,379 行 |
| 正式テスト `test/*.test.ts` | 25 | `run.mjs` が `test/index.ts` 経由で実行 |
| スクラッチ `test/*.mjs` | **47** | CI 非対象。実験/E2E/デバッグの残骸が混在 |
| バージョン | 0.3.18 | `package.json` / `manifest.json` 一致 |
| `.gitignore` docs 例外 | `!docs/0.3.12/` のみ | 現行 0.3.18 等は**追跡外** |

VIEWMODE は 11 種（droste / euler×3 / bipartite / matrix / bubblesets / heatmap / lattice / upset / stream）。
Visual Encoding エンジン（registry パターン: FieldSource × VisualChannel）と axis-layout（カスタム x/y 軸）が直近で着地。

---

## 改善案（リファクタリング含む）

> Impact/Effort で優先度付け。小さく始められる順（小 → 大）に記載。

### 改善案 R1 ★最優先・小工数 — `insight/actions.ts` のパスインジェクション修正
**現状の課題**
`applyGolderClassification()` は `tag` を検証せず `app.vault.create(\`${tag}.md\`, "")` および
`getFirstLinkpathDest(tag, "")` に渡す（`src/insight/actions.ts:8-11`）。
`tag` に `../`・絶対パス・`/`・NUL/制御文字が含まれると Vault 外や意図しない階層にファイル生成され得る under-validated sink。

**なぜなぜ分析**
1. なぜ未検証か → tag は metadataCache 由来で「安全な前提」だった
2. なぜ前提が崩れるか → Insight/Suggest は将来ユーザー入力・補完値も流し込む設計
3. なぜ危険か → `vault.create` はパス文字列をそのまま解決する file-path sink
4. なぜ気付けなかったか → 型は `string` のみで「タグ文法」を表現する型が無い
5. 真因 → **タグ文字列に対するバリデーション層（正規化関数）が存在しない**

**改善案**
- `src/insight/tag-path.ts`（新規・純粋関数）に `isValidTagName(tag): boolean` を切り出す。
  Obsidian のネストタグ文法に合わせ `^[\w\-]+(\/[\w\-]+)*$` を許可、`..`・先頭ドット・パス区切り・NUL/制御文字を拒否。
- `applyGolderClassification` 冒頭で不正なら `new Notice("Invalid tag name")` し早期 return。`normalizePath` も併用。
- `test/tag-path.test.ts` で正常系/`../`/絶対パス/空/NUL を網羅。

**期待効果**: セキュリティリスク除去 + 純粋関数化でテスト可能に。**工数: 小（〜30分）**

---

### 改善案 R2 ★小工数 — `.gitignore` の docs バージョン例外を恒久化
**現状の課題**
`.gitignore:14` が `!docs/0.3.12/` のハードコード。バージョンが上がるたび追記が必要で、
**現行 0.3.18 / 0.3.17 / 0.3.14 の設計書は git 追跡外**。本提案書すら放置すれば commit されない。

**根本原因**: 「バージョン固定の許可リスト」という仕組みが、リリース頻度の増加（ムラ）に追従できていない。

**改善案**
- `docs/*` 除外は維持しつつ、`!docs/[0-9]*.[0-9]*.[0-9]*/` のようなパターン例外に変更し全バージョン docs を追跡。
  （絶対パスを含むローカルメモは `docs/old/` や別名で除外を維持）
- もしくは設計書を `docs/specs/{ver}/` に集約し `!docs/specs/` 一本に統一。

**期待効果**: リリースごとの手作業（Muda）排除、設計書の履歴欠落防止。**工数: 小（〜10分）**

---

### 改善案 R3 ★中工数 — `test/` ディレクトリの 5S（整理・整頓）
**現状の課題**
`test/` に正式テスト 25 に対しスクラッチ `.mjs` が **47**（`e2e-*`・`repro-*`・`preview*`・`render-*`・`test-*` 等）。
`run.mjs` は拾わないため CI 上は死蔵だが、ファイル探索・grep・新規参入者の認知負荷を増やす典型的 Muda。

**なぜなぜ分析**
1. なぜ混在か → デバッグのたびに `test/` 直下へ使い捨て script を作った
2. なぜ消されないか → 「また使うかも」（在庫の死蔵）
3. 真因 → **「正式テスト」と「実験 script」を分離する置き場ルールが無い**

**改善案**
- `test/e2e/`（CDP E2E ハーネス、再利用価値あり）と `test/scratch/`（使い捨て）に分離。
- `test/scratch/` は `.gitignore` 化 or 定期削除。`test/e2e/` は README で「別プロファイル + 専用ポート」手順を集約。
- `docs/0.3.18/AGENTS.md` に「デバッグ script は `test/scratch/` に置く」を標準として明記。

**期待効果**: ルートの探索性向上、CI 対象の明確化、E2E 資産の再利用性向上。**工数: 中（〜1h、mv 中心）**

---

### 改善案 R4 ★大工数 — `src/view.ts`（5,172 行）の段階的分割
**現状の課題**
単一 ItemView が 5,172 行・関数約 666 個。描画ディスパッチ・設定 UI（各タブ）・rebuild パイプライン・
イベント処理・pan/zoom が同居する god-file。変更の影響範囲が読めず、回帰の温床（過去に複数の latent bug）。

**根本原因**: Canvas 2D 単一 View に「状態・描画・UI・入力」が凝集し、関心の分離（SoC）境界が無い。

**改善案（既存 `refactor-view-split.md` を継承し、安全な縦切りで）**
1. **設定 UI を分離**: `renderSettings*`（Display/Encode/Query タブ）を `src/settings-ui/` のビルダー関数群へ。view は呼ぶだけ。
2. **描画ディスパッチを分離**: モード別 `draw-*` 呼び出しテーブルを `src/draw-dispatch.ts` に集約（11 モードの switch を表駆動に）。
3. **入力（pan/zoom/hit-test）を分離**: `src/view-interaction.ts` へ。
- 各ステップ = `npm run verify` 緑 = 1 コミット。**未束縛時の従来パスを壊さない**（回帰ゼロが必須条件）。

**期待効果**: 1 ファイル 5,172 → 目標 2,500 行以下、関心ごとの局所変更、レビュー容易化。**工数: 大（複数 PR）**

---

### 改善案 R5 ★中工数 — Visual Encoding / axis-layout の重複ロジック統合
**現状の課題**
`encoding/scales.ts`（prepareScale: quantitative→t / categorical→index）と `axis-layout.ts`（帯/ティック割当）が
スケール正規化を各々持つ懸念。両者は同じ「値 → 正規化座標」変換の別用途版。

**改善案**: スケール正規化のコアを `encoding/scales.ts` に一本化し、axis-layout は座標展開（帯境界の算出）だけを担う。
`resolveFieldSource` / `prepareScale` の再利用を徹底し、DRY 化。テストは既存 `encoding-scales` / `axis-layout` を維持。

**期待効果**: スケール仕様変更（log/quantile 追加等）が 1 箇所で済む。**工数: 中**

---

## 将来機能の提案

> 獲得（新規インストール）がゴール。「他プラグインに無い体験」を軸に選定。

### 機能 F1 ★獲得効果大 — Encoding / Lens プリセットの共有（import/export）
**背景**: Visual Encoding は強力だが設定コストが高い。「映える設定」を 1 クリックで配布・適用できれば SNS 拡散の起点になる。
- `settings.encoding` + lens 設定を JSON でエクスポート / クリップボード or `.json` インポート。
- バンドル済みプリセット（"Status heatmap" / "Degree scatter" / "Maturity gallery"）を同梱。
- **設計境界厳守**: プリセットは視覚エンコーディングのみを運ぶ（選択層 = query/dvjs は別）。
**効果**: 学習曲線の平坦化 + 口コミ拡散。スクリーンショット 1 枚 → 設定 JSON が広がる。

### 機能 F2 ★差別化 — 軸連携の本格散布図モード（2D quantitative + ズーム/パン）
**背景**: axis-layout で x/y 任意属性束縛は実現済み。これを「x=links, y=ageDays」等の連続 2 軸散布として
ズーム/パン・軸ラベル回転・四象限ガイドまで磨けば、Dataview にも Graph view にも無い分析体験になる。
- 量的×量的時は等間隔ティック + ログ軸切替、ホバーで note プレビュー。
- 代表値 1 回配置（既存方針）を維持しつつ、密集セルのジッタ表示オプション。
**効果**: 「タグ × メタデータの相関を見る」唯一無二のユースケースを獲得。

### 機能 F3 ★獲得効果中 — SVG / コピー対応エクスポート
**背景**: F1（PNG）は実装済み。ベクター SVG とクリップボード直コピーを足すと、ブログ/論文/Obsidian Publish への
貼り付け摩擦が消える。共有されるほど露出が増える（獲得ゴール直結）。
- Canvas シーングラフ → SVG シリアライズ（罫線・ラベル・ノードを `<rect>/<text>` へ）。
- 「Copy as PNG」でクリップボード API 直送。
**効果**: 成果物の二次配布が容易化し、自然流入を増やす。

### 機能 F4 ★将来 — Encoding チャネル拡張: shape / legend canvas 描画
**背景**: registry パターンなのでチャネル追加は低コスト。`shape`（maturity→○△□）と
**凡例のキャンバス内描画**（現状凡例データは出るが描画は未配線）を足すと、エクスポート画像が自己説明的になる。
- `encoding/channels.ts` に `shape` 登録、`NodeDrawParams.shape` を draw-* で消費。
- `LegendSpec` を右下に半透明オーバーレイ描画（categorical=色票、quantitative=グラデ帯）。
**効果**: 単体で意味が伝わる図 → F3 と相乗で共有価値が上がる。

---

## 優先度サマリ（Impact / Effort）

| ID | 区分 | Impact | Effort | 推奨着手 |
|---|---|---|---|---|
| R1 | セキュリティ修正 | 高 | 小 | **即時（次コミット）** |
| R2 | 仕組み（gitignore） | 中 | 小 | 即時 |
| R3 | test 5S | 中 | 中 | 近日 |
| F1 | プリセット共有 | 高（獲得） | 中 | 次マイルストーン |
| R5 | スケール統合 | 中 | 中 | R4 前に |
| F3 | SVG export | 中（獲得） | 中 | 次マイルストーン |
| R4 | view.ts 分割 | 高 | 大 | 段階実施（複数 PR） |
| F2 | 散布図モード | 高（差別化） | 大 | ロードマップ |
| F4 | shape/legend | 中 | 中 | F3 と併走 |

---

## 実行計画（最初の一歩）

1. **R1 を即実装**: `src/insight/tag-path.ts` + `isValidTagName` + `test/tag-path.test.ts` → `npm run verify` 緑 → コミット。
2. **R2 を同 PR で**: `.gitignore` をパターン例外化し、本提案書を含む `docs/0.3.18/` を追跡対象に。
3. 以降は R3 → F1 の順で 1 改善 = 1 verify 緑 = 1 コミットの PDCA を回す。

## 効果測定方法
- **R1**: `tag-path.test.ts` の異常系が全て reject されること（自動）。
- **R3**: `test/` ルート直下の `.mjs` 数 47 → 0（`ls test/*.mjs | wc -l`）。
- **R4**: `wc -l src/view.ts` を各 PR で記録（5,172 → 目標 ≤2,500）。
- **F1/F3**: リリース後の DL/インストール推移と、共有 JSON/画像の言及数を観測。
