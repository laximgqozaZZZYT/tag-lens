# `.base` フィルタ文法の網羅サポート — Implementation Plan

> **For agentic workers:** REQUIRED — keep `src/bases/parser.ts` (`parseBaseStructure`,
> `parseBaseFilter`, `parseCond`) and `src/bases/resolve.ts` PURE (no `obsidian` import),
> and **never throw** on unknown/broken grammar — fall back to `{ raw: "..." }` and treat
> it as ignored/false at eval time. Run `npm test` + `npm run verify` after every step.

**Goal:** `.base` ファイルのカスタムパーサー (`src/bases/parser.ts`) と評価エンジン
(`src/bases/resolve.ts`) を拡張し、Bases / Dataview がサポートする文法 — とくに**複数引数を
取るメソッド** (`containsAny`/`containsAll`/`containsNone`)・`startsWith`/`endsWith`・配列
リテラル — を正しく解釈・評価する。

## 背景（検証済みの実バグ）

`file.tags.containsAny("書籍", "小説")` のような条件でマッチ0件（グラフが空）になる:

1. **引数処理の欠陥:** `parseCond` の `unquote` (`src/bases/parser.ts:174`) が引数列
   `"書籍", "小説"` の**最初と最後のクォートだけ**を外し、引数を破壊する。
2. **未実装オペレーター:** `evalCond` (`src/bases/resolve.ts:49`、`rhs?: string` 単一値前提)
   が `contains` 系の複数引数を認識せず、`compare()` に落ちて強制 `false`。

## Tasks（1イテレーション1タスク、各々 `npm run verify` 緑でコミット）

- [ ] **T1 — `BaseCond` を多値対応に。** `src/bases/types.ts` の `BaseCond.rhs` を
      単一 `string` だけでなく `string[]` も許容（または `args?: string[]` を追加）。
      既存の単一値経路は後方互換を保つ。
- [ ] **T2 — メソッドフォームの複数引数パース。** `parseCond` で `<lhs>.<op>(<args>)` の
      `<args>` を**クォート内カンマを尊重して**分割し、各引数に `unquote` を適用して
      `string[]` 化。壊れた入力は従来どおり `null`/`{raw}` フォールバック（throw 厳禁）。
      `test/bases-parser.test.ts` に `containsAny("A","B")`・クォート内カンマ・空引数の
      ケースを追加。
- [ ] **T3 — `evalCond` にオペレーター追加。** `containsAny`(いずれか含む)・
      `containsAll`(すべて含む)・`containsNone`(どれも含まない)・`startsWith`/`endsWith`。
      `rhs` が配列で来た場合の `==`/`IN` 比較も論理破綻しないよう `compare()` を調整。
      `test/bases-resolve.test.ts` に各オペレーターの真偽ケース＋**未知オペレーターは
      throw せず false** のフォールバックケースを追加。
- [ ] **T4 — 仕上げ。** 既存 `.base` E2E/スモークがあれば通し、`npm run verify` 緑を確認。
      実 `.base`（`containsAny` 使用）でグラフが空にならないことを E2E かスモークで担保。

## 制約

- `parser.ts` / `resolve.ts` は `obsidian` 非依存のまま（Node ユニットテスト維持）。
- 未知文法・壊れた YAML でも**絶対に throw しない**。解釈不能は `{ raw }` 保持→eval で安全に無視/false。
- 既存テスト（bases-parser/resolve/relations/project/fallback）を壊さない。
