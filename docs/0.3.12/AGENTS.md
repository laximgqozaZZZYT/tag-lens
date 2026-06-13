# AGENTS.md — Tag Lens v0.3.12（エージェント必読・権威版）

このリポジトリで作業する全エージェント（人/AI）が最初に読む標準。
過去に各エージェントが繰り返し踏んだ落とし穴・検証ゲート・主要ワークフローを集約する。
設計の全体像は同ディレクトリの **基本設計書.md** / **詳細設計書.md** を参照。

---

## 0. 検証ゲート（必須）
- 変更後は必ず **`npm run verify`**（= `tsc --noEmit && test && build`）を緑にする。
- **`npm run build`(esbuild) も `npm test` も型を検査しない。** 型崩れは esbuild を素通りして
  無言で出荷される。**型の唯一のゲートは `tsc --noEmit`**（`npm run typecheck` 単独でも可）。
- 過去、約30件の tsc エラーが build/test を通過したまま放置された。`verify` 緑を**マージ条件**とする。

## 1. ハマりどころ
1. **`src/layout.ts` は NULバイト（センチネル文字列）を含む。** 素の `grep` は無警告で空を返す
   → `layout.ts` を検索するときは必ず **`grep -a`**。
2. **`src/view.ts` は ~4800行の god-file。** 行番号は頻繁にずれる。編集前に `grep -n` でアンカー再取得。
   分割は `0.3.12/refactor-view-split.md` の手順（Tier1〜3完了, Tier4=描画は保留）。
3. **Visual Encoding (`src/encoding/`) は SQL/DataviewJS フィルタとは別レイヤー。**
   「どのノートを表示するか」を絶対に変えない（属性→視覚チャネルの写像のみ）。レビューで必ず
   「encoding で表示ノード集合・件数が変わっていないか」を確認。
4. **新しい設定フィールドは `MiniSettings` interface と `DEFAULT_SETTINGS` の両方**に追加（片方漏れが型崩れ要因）。
5. **レイアウトの属性伝播**：各 `nodes.push` は `mtime/fmStatus/fmMaturity/ageDays` を引き継ぐ
   （欠落すると status/freshness/maturity/encoding が無言で効かない）。
6. **モード別ガードと適用表の一致**：`draw()` の `!laid.upset`/`!laid.setNodeIds` ガードと
   `display-applicability.ts` を必ず整合させる。

## 2. デプロイ（dev vault）
```
cp main.js manifest.json styles.css "/home/ubuntu/obsidian-plugins/開発/.obsidian/plugins/tag-lens/"
```
コピー後 Obsidian をリロード。

## 3. E2E（実機 Obsidian / CDP）
- 依存ゼロの CDP ドライバ（Node 22 の global WebSocket/fetch）。参考 `test/e2e-display.mjs`。
- **ユーザーの本番 Obsidian（`~/.config/obsidian`）を絶対に kill しない。** 必ず
  **専用プロファイル + 専用ポート**で別インスタンスを起動し、終了時はその profile のプロセス**のみ** kill する
  （例: `--user-data-dir=/tmp/obs-<name> --remote-debugging-port=92XX`、obsidian.json に dev vault を
  `open:true` で事前登録）。**テスト後の後始末（kill + /tmp 削除）を必ず行う**（プロセス漏れ実績あり）。
- **「例外が出ない」だけで合格としない。** 描画されないが例外も出ないバグ（`fillStyle=number`、
  レイアウトのフィールド欠落）は no-exception 検査をすり抜ける。**実際の反映**（draw params / laid.nodes /
  ピクセル）を検査すること。期待値を実装の鏡で書くと偽陽性になる点にも注意。

## 4. 検証の心得
- レビュアー/grep/E2E の結果を鵜呑みにせず、コード実体で裏取り（過去2回「正常動作」を誤判定）。
- 仕様変更は plan→承認→実装。複数エージェントで設計が分岐しないよう、本ディレクトリの設計書を単一の参照とする。
- リファクタは**挙動完全保存・verify緑・1抽出1コミット**。

## 5. 参照
- 設計: `docs/0.3.12/基本設計書.md`, `docs/0.3.12/詳細設計書.md`
- 進行中: `docs/0.3.12/refactor-view-split.md`（view.ts 分割）
- 旧資料（参照不要・混乱回避のため隔離）: `docs/old/`
