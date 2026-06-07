# Theme-Aware Colors — Design Spec

**Date:** 2026-06-07
**Status:** Approved for planning
**Topic:** Obsidian の外観（ベースカラー）に Canvas 描画色を自動追従させる

## 1. Problem

tag-lens の DOM パネル（`styles.css`）は既に Obsidian の CSS 変数
（`--background-primary` 等）を使っておりテーマ追従済み。一方 **Canvas 描画コード
（`src/*.ts`）には約 225 箇所のハードコード色**が残り、しかも `#0f1116`（背景）/
`#e6edf3`（文字）/ `#2d6cdf`（アクセント）のように**ダークテーマ専用**の値である。

結果として:
- ライトテーマ／カスタムテーマ使用時、Canvas だけ暗いまま浮いて見える。
- ユーザーのベースカラーと Canvas のクローム（背景・文字・枠）が一致しない。
- タグ識別用のカテゴリ色（HSL ベース）がダーク前提の明度で、ライト背景では薄くて見えにくい。

Canvas 2D は CSS 変数を解釈しないため、`ctx.fillStyle = "var(--text-normal)"` は機能しない。
実際の色値を `getComputedStyle` で一度解決して渡す必要がある。

## 2. Goals / Non-Goals

### Goals
- **システムのベースカラー（`--background-primary`）を全色のアンカーにする。** 解決した
  ベース背景色の相対輝度 `L_bg` を唯一の基準入力とし、クローム・識別色とも「ベースカラーから
  どれだけ離すか」で導出する。ライト／ダーク／グレー／セピア等あらゆるベースに連続追従する。
- **クローム色（背景・文字・枠・パネル・アクセント）を Obsidian テーマに完全追従**させる。
  対応する CSS 変数があればそれを使い、無ければベースカラーから輝度オフセットで導出。
- **識別色（タグ／クラスタのカテゴリ色）はどのベースカラーでも十分なコントラストで見える**よう、
  色相（hue）を保ったまま明度を `L_bg` から一定差を確保して算出する。
- **テーマ切替に即座に追従**する（`css-change` イベント → 再解決 → 再描画）。
- 設定トグルなしで「とにかく自動」で動く（YAGNI: 手動オーバーライド設定は作らない）。

### Non-Goals
- 識別色の色相そのものをテーマのアクセント系から生成し直すこと（識別性が落ちるため不採用）。
- DOM パネル `styles.css` 既存の CSS 変数化部分の作り直し（既に追従済み）。
- 新しい配色テーマ／カラーピッカー機能の追加。

## 3. Architecture

新規モジュール `src/theme.ts` に全色を集約する。

```
Obsidian CSS変数 ──getComputedStyle(viewRoot)──▶ resolveTheme(el): ThemeTokens (キャッシュ)
                                                        │
        ┌───────────────────────────────────────────────┤
        ▼ クローム色（固定トークン）                       ▼ 識別色（hue→色生成）
   canvasBg   ← --background-primary               swatch(hue, role, alpha?)
   canvasBgAlt← --background-secondary               └ isDark で L/S ランプ切替
   panelBg    ← --background-secondary                  （hue は不変）
   border     ← --background-modifier-border
   borderStrong← (border を輝度調整)
   textNormal ← --text-normal
   textMuted  ← --text-muted
   textFaint  ← --text-faint
   accent     ← --interactive-accent
   accentText ← --text-on-accent
   hover      ← --background-modifier-hover
   danger     ← --color-red
   warn       ← --color-yellow / --color-orange
   success    ← --color-green
   baseLum    ← relativeLuminance(--background-primary)   ★ 全導出のアンカー
   isDark     ← baseLum < 0.5
```

### 3.1 `ThemeTokens` インターフェース

```ts
export interface ThemeTokens {
  isDark: boolean;     // L_bg < 0.5 の便宜フラグ（境界処理用）
  baseLum: number;     // ★ アンカー: --background-primary の相対輝度 0..1
  // chrome（解決済みの実色文字列: "rgb(...)" / "#..."）
  canvasBg: string;
  canvasBgAlt: string;
  panelBg: string;
  border: string;
  borderStrong: string;
  textNormal: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentText: string;
  hover: string;
  danger: string;
  warn: string;
  success: string;
  // 識別色生成: hue(0-360) と役割から HSL 文字列を返す
  swatch(hue: number, role: SwatchRole, alpha?: number): string;
}

export type SwatchRole =
  | 'fill'        // 通常の塗り
  | 'fillStrong'  // 強調塗り（ホバー・選択）
  | 'stroke'      // 輪郭・エッジ
  | 'dim'         // 非アクティブ・薄い塗り
  | 'label'       // 図形上のラベル文字
  | 'tint';       // 領域背景（最も淡い）
```

### 3.2 `resolveTheme(el)`

- `getComputedStyle(el)` でビューのルート要素から Obsidian 変数を読む。
- **まず `--background-primary` を相対輝度 `baseLum` に変換**（全導出のアンカー）。
- クローム各トークン → 対応 CSS 変数を解決。変数が空／無い場合は `baseLum` から
  輝度オフセットで導出（最終フォールバックとして現行ハードコード値）。
- `swatch` は `baseLum` を取り込んだクロージャとして生成。
- 解決結果はビュー側でキャッシュし、`css-change` 時のみ再解決。

### 3.3 `swatch(hue, role, alpha)` — ベースカラーから連続導出

二値の固定テーブルではなく、**ベース背景の輝度 `L_bg`（= `baseLum`）を基準にした
相対オフセット**で各役割の明度を決める。これにより、純黒・純白だけでなく
グレー／セピア等の中間的なベースカラーにも連続的に追従する。

役割ごとに「ベースからの明度方向（コントラスト方向）」と「目標コントラスト差」を定義:

| role        | 明度方向            | 目標 L（概念式） | 意図 |
|-------------|---------------------|------------------|------|
| fill        | ベースと反対方向     | `L_bg + dir*0.42` | ベースから十分離し図形を浮かせる |
| fillStrong  | ベースと反対・最大   | `L_bg + dir*0.55` | 選択／ホバー強調 |
| stroke      | ベースと反対方向     | `L_bg + dir*0.48` | 輪郭をベースに対し明瞭に |
| dim         | ベース寄り           | `L_bg + dir*0.18` | 非アクティブ。ベースに近づけ後退 |
| label       | ベースと反対・高     | `L_bg + dir*0.55` | 図形上文字。ベースの逆へ |
| tint        | ベース寄り・極小     | `L_bg + dir*0.06` | 領域背景。ベースとほぼ同調 |

- `dir = L_bg < 0.5 ? +1 : -1`（暗いベース→明るく、明るいベース→暗く離す）。
- 目標 L は `clamp(0.04..0.96)`。彩度 `s` は役割ごとの基準値（fill/stroke≈0.6、dim/tint≈0.25）を
  そのまま使用（色相識別性のため彩度はベースに依存させない）。
- HSL の L は %（`L*100`）で出力。係数（0.42 等）は実装時に両端＋中間ベースで視認性検証して微調整。

→ 概念実装:
```ts
swatch(hue, role, alpha) {
  const dir = baseLum < 0.5 ? 1 : -1;
  const { off, s } = ROLE[role];               // 役割の係数
  const L = clamp(baseLum + dir * off, 0.04, 0.96) * 100;
  return alpha == null
    ? `hsl(${hue}, ${s*100}%, ${L}%)`
    : `hsla(${hue}, ${s*100}%, ${L}%, ${alpha})`;
}
```

クローム色も同方針: 対応 CSS 変数があれば優先。`border`/`borderStrong`/`canvasBgAlt` など
変数が無い／薄い場合は `--background-primary` の輝度に固定オフセットを足し引きして導出し、
ベースカラーを基調に統一する。

## 4. 修正対象と手法（2 系統）

| 系統 | 現状 | 置換先 |
|------|------|--------|
| Canvas クローム | `ctx.fillStyle = "#0f1116"` 等 | `theme.canvasBg` 等のトークン |
| Canvas 識別色 | `hsla(${hue}, 65%, 55%, a)` 等 | `theme.swatch(hue, 'fill', a)` 等 |
| DOM クローム | `el.setCssStyles({ color: "#e6edf3" })` 等 | `var(--text-normal)` 等の CSS 変数を直接記述 |

DOM 側は CSS 変数が効くため `var(--...)` を直接書くのが最もクリーン（`theme.ts` 不要）。
Canvas 側のみ `theme.ts` の解決済みトークン／`swatch` を参照する。

### ファイル別の概算（識別色 hsla を含む）
- `src/view.ts`（69）— 大半は DOM setCssStyles（CSS 変数化）＋ Canvas クローム
- `src/draw-lattice.ts`（24）— 多くが識別色 hsla（swatch 化）
- `src/draw-helpers.ts`（19）, `src/draw-matrix.ts`（18）, `src/draw-heatmap.ts`（11）,
  `src/draw-droste.ts`（11）, `src/draw-upset.ts`（8）, `src/draw-enclosures.ts`（6）,
  `src/draw-edges.ts`（6）, `src/draw-card.ts`（6）

## 5. Data Flow / Reactivity

```
view onload
  └ this.theme = resolveTheme(this.containerEl)
  └ registerEvent(app.workspace.on("css-change", () => {
        this.theme = resolveTheme(this.containerEl);
        this.requestDraw();
    }))

draw()
  └ 各 draw-*.ts に this.theme を渡す（描画関数のシグネチャに theme: ThemeTokens を追加）
  └ ctx.fillStyle = theme.canvasBg / theme.swatch(hue, 'fill') ...
```

描画関数群は引数で `theme` を受け取る（グローバル状態を避け、テスト可能性を保つ）。

## 6. Error Handling / Fallback

- `getPropertyValue` が空 → 現行ダーク値を既定値に。テーマ取得失敗でも描画は破綻しない。
- `swatch` の未知 role → `fill` にフォールバック。
- 輝度計算は sRGB → 相対輝度の標準式。パース不能な色文字列は `isDark = true` 既定。

## 7. Testing

- `src/theme.ts` の純関数部分に `test/theme.test.ts` を追加（既存 `test/note-menu.test.ts` と同形式）:
  - `relativeLuminance` が代表色で妥当な値を返す。
  - `swatch` が暗ベース／明ベース／中間ベース（グレー）で、ベースと十分なコントラスト差を持つ
    L を生成する（`|L - baseLum*100| >= 役割の最小差`）。色相が入力 hue と一致する。
  - 変数欠落時のフォールバックが破綻しない。
- 視覚確認: ライト／ダーク／カスタム（グレー系）テーマでビューを開き、背景・文字・タグ識別色が
  ベースカラーに馴染む／十分見えることを目視（デプロイ先 vault でリロード）。
- `npm run build`（esbuild）と既存 lint がパスすること。

## 8. Build / Deploy 注意

ビルド成果物 `main.js` を手動で
`/home/ubuntu/obsidian-plugins/開発/.obsidian/plugins/tag-lens` にコピーして
Obsidian リロードが必要（このリポジトリの運用）。

## 9. 作業順序（実装計画の骨子）

1. `src/theme.ts` 新設（`ThemeTokens`, `resolveTheme`, `swatch`, 輝度判定 + テスト）。
2. `view.ts` に `theme` 解決・`css-change` 配線・`draw()` からの受け渡しを追加。
3. 描画ファイル単位で色置換（クローム→トークン、識別色→swatch、DOM→CSS 変数）。
   ファイル間は独立のため並列分担可能。
4. ビルド・lint・テスト・両テーマ目視確認。
```
