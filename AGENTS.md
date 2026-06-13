# AGENTS.md — Tag Lens

このリポジトリで作業する全エージェントは、まず**現行バージョンの権威ドキュメント**を読むこと。

➡ **`docs/0.3.12/AGENTS.md`**（落とし穴・検証ゲート・E2E/デプロイ手順）
➡ **`docs/0.3.12/basic-design.md`** / **`docs/0.3.12/detailed-design.md`**（設計）

旧資料は `docs/old/` に隔離済み（参照不要）。

## 最低限の鉄則（詳細は上記）
- 変更後は **`npm run verify`**（`tsc --noEmit && test && build`）を緑に。tsc が型の唯一のゲート。
- `src/layout.ts` の検索は **`grep -a`**（NULバイト混入で素の grep は無言で空を返す）。
- E2E は別プロファイル+専用ポートで本番 Obsidian を kill しない／後始末必須／「例外なし」でなく**反映**を検査。
- Visual Encoding は表示ノード集合を変えない（SQL/dvjs フィルタとは別レイヤー）。
