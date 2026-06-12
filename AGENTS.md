# AGENTS.md — Tag Lens で作業するエージェント向けの必読メモ

このリポジトリで作業する全エージェント（人/AI）が**最初に読む**標準。過去に各エージェントが
繰り返し踏んだ落とし穴と検証ゲートを集約する（Kaizen による標準化）。

## 検証ゲート（必須）
- 変更後は必ず **`npm run verify`** を緑にする。これは `tsc --noEmit && test && build` を一括実行する。
- **`npm run build`（esbuild）と `npm test` は型を検査しない。** 型崩れは esbuild を素通りして
  無言で出荷される。**型の正しさのゲートは `tsc --noEmit` だけ**。`npm run typecheck` 単独でも可。
- 過去、約30件の tsc エラーが build/test を通過したまま放置された。`verify` 緑を**マージ条件**とする。

## ハマりどころ
1. **`src/layout.ts` は NULバイト（センチネル文字列）を含む。** 素の `grep` はこのファイルを
   バイナリ扱いして**無警告で空を返す**。→ `layout.ts` を検索するときは必ず **`grep -a`**。
2. **`src/view.ts` は ~6500行の god-file。** 行番号は頻繁にずれる。編集前に `grep -n` で
   アンカーを取り直すこと。
3. **Visual Encoding (`src/encoding/`) は SQL/DataviewJS のフィルタとは別レイヤー。**
   「どのノートを表示するか」は絶対に変えない（属性→視覚チャネルの写像のみ）。
   レビュー時は「表示ノード集合・件数が encoding で変わっていないか」を必ず確認。

## デプロイ（dev vault）
ビルド成果物を手動コピーして Obsidian をリロード：
```
cp main.js manifest.json styles.css "/home/ubuntu/obsidian-plugins/開発/.obsidian/plugins/tag-lens/"
```

## E2E（実機 Obsidian / CDP）
- 依存ゼロの CDP ドライバ（Node 22 の global WebSocket/fetch）。参考: `test/e2e-display.mjs`。
- **ユーザーの本番 Obsidian（`~/.config/obsidian`）を絶対に kill しない。** 必ず
  **専用プロファイル + 専用ポート**で別インスタンスを起動し、終了時はその profile のプロセス**のみ** kill する。
  例: `--user-data-dir=/tmp/obs-<name> --remote-debugging-port=92XX`、`obsidian.json` に dev vault を
  `open:true` で事前登録して直接開く。**テスト後の後始末（kill + /tmp 削除）を必ず行う**（プロセス漏れ実績あり）。
- **E2E は「例外が出ない」だけで合格としない。** 描画されないが例外も出ないバグ（例: `fillStyle=number`、
  レイアウトでのフィールド欠落）は no-exception 検査をすり抜ける。**実際の反映**（draw params / laid.nodes の
  値 / ピクセル）を検査すること。期待値を実装の鏡で書くと両者が同じ誤前提を共有して偽陽性になる点にも注意。

## 検証の心得
- レビュアー/grep/E2E の結果を鵜呑みにせず、コード実体で裏取りする（過去 2 回「正常動作」を誤判定）。
- 仕様変更は plan→承認→実装。複数エージェントで設計が分岐しないよう、本ファイルと
  `docs/design-*.md` を単一の参照とする。
