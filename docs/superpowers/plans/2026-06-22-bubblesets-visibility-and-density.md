# BubbleSets 可視性・密集対応 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bubblesets モードで (1) 小さく具体的な交差リージョンが巨大な親集合の塗りに埋もれて見えなくなる問題、(2) 高密度時にラベルが重なって判読不能になる問題、を解消する。(3) 多数の部分重複タグが密集する際の「オイラー図的分離」不足は調査の結果、軽微なパッチでは解決できない構造的な制約であることが判明したため、安全に実施できる範囲の緩和策のみをTask 3として実施し、残る限界を明記する。

**Architecture:** Task 1 は `layoutEulerTrue`(`src/layout/layout.ts`)の次数カスケード sub-piece の「ホストクラスタ選択」を、既存の cross-cluster overlap-stripe 機構が使っている「面積が小さい方を選ぶ」規則に統一する(現状はアルファベット順選択で、これが描画z-order前提と矛盾していた)。Task 2 は `drawOverviewLabels`(`src/draw/draw-helpers.ts`)の巨大ウォーターマーク文字の衝突判定が、`drawClusterLabels` の小さいラベルチップ(`labelCells`)を一切考慮していないことが原因と確認したため、衝突判定を純粋関数として切り出し、両方の既存配置を「占有済み」として渡す。Task 3 は `siblingOverlapPack`(`src/layout/sibling-overlap-pack.ts`)の緩和更新を逐次(Gauss-Seidel式)から同時(Jacobi式)に変更する — 実測で多少の改善が確認できたが、1つの矩形が多数の独立した相手と同時に十分な重なりを持つことは矩形同士の幾何的制約上不可能なケースが多く、これは完全な解決ではない。

**Tech Stack:** TypeScript, 既存の自前テストランナー(`test/*.test.ts` + `test/assert.ts`, `npm test` で実行)。

## Global Constraints

- 既存テストを一切壊さない。本計画着手前のベースラインは `npm test` で **1566 assertions passed, 0 failures**(コミット `e872918` 時点)。
- `npx tsc --noEmit` がクリーンであること。
- 既存の関数シグネチャ(`siblingOverlapPack`, `drawOverviewLabels` の公開シグネチャ)は変更しない — 内部実装のみ変更する(呼び出し元である `view.ts` を変更しない)。
- 各タスク完了後に必ず `npm test` と `npx tsc --noEmit` を実行し、結果をコミットメッセージ相当の記録に残す。

---

### Task 1: 次数カスケード sub-piece のホストクラスタ選択を「最小面積」基準に変更

**背景(検証済み事実):** `src/draw/draw-enclosures.ts:46` は `clusters` を面積降順(`b.width*b.height - a.width*a.height`)にソートし、その順で `main` ピースを塗る。これにより**面積が小さいクラスタほど後で(=手前に)描画される**。一方 `layout.ts` には2種類の sub-piece 付与ロジックがあり、cross-cluster overlap-stripe(`layout.ts:1251-1254`相当、2クラスタの矩形が視覚的に重なった場合の縞)は既に「面積が小さい方の `pieces` にホストする」(`host = ca.width*ca.height <= cb.width*cb.height ? ca : cb`)という、上記z-orderと整合する規則を使っている。しかし**次数カスケードで実際にノードを収容する sub-piece**(Task群で実装した `regionGroups` の押し込み、`src/layout/layout.ts:1342-1352`)は次の通り**アルファベット順**でホストを選んでいる:

```ts
const hostTag = [...g.tags].sort()[0];
const hostCluster = clusters.find((c) => c.groupKey === hostTag);
```

タグ名の辞書順は面積と無関係なため、具体的で小さい交差(例: `purgatorio`, `inferno`)の sub-piece が、たまたまアルファベット順で先になる大きいクラスタ(例: `battle`)にホストされると、z-order的に**大きいクラスタの描画タイミングでしか描かれず**、後から描かれる(=より小さい)別クラスタの塗りに埋もれる。これが「小さい交差が見えない」不具合の確認済みの原因。

**Files:**
- Modify: `src/layout/layout.ts:1342`(`hostTag` の選択式)
- Test: `test/bubblesets-region-sizing.test.ts`(追記)

**Interfaces:**
- Consumes: 既存の `clusters: ClusterRect[]`(各要素 `groupKey`, `width`, `height` を持つ — 同ファイル内で既に定義済み)、既存の `regionGroups` 構造(変更なし)。
- Produces: 変更後も `hostCluster?.pieces?.push({...})` の呼び出し形は不変 — 後続タスクへの影響なし。

- [ ] **Step 1: 失敗するテストを書く**

`test/bubblesets-region-sizing.test.ts` の末尾に追記(同ファイル冒頭で既に `import { layout } from "../src/layout/layout";`, `import type { GraphData } from "../src/types";`, `makeNode` ヘルパーが定義されているので再利用する):

```ts
// Host selection for degree-cascade sub-pieces must pick the SMALLEST-area
// participating cluster, not the alphabetically-first tag — otherwise a
// small, specific intersection's content renders in the BIGGER cluster's
// pieces array and only gets painted when that bigger cluster's z-order
// slot comes up, burying it under whatever smaller-but-unrelated cluster
// happens to paint later (draw-enclosures.ts paints largest-area clusters
// first, smallest last/on top — see its line ~46 sort).
{
	const data: GraphData = {
		nodes: [
			...Array.from({ length: 30 }, (_, i) => makeNode(`big${i}`, ["AAA_big"])),
			...Array.from({ length: 4 }, (_, i) => makeNode(`shared${i}`, ["AAA_big", "zzz_small"])),
		],
		edges: [],
	};
	const sized = data.nodes.map((n) => ({ ...n, width: 80, height: 24 }));
	const out = layout(data, sized, {
		viewMode: "bubblesets",
		cellW: 80,
		cellH: 24,
		nodeSpacing: 1,
		minFontPx: 10,
	} as any);
	const big = out.clusters.find((c) => c.groupKey === "AAA_big")!;
	const small = out.clusters.find((c) => c.groupKey === "zzz_small")!;
	ok(
		small.width * small.height < big.width * big.height,
		`precondition failed: zzz_small must actually be the smaller cluster, got small=${small.width}x${small.height} big=${big.width}x${big.height}`,
	);
	const subInBig = (big.pieces ?? []).some((p) => p.kind === "sub" && p.hueKeys?.includes("zzz_small"));
	const subInSmall = (small.pieces ?? []).some((p) => p.kind === "sub" && p.hueKeys?.includes("AAA_big"));
	ok(
		!subInBig && subInSmall,
		`the intersection sub-piece must host on the smaller cluster (zzz_small), not the alphabetically-first one (AAA_big). subInBig=${subInBig} subInSmall=${subInSmall}`,
	);
}
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: 上記の新しい `ok(...)` 呼び出しが `subInBig=true` (アルファベット順で `AAA_big` が選ばれてしまうため) で FAIL する。

- [ ] **Step 3: 実装**

`src/layout/layout.ts:1342` を以下に変更:

```ts
const hostTag = [...g.tags].sort((a, b) => {
	const ca = clusters.find((c) => c.groupKey === a);
	const cb = clusters.find((c) => c.groupKey === b);
	const areaA = ca ? ca.width * ca.height : Infinity;
	const areaB = cb ? cb.width * cb.height : Infinity;
	if (areaA !== areaB) return areaA - areaB;
	return a < b ? -1 : 1; // deterministic tie-break when areas coincide
})[0];
```

(直後の `const hostCluster = clusters.find((c) => c.groupKey === hostTag);` 以降は変更不要。)

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npm test`
Expected: 全テストパス(新規ケース含む)。`npx tsc --noEmit` もクリーン。

- [ ] **Step 5: コミット**

```bash
git add src/layout/layout.ts test/bubblesets-region-sizing.test.ts
git commit -m "Host degree-cascade sub-pieces on the smallest-area cluster, not alphabetically-first"
```

---

### Task 2: 巨大ウォーターマーク文字の衝突判定にラベルチップを含める

**背景(検証済み事実):** `src/draw/draw-helpers.ts:393-480` の `drawOverviewLabels`(クラスタ名を箱いっぱいに表示する巨大文字 — `_all` の "all" など)は、衝突判定の `placed` 配列(`draw-helpers.ts:425`)に**他のクラスタの巨大文字の矩形のみ**を入れており、`drawClusterLabels` が描く小さいラベルチップ(`laid.labelCells`、各クラスタに1つ、`x,y` は中心座標)の位置は一切考慮していない。巨大文字はクラスタ自身の `width`/`height` に比例してフォントサイズを決めるため暴走的にはみ出さないが(`draw-helpers.ts:435-438` で `width*0.88`/`height*0.6` にクランプ)、**別クラスタの小さいラベルチップの真上に重なって描かれる**ことは現状の衝突判定では防げない。これがスクリーンショットで観測された「同じタグ名が2箇所に重複表示される」(チップと巨大文字が同じ場所で衝突する)不具合の確認済みの原因。

**Files:**
- Create: `src/draw/overview-label-placement.ts`(衝突判定を純粋関数として切り出し)
- Modify: `src/draw/draw-helpers.ts`(`drawOverviewLabels` がこの純粋関数を使うように変更)
- Test: `test/overview-label-placement.test.ts`(新規作成)

**Interfaces:**
- Produces (Task 2 が新規定義し、Task 2 内の Step 3 だけが使う — 後続タスクは依存しない):
  ```ts
  export interface OverviewLabelInput {
  	groupKey: string;
  	text: string;
  	x: number; y: number; width: number; height: number; // box top-left + size
  }
  export interface OverviewLabelPlacement {
  	groupKey: string;
  	text: string;
  	cx: number;
  	cy: number;
  	font: number; // px, at scale 1.0 (matches ctx.font = `800 ${font}px sans-serif`)
  }
  export interface MeasuredText { width: number; ascent: number; descent: number; }
  export function placeOverviewLabels(
  	clusters: OverviewLabelInput[],
  	measureAt100px: (text: string) => MeasuredText,
  	occupied?: Array<{ x1: number; y1: number; x2: number; y2: number }>,
  ): OverviewLabelPlacement[];
  ```

- [ ] **Step 1: 失敗するテストを書く**

`test/overview-label-placement.test.ts`(新規):

```ts
// placeOverviewLabels: pure (canvas-free) placement logic for drawOverviewLabels'
// giant per-cluster watermark text. Extracted so it can take the small label
// chips (laid.labelCells) as pre-occupied space — the bug being fixed: the
// giant text's own collision check previously only avoided OTHER giant
// texts, never the small chips, so a chip and a giant text could render on
// top of each other (same tag name appearing twice, illegible).
import { ok } from "./assert";
import { placeOverviewLabels, type OverviewLabelInput, type MeasuredText } from "../src/draw/overview-label-placement";

// Deterministic stand-in for ctx.measureText at a fixed 100px font.
const measure = (text: string): MeasuredText => ({ width: text.length * 60, ascent: 74, descent: 20 });

// Baseline regression: with NO occupied space, a single qualifying cluster
// still gets placed (refactor must not change existing no-collision behavior).
{
	const clusters: OverviewLabelInput[] = [
		{ groupKey: "drama", text: "drama (36)", x: 0, y: 0, width: 400, height: 300 },
	];
	const placements = placeOverviewLabels(clusters, measure, []);
	ok(placements.length === 1, `expected exactly one placement with no occupied space, got ${placements.length}`);
	ok(placements[0].font > 0, "font size must be positive");
}

// The bug being fixed: a small label chip sitting at the cluster's centred
// candidate position must make the giant text skip THAT candidate, not
// render on top of it. With every candidate position pre-occupied, the
// giant text must be skipped entirely (matching the existing "no clear
// spot -> skip" behavior already used for giant-text-vs-giant-text).
{
	const clusters: OverviewLabelInput[] = [
		{ groupKey: "purgatorio", text: "purgatorio (3)", x: 0, y: 0, width: 200, height: 200 },
	];
	// Cover the full box — every one of the 8 fixed candidate positions
	// (all within the box per drawOverviewLabels' own af/sc table) collides.
	const occupied = [{ x1: -1000, y1: -1000, x2: 1000, y2: 1000 }];
	const placements = placeOverviewLabels(clusters, measure, occupied);
	ok(
		placements.length === 0,
		`expected the giant label to be skipped when a chip occupies its entire box, got ${placements.length} placements`,
	);
}

// A chip occupying only the box's top half must still allow the giant text
// to land in the bottom half (collision avoidance, not blanket suppression).
{
	const clusters: OverviewLabelInput[] = [
		{ groupKey: "inferno", text: "inferno (3)", x: 0, y: 0, width: 300, height: 300 },
	];
	const occupied = [{ x1: -150, y1: -150, x2: 150, y2: 0 }]; // top half only
	const placements = placeOverviewLabels(clusters, measure, occupied);
	ok(placements.length === 1, `expected the giant label to still find a clear spot in the bottom half, got ${placements.length}`);
	ok(placements[0].cy > 0, `expected the chosen candidate to land below the box's vertical centre (away from the occupied top half), got cy=${placements[0].cy}`);
}
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: `Cannot find module '../src/draw/overview-label-placement'` のような import エラーで FAIL。

- [ ] **Step 3: 実装**

`src/draw/overview-label-placement.ts`(新規):

```ts
// Pure (canvas-free) placement logic for drawOverviewLabels' giant
// per-cluster watermark text. Extracted from draw-helpers.ts so the
// collision-avoidance search can be unit-tested without a CanvasRenderingContext2D,
// and so the caller can seed it with ALREADY-PLACED label chips
// (laid.labelCells, drawn by drawClusterLabels) as occupied space — the
// giant text's own greedy search previously only avoided OTHER giant
// texts, never the small chips, letting the same tag's name render twice
// in the same spot (illegible).
export interface OverviewLabelInput {
	groupKey: string;
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface OverviewLabelPlacement {
	groupKey: string;
	text: string;
	cx: number;
	cy: number;
	font: number;
}

export interface MeasuredText {
	width: number;
	ascent: number;
	descent: number;
}

interface Box {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

// Greedy, largest-cluster-first. Each label tries: centred full size, then
// progressively smaller, then nudged up/down — taking the first spot that
// doesn't collide with an already-placed label OR a pre-occupied box
// (typically the small label chips). Labels that can't find a clear spot
// are skipped (something else already covers that area).
const CANDIDATES: Array<[number, number]> = [
	[0.5, 1.0],
	[0.5, 0.72],
	[0.5, 0.52],
	[0.3, 0.52],
	[0.7, 0.52],
	[0.5, 0.38],
	[0.3, 0.38],
	[0.7, 0.38],
];

function intersects(a: Box, b: Box): boolean {
	return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

export function placeOverviewLabels(
	clusters: OverviewLabelInput[],
	measureAt100px: (text: string) => MeasuredText,
	occupied: Box[] = [],
): OverviewLabelPlacement[] {
	const ordered = [...clusters].sort((a, b) => b.width * b.height - a.width * a.height);
	const placed: Box[] = [...occupied];
	const result: OverviewLabelPlacement[] = [];
	for (const c of ordered) {
		if (!c.text) continue;
		const cx = c.x + c.width / 2;
		const m = measureAt100px(c.text);
		const w100 = m.width || 1;
		const h100 = (m.ascent || 74) + (m.descent || 20);
		const baseFont = Math.min((c.width * 0.88 * 100) / w100, (c.height * 0.6 * 100) / h100);
		if (!(baseFont > 0)) continue;
		let chosen: { font: number; cy: number } | null = null;
		for (const [af, sc] of CANDIDATES) {
			const font = baseFont * sc;
			const tw = (w100 / 100) * font;
			const th = font;
			const cy = c.y + c.height * af;
			const pad = font * 0.12;
			const box: Box = {
				x1: cx - tw / 2 - pad,
				y1: cy - th / 2 - pad,
				x2: cx + tw / 2 + pad,
				y2: cy + th / 2 + pad,
			};
			if (!placed.some((p) => intersects(box, p))) {
				chosen = { font, cy };
				placed.push(box);
				break;
			}
		}
		if (!chosen) continue;
		result.push({ groupKey: c.groupKey, text: c.text, cx, cy: chosen.cy, font: chosen.font });
	}
	return result;
}
```

`src/draw/draw-helpers.ts:393-480` の `drawOverviewLabels` 全体を以下に置き換える(import 文を同ファイル冒頭に追加すること):

```ts
import { placeOverviewLabels, type OverviewLabelInput, type MeasuredText } from "./overview-label-placement";
```

```ts
// Overview-only auxiliary labels: one BIG cluster name centred in each
// enclosure, fitted to the enclosure box. Drawn in world space on top of
// everything when the whole diagram is in view, independent of the
// Graph-display toggles and SEPARATE from `drawClusterLabels` (the small
// on-grid title bars). Not used in UpSet mode. Seeded with the small label
// chips (laid.labelCells) as already-occupied space so the giant text never
// renders on top of a chip showing the same (or a different) cluster's name.
export function drawOverviewLabels(
	ctx: CanvasRenderingContext2D,
	laid: LaidOut,
	zoom: number,
	warningClusters?: Map<string, number>,
): void {
	const inputs: OverviewLabelInput[] = laid.clusters
		.filter((c) => !c.ghostSingle && c.memberCount >= 2 && c.width > 0 && c.height > 0)
		.map((c) => ({
			groupKey: c.groupKey,
			text: warningClusters && warningClusters.has(c.groupKey) ? `⚠ ${c.label}` : c.label,
			x: c.x,
			y: c.y,
			width: c.width,
			height: c.height,
		}));
	const occupied = (laid.labelCells ?? []).map((lc) => ({
		x1: lc.x - lc.w / 2,
		y1: lc.y - lc.h / 2,
		x2: lc.x + lc.w / 2,
		y2: lc.y + lc.h / 2,
	}));
	ctx.font = "800 100px sans-serif";
	const measureAt100px = (text: string): MeasuredText => {
		const m = ctx.measureText(text);
		return {
			width: m.width || 1,
			ascent: m.actualBoundingBoxAscent || 74,
			descent: m.actualBoundingBoxDescent || 20,
		};
	};
	const placements = placeOverviewLabels(inputs, measureAt100px, occupied);
	for (const p of placements) {
		ctx.font = `800 ${p.font}px sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		const hue = clusterHue(p.groupKey);
		ctx.lineJoin = "round";
		ctx.lineWidth = Math.max(p.font * 0.08, 2 / zoom);
		ctx.strokeStyle = colorAlpha(theme().canvasBg, 0.9);
		ctx.strokeText(p.text, p.cx, p.cy);
		ctx.fillStyle = theme().swatch(hue, "fill", 0.96);
		ctx.fillText(p.text, p.cx, p.cy);
	}
	ctx.textAlign = "start";
	ctx.textBaseline = "alphabetic";
}
```

確認: `m.width`/`m.actualBoundingBoxAscent`/`m.actualBoundingBoxDescent` は元のコードと同じ `ctx.measureText` の戻り値プロパティ名であること(変更前のコードからそのまま転記しているため一致するはずだが、置き換え後に `src/draw/draw-helpers.ts` の元のコード(393-480行目)を grep で確認し、プロパティ名の打ち間違いがないことを目視確認すること)。

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npm test`
Expected: 全テストパス。`npx tsc --noEmit` もクリーン(`draw-helpers.ts` が `CanvasRenderingContext2D` 型を要求する既存のimport/型はそのまま残るので、型エラーが出る場合は既存の import 文を確認すること)。

- [ ] **Step 5: コミット**

```bash
git add src/draw/overview-label-placement.ts src/draw/draw-helpers.ts test/overview-label-placement.test.ts
git commit -m "Extract pure overview-label placement; seed it with label chips to fix duplicate-looking overlapping text"
```

---

### Task 3: siblingOverlapPack の緩和更新を逐次から同時更新に変更(部分的緩和 — 既知の限界あり)

**背景(検証済み事実 — 重要、過大な期待をしないこと):** 多数の部分重複タグ(例: 1つの "hub" タグが他の6つの "spoke" タグそれぞれと独立に50%のメンバーを共有し、spoke同士は無関係)を `siblingOverlapPack` に渡すスクリプトで実測したところ、現状の実装(逐次更新, Gauss-Seidel式: 各ペアの位置補正を即座に適用し、同じ反復内の次のペア計算がその補正後の位置を読む)では、6つの共有関係のうち**4つがちょうど重なり率0%**になり(本来共有関係があるのに視覚的に全く重ならない)、2つだけが目標(0.5)に近い値(0.336, 0.414)に到達する、という著しく不均一な結果になることを確認した。

これを「同時更新(Jacobi式: 反復内の全ペアの補正量を一旦 `deltaX`/`deltaY` に積算し、反復の最後に一括適用)」に変更したところ、結果は `[0, 0.058, 0.348, 0.348, 0.058, 0]`(合計達成度 0.787→0.812)とわずかに改善したが、**依然として6つのうち2つは重なり率0%のままで、根本的な不均一性は解消しない**。さらに「共有関係の数で目標重なり率を減衰させる」変更も試したが、改善せず悪化した(具体的な実験はこのコミットには含めない)。

これは1つの矩形が、互いに重ならない制約を持つ複数の独立した相手と同時に意味のある重なりを持つことが**矩形の幾何的制約上そもそも不可能なケースが多い**ためであり、軽微なアルゴリズム修正では解決しない構造的な限界である。**Task 3 はこの限界を解消するものではなく、安全に確認できた範囲の改善(逐次更新による順序依存性の除去)のみを実施する。** 多数タグが共有する密集シーンでの「オイラー図的分離」の本質的な改善には、円(曲線)ベースのbubble setコンタワー、または高次数ハブ周りの放射状シード配置といった、より大きな再設計が必要であり、これは本計画の対象外として別途設計タスクとすることを推奨する。

**Files:**
- Modify: `src/layout/sibling-overlap-pack.ts`(緩和ループを同時更新に変更)
- Test: `test/sibling-overlap-pack.test.ts`(追記)

**Interfaces:**
- Consumes: 既存の `SiblingOverlapOpts`(`sharedCount`, `sizeOf`)— 変更なし。
- Produces: 公開シグネチャ `siblingOverlapPack(boxes, gap, opts)` の入出力型は不変。

- [ ] **Step 1: 失敗するテストを書く**

`test/sibling-overlap-pack.test.ts` の末尾に追記(既存の `box`/`rectOf`/`overlapArea` ヘルパーを再利用):

```ts
// Many-neighbor hub scenario: a "hub" box shares members with 6 independent
// "spoke" boxes (spokes share nothing with each other). The relaxation
// cannot give every spoke a full target overlap (geometrically impossible
// for one rectangle vs. many mutually-separated rectangles at once), but
// switching from sequential to simultaneous per-iteration updates must not
// make total overlap satisfaction WORSE than the documented baseline —
// this locks in the verified (if partial) improvement and guards against a
// future regression back toward the more order-sensitive sequential form.
{
	const sizeOf = () => 10;
	const hub = box("hub", 100, 60);
	const spokes = Array.from({ length: 6 }, (_, i) => box(`s${i}`, 100, 60));
	const boxes = [hub, ...spokes];
	const sharedCount = (a: string, b: string) => (a === "hub" || b === "hub" ? 5 : 0);
	const r = siblingOverlapPack(boxes, 10, { sharedCount, sizeOf });
	const rHub = rectOf(r.positions[0], hub);
	let totalFrac = 0;
	for (let i = 0; i < 6; i++) {
		const rs = rectOf(r.positions[i + 1], spokes[i]);
		totalFrac += overlapArea(rHub, rs) / (100 * 60);
	}
	ok(
		totalFrac >= 0.8,
		`expected total hub-spoke overlap satisfaction >= 0.8 (documented baseline: simultaneous updates achieve ~0.81 vs. sequential's ~0.79), got ${totalFrac.toFixed(3)}`,
	);
}

// Plain 2-box pair (the common case) must behave the same as before:
// simultaneous vs. sequential updates are mathematically identical for a
// single pair (there is no second pair whose order could matter).
{
	const boxes = [box("a", 100, 60), box("b", 100, 60)];
	const r = siblingOverlapPack(boxes, 10, { sharedCount: () => 5, sizeOf: () => 10 });
	const ra = rectOf(r.positions[0], boxes[0]);
	const rb = rectOf(r.positions[1], boxes[1]);
	const ov = overlapArea(ra, rb);
	approx(ov / (100 * 60), 0.5, 0.05, "two-box pair overlap fraction unchanged by the simultaneous-update change");
}
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: 1つ目の新規ケースが、現状の逐次更新コードでは合計達成度が約0.787(< 0.8)のため FAIL する。

- [ ] **Step 3: 実装**

`src/layout/sibling-overlap-pack.ts` の緩和ループ(`for (let iter = 0; iter < ITERS; iter++) { for (let i ...) { for (let j ...) { ... pa.x += ...; pb.x -= ...; ... } } }` の全体)を、各反復内で位置補正を `deltaX`/`deltaY` に積算し、反復の最後に一括適用する形に変更する:

```ts
	for (let iter = 0; iter < ITERS; iter++) {
		const deltaX = new Array(boxes.length).fill(0);
		const deltaY = new Array(boxes.length).fill(0);
		for (let i = 0; i < boxes.length; i++) {
			for (let j = i + 1; j < boxes.length; j++) {
				const a = boxes[i];
				const b = boxes[j];
				const pa = pos[i];
				const pb = pos[j];
				const halfWSum = a.width / 2 + b.width / 2;
				const halfHSum = a.height / 2 + b.height / 2;
				const dx = pb.x - pa.x;
				const dy = pb.y - pa.y;
				const massA = massOf(a);
				const massB = massOf(b);
				const fracA = massB / (massA + massB); // heavier box moves less
				const fracB = massA / (massA + massB);
				const shared = opts.sharedCount(a.id, b.id);

				if (shared > 0) {
					const sizeA = Math.max(1, opts.sizeOf(a.id));
					const sizeB = Math.max(1, opts.sizeOf(b.id));
					const overlapFrac = Math.min(MAX_OVERLAP_FRAC, shared / Math.min(sizeA, sizeB));
					const targetX = halfWSum * (1 - overlapFrac);
					const targetY = halfHSum * (1 - overlapFrac);
					const curX = Math.abs(dx) || 0.0001;
					const curY = Math.abs(dy) || 0.0001;
					const errX = (curX - targetX) * ATTRACT_RATE;
					const errY = (curY - targetY) * ATTRACT_RATE;
					const signX = dx >= 0 ? 1 : -1;
					const signY = dy >= 0 ? 1 : -1;
					deltaX[i] += signX * errX * fracA;
					deltaX[j] -= signX * errX * fracB;
					deltaY[i] += signY * errY * fracA;
					deltaY[j] -= signY * errY * fracB;
				} else {
					const overlapX = halfWSum + gap - Math.abs(dx);
					const overlapY = halfHSum + gap - Math.abs(dy);
					if (overlapX <= 0 || overlapY <= 0) continue;
					if (overlapX < overlapY) {
						const sign = dx >= 0 ? 1 : -1;
						deltaX[i] -= sign * overlapX * fracA;
						deltaX[j] += sign * overlapX * fracB;
					} else {
						const sign = dy >= 0 ? 1 : -1;
						deltaY[i] -= sign * overlapY * fracA;
						deltaY[j] += sign * overlapY * fracB;
					}
				}
			}
		}
		for (let i = 0; i < boxes.length; i++) {
			pos[i].x += deltaX[i];
			pos[i].y += deltaY[i];
		}
	}
```

(ループの外側 — `const pos = seed.positions.map(...)` から `const massOf = ...` まで — は変更不要。ループ直後の bounding-box 計算コードも変更不要。)

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npm test`
Expected: 全テストパス。`npx tsc --noEmit` もクリーン。

- [ ] **Step 5: コミット**

```bash
git add src/layout/sibling-overlap-pack.ts test/sibling-overlap-pack.test.ts
git commit -m "Switch siblingOverlapPack relaxation to simultaneous (Jacobi-style) updates

Partial improvement only — verified by direct measurement that one
rectangle cannot achieve meaningful overlap with many mutually-separated
neighbors simultaneously; this removes update-order sensitivity and
improves total hub-spoke overlap satisfaction (~0.79 -> ~0.81 in the
tested 6-spoke scenario), but most of that scenario's individual
relationships still render with zero overlap. Full fix needs a larger
redesign (radial seeding around high-degree hubs, or curve-based bubble
contours instead of axis-aligned rectangles) — out of scope here."
```

---

## 全タスク完了後の確認

```bash
npm test          # expect: all assertions pass, 0 failures
npx tsc --noEmit  # expect: clean
npm run build     # expect: success
```

実機確認: ビルド出力(`main.js`, `manifest.json`, `styles.css`)を `/home/ubuntu/obsidian-plugins/開発/.obsidian/plugins/tag-lens` に手動コピーし、Obsidian をリロード。確認すべき点:
1. (Task 1) 小さく具体的な交差(例: `purgatorio (3)`, `inferno (3)`)が、より大きな無関係クラスタの塗りに埋もれず視認できること。
2. (Task 2) 同じタグ名が2箇所に重複して見える(チップ+巨大文字)現象が解消していること。
3. (Task 3) 多数の部分重複タグが密集するシーンで、完全な解決はしていないことを踏まえつつ、明らかな悪化がないこと(`siblingOverlapPack` を使う既存の全モードで視覚的回帰がないか確認)。

**Task 3 の既知の残存限界(ユーザーに伝達済みであることを前提とし、再度明記):** 1つのタグが多数の他タグそれぞれと部分的に重複共有している密集シーンでは、本計画の変更後も大半の関係が重なりゼロのまま描画される可能性が高い。これは矩形ベースの近似が抱える構造的な限界であり、解消には別途、放射状シード配置または曲線ベースの輪郭描画への再設計が必要。
