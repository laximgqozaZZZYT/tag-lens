# BubbleSets Degree-Cascading Intersection Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `bubblesets` mode, place each node's card inside the highest-degree tag-intersection region that is geometrically drawable (positive-area rectangle), cascading down one tag at a time when the exact region isn't realizable. Degree-3 ("true triple intersection") gets a deterministic geometric guarantee. `euler-true` is unchanged.

**Architecture:** Two new pure modules plug into the existing `layoutEulerTrue()` (already modified by the prior sibling-overlap-pack plan, `docs/superpowers/plans/2026-06-22-bubblesets-sibling-overlap.md`, tasks 1-2, already merged into this branch): `guaranteeTripleOverlaps` nudges box positions (inside the existing `pack` wrapping closure) so any 3 tags that genuinely share members always end up with a non-degenerate common rectangle; `resolveNodeRegion` picks, per node, the best drawable subset of its own tag signature by trying decreasing degrees. A new node-placement pass (bubblesets only) uses `resolveNodeRegion` to reposition degree ≥ 2 nodes into their resolved region's rectangle, replacing the old single-tag "exclave marker" placement for this mode only.

**Tech Stack:** TypeScript, no new dependencies. Tests via `npm test` (zero-dependency `ok`/`approx` harness in `test/assert.ts`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-22-bubblesets-degree-cascade-design.md`.
- Change is isolated to `bubblesets` mode. `euler-true`'s exclave-marker block and all other code paths in `layoutEulerTrue` must be byte-identical to before this plan.
- A "needed triple" `{a, b, c}` = 3 distinct tags whose member sets have a non-empty 3-way intersection.
- Triple-guarantee `eps` = `max(gap, 8)` world units, clamped down to the smallest of the three boxes' half-width/half-height so the construction stays feasible.
- `resolveNodeRegion` combinatorial guard: for signatures with more than 8 tags, only try degrees `k`, `k-1`, `k-2`, and `1` (skip the middle range) — mirrors the existing precedent in `src/layout/droste-layout.ts`'s `buildIcon`.
- Tie-break rule (both new modules): when multiple candidates are equally valid, prefer larger intersection area; tie further by alphabetically-smallest joined-tag-key string, for determinism.

---

### Task 4: `guaranteeTripleOverlaps` — deterministic triple-intersection construction

**Files:**
- Create: `src/layout/triple-overlap-guarantee.ts`
- Test: `test/triple-overlap-guarantee.test.ts`
- Modify: `test/index.ts` (register the new test file)

**Interfaces:**
- Produces: `guaranteeTripleOverlaps(boxes: SizedNode[], positions: { x: number; y: number }[], hasTripleShare: (a: string, b: string, c: string) => boolean, minEps: number): void` — mutates `positions` in place (same array, same order as `boxes`); returns nothing.
- Consumes: `SizedNode` type from `./layout`.

- [ ] **Step 1: Write the failing tests**

Create `test/triple-overlap-guarantee.test.ts`:

```ts
// guaranteeTripleOverlaps: deterministic construction that guarantees any
// 3 boxes whose tags genuinely share members (hasTripleShare) end up with a
// non-degenerate common rectangle, even if pairwise force-relaxation alone
// wouldn't produce one (classic failure: A∩B and B∩C non-empty, A∩C empty).
import { ok } from "./assert";
import { guaranteeTripleOverlaps } from "../src/layout/triple-overlap-guarantee";
import type { SizedNode } from "../src/layout/layout";

const box = (id: string, w: number, h: number): SizedNode => ({
	id, label: "", memberships: [], width: w, height: h,
});

function rectOf(pos: { x: number; y: number }, b: SizedNode) {
	return { left: pos.x - b.width / 2, right: pos.x + b.width / 2, top: pos.y - b.height / 2, bottom: pos.y + b.height / 2 };
}
function aabbIntersect3(r1: ReturnType<typeof rectOf>, r2: ReturnType<typeof rectOf>, r3: ReturnType<typeof rectOf>) {
	const left = Math.max(r1.left, r2.left, r3.left);
	const right = Math.min(r1.right, r2.right, r3.right);
	const top = Math.max(r1.top, r2.top, r3.top);
	const bottom = Math.min(r1.bottom, r2.bottom, r3.bottom);
	return { w: right - left, h: bottom - top };
}

// Classic failure case: A is far left, B in the middle (overlapping A), C
// far right (overlapping B but NOT A). Pairwise: A∩B>0, B∩C>0, A∩C=0 -> no
// triple region without correction.
{
	const boxes = [box("A", 100, 60), box("B", 100, 60), box("C", 100, 60)];
	const positions = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 160, y: 0 }];
	// Sanity: confirm the input is indeed the failure case before fixing it.
	const before = aabbIntersect3(rectOf(positions[0], boxes[0]), rectOf(positions[1], boxes[1]), rectOf(positions[2], boxes[2]));
	ok(before.w <= 0 || before.h <= 0, `expected the unfixed input to have no triple overlap, got w=${before.w} h=${before.h}`);

	guaranteeTripleOverlaps(boxes, positions, () => true, 10);
	const after = aabbIntersect3(rectOf(positions[0], boxes[0]), rectOf(positions[1], boxes[1]), rectOf(positions[2], boxes[2]));
	ok(after.w > 0 && after.h > 0, `expected a guaranteed triple overlap after the fix, got w=${after.w} h=${after.h}`);
}

// hasTripleShare === false -> no correction applied, positions untouched.
{
	const boxes = [box("A", 100, 60), box("B", 100, 60), box("C", 100, 60)];
	const positions = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 160, y: 0 }];
	const snapshot = positions.map((p) => ({ ...p }));
	guaranteeTripleOverlaps(boxes, positions, () => false, 10);
	ok(
		positions.every((p, i) => p.x === snapshot[i].x && p.y === snapshot[i].y),
		"positions must be untouched when hasTripleShare is false for every triple",
	);
}

// Already-overlapping triple (relaxation already solved it) -> left alone
// (no unnecessary perturbation of a good layout).
{
	const boxes = [box("A", 100, 60), box("B", 100, 60), box("C", 100, 60)];
	const positions = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -10, y: 0 }];
	const before = aabbIntersect3(rectOf(positions[0], boxes[0]), rectOf(positions[1], boxes[1]), rectOf(positions[2], boxes[2]));
	ok(before.w > 0 && before.h > 0, "precondition: this input already has a triple overlap");
	const snapshot = positions.map((p) => ({ ...p }));
	guaranteeTripleOverlaps(boxes, positions, () => true, 10);
	ok(
		positions.every((p, i) => p.x === snapshot[i].x && p.y === snapshot[i].y),
		"already-overlapping triple must be left untouched",
	);
}

// Small boxes: eps must clamp down to feasibility (never push a box's
// target region wider than the box itself).
{
	const boxes = [box("A", 20, 20), box("B", 20, 20), box("C", 20, 20)];
	const positions = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
	guaranteeTripleOverlaps(boxes, positions, () => true, 10000); // huge minEps
	const after = aabbIntersect3(rectOf(positions[0], boxes[0]), rectOf(positions[1], boxes[1]), rectOf(positions[2], boxes[2]));
	ok(after.w > 0 && after.h > 0, `expected feasible guaranteed overlap even with an oversized minEps, got w=${after.w} h=${after.h}`);
}

// Multiple independent needed triples among >3 boxes: each gets fixed
// without the function crashing or skipping later triples.
{
	const boxes = [box("A", 80, 50), box("B", 80, 50), box("C", 80, 50), box("D", 80, 50)];
	const positions = [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 140, y: 0 }, { x: 500, y: 500 }];
	const needed = new Set(["A|B|C"]);
	const key = (a: string, b: string, c: string) => [a, b, c].sort().join("|");
	guaranteeTripleOverlaps(boxes, positions, (a, b, c) => needed.has(key(a, b, c)), 10);
	const after = aabbIntersect3(rectOf(positions[0], boxes[0]), rectOf(positions[1], boxes[1]), rectOf(positions[2], boxes[2]));
	ok(after.w > 0 && after.h > 0, "the one needed triple (A,B,C) must end up overlapping");
	ok(positions[3].x === 500 && positions[3].y === 500, "box D (not part of any needed triple) must be untouched");
}
```

Register it in `test/index.ts`:

```ts
import "./triple-overlap-guarantee.test";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/layout/triple-overlap-guarantee'`.

- [ ] **Step 3: Implement `guaranteeTripleOverlaps`**

Create `src/layout/triple-overlap-guarantee.ts`:

```ts
import type { SizedNode } from "./layout";

// Deterministic construction: guarantees any 3 boxes whose tags genuinely
// share members end up with a non-degenerate common rectangle, even when
// pairwise force-relaxation alone wouldn't produce one (classic failure:
// A∩B and B∩C both non-empty, A∩C empty — no triple region without this).
//
// For each needed triple with a currently-degenerate AABB intersection:
// pick the centroid P of the three current centres, then clamp each box's
// centre to the minimal position such that its rectangle contains the
// small square P±eps. All three then contain that square by construction,
// so their intersection is guaranteed non-degenerate — no iteration, no
// convergence risk.
export function guaranteeTripleOverlaps(
	boxes: SizedNode[],
	positions: { x: number; y: number }[],
	hasTripleShare: (a: string, b: string, c: string) => boolean,
	minEps: number,
): void {
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			for (let k = j + 1; k < boxes.length; k++) {
				if (!hasTripleShare(boxes[i].id, boxes[j].id, boxes[k].id)) continue;
				const idx = [i, j, k];
				const lefts = idx.map((n) => positions[n].x - boxes[n].width / 2);
				const rights = idx.map((n) => positions[n].x + boxes[n].width / 2);
				const tops = idx.map((n) => positions[n].y - boxes[n].height / 2);
				const bottoms = idx.map((n) => positions[n].y + boxes[n].height / 2);
				const left = Math.max(...lefts);
				const right = Math.min(...rights);
				const top = Math.max(...tops);
				const bottom = Math.min(...bottoms);
				if (right - left > 0 && bottom - top > 0) continue; // already overlapping

				const px = idx.reduce((s, n) => s + positions[n].x, 0) / 3;
				const py = idx.reduce((s, n) => s + positions[n].y, 0) / 3;
				const eps = Math.min(
					minEps,
					...idx.map((n) => boxes[n].width / 2),
					...idx.map((n) => boxes[n].height / 2),
				);
				for (const n of idx) {
					const halfW = boxes[n].width / 2;
					const halfH = boxes[n].height / 2;
					const minX = px - halfW + eps;
					const maxX = px + halfW - eps;
					const minY = py - halfH + eps;
					const maxY = py + halfH - eps;
					positions[n].x = Math.min(maxX, Math.max(minX, positions[n].x));
					positions[n].y = Math.min(maxY, Math.max(minY, positions[n].y));
				}
			}
		}
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, all assertions including the new triple-overlap-guarantee suite.

- [ ] **Step 5: Commit**

```bash
git add src/layout/triple-overlap-guarantee.ts test/triple-overlap-guarantee.test.ts test/index.ts
git commit -m "Add guaranteeTripleOverlaps: deterministic n=3 intersection guarantee"
```

---

### Task 5: `resolveNodeRegion` — degree-cascading region resolver

**Files:**
- Create: `src/layout/intersection-region.ts`
- Test: `test/intersection-region.test.ts`
- Modify: `test/index.ts` (register the new test file)

**Interfaces:**
- Produces: `resolveNodeRegion(signature: string[], mainRectOf: (tag: string) => { x: number; y: number; w: number; h: number } | null): RegionResult | null` where `RegionResult = { tags: string[]; rect: { x: number; y: number; w: number; h: number } }`.
- Consumes: nothing beyond plain JS — no imports from `layout.ts` needed (the caller supplies `mainRectOf` as a closure).

- [ ] **Step 1: Write the failing tests**

Create `test/intersection-region.test.ts`:

```ts
// resolveNodeRegion: cascading degree search — try the node's full
// signature first; if that intersection isn't drawable (non-positive
// area), drop one tag at a time (trying every combination at each degree)
// until a drawable subset is found. Degree 1 (a single tag's own rect) is
// the guaranteed base case.
import { ok } from "./assert";
import { resolveNodeRegion } from "../src/layout/intersection-region";

type Rect = { x: number; y: number; w: number; h: number };
function rects(map: Record<string, Rect>) {
	return (tag: string): Rect | null => map[tag] ?? null;
}

// Full signature IS drawable -> use it directly (highest degree wins).
{
	const mainRectOf = rects({
		A: { x: 0, y: 0, w: 100, h: 100 },
		B: { x: 50, y: 50, w: 100, h: 100 },
	});
	const r = resolveNodeRegion(["A", "B"], mainRectOf);
	ok(r !== null, "must resolve a region");
	ok(r!.tags.length === 2 && r!.tags[0] === "A" && r!.tags[1] === "B", `expected full degree-2 region, got ${JSON.stringify(r!.tags)}`);
	ok(r!.rect.w > 0 && r!.rect.h > 0, "resolved rect must have positive area");
}

// Full signature NOT drawable -> cascades down to a drawable degree-(k-1)
// subset (drop one tag).
{
	// A, B, C: A and B overlap; C is far away from both -> {A,B,C} has no
	// triple region, but {A,B} does.
	const mainRectOf = rects({
		A: { x: 0, y: 0, w: 100, h: 100 },
		B: { x: 50, y: 0, w: 100, h: 100 },
		C: { x: 1000, y: 1000, w: 100, h: 100 },
	});
	const r = resolveNodeRegion(["A", "B", "C"], mainRectOf);
	ok(r !== null, "must resolve a region");
	ok(r!.tags.length === 2, `expected cascade to degree 2, got degree ${r!.tags.length} (${JSON.stringify(r!.tags)})`);
	ok(r!.tags[0] === "A" && r!.tags[1] === "B", `expected the drawable {A,B} pair, got ${JSON.stringify(r!.tags)}`);
}

// Nothing above degree 1 is drawable -> falls all the way to a single tag.
{
	const mainRectOf = rects({
		A: { x: 0, y: 0, w: 100, h: 100 },
		B: { x: 1000, y: 0, w: 100, h: 100 },
		C: { x: 0, y: 1000, w: 100, h: 100 },
	});
	const r = resolveNodeRegion(["A", "B", "C"], mainRectOf);
	ok(r !== null, "must resolve a region");
	ok(r!.tags.length === 1, `expected fallback to degree 1, got ${JSON.stringify(r!.tags)}`);
	ok(["A", "B", "C"].includes(r!.tags[0]), "degree-1 fallback must be one of the node's own tags");
}

// Single-tag signature -> trivially that tag's own rect, no search needed.
{
	const mainRectOf = rects({ A: { x: 5, y: 5, w: 40, h: 24 } });
	const r = resolveNodeRegion(["A"], mainRectOf);
	ok(r !== null && r.tags.length === 1 && r.tags[0] === "A", "single-tag signature resolves to itself");
	ok(r!.rect.x === 5 && r!.rect.y === 5 && r!.rect.w === 40 && r!.rect.h === 24, "single-tag rect is returned verbatim");
}

// Multiple drawable subsets at the same (highest available) degree -> pick
// the largest-area one. A∩C is empty (A and C don't reach each other at
// all), so the {A,B,C} triple is trivially empty too — this MUST cascade
// to degree 2, where {A,B} (area 2000) and {B,C} (area 1000) are both
// drawable but {A,C} is not; the larger one, {A,B}, must win.
{
	const mainRectOf = rects({
		A: { x: 0, y: 0, w: 100, h: 100 }, // 0..100, 0..100
		B: { x: 80, y: 0, w: 100, h: 100 }, // 80..180, 0..100 -> A∩B: 20x100=2000
		C: { x: 170, y: 0, w: 100, h: 100 }, // 170..270, 0..100 -> B∩C: 10x100=1000; A∩C: none (100 < 170)
	});
	const r = resolveNodeRegion(["A", "B", "C"], mainRectOf);
	ok(r !== null, "must resolve a region");
	ok(r!.tags.length === 2, `expected cascade to degree 2 (A∩C is empty so the triple is empty), got degree ${r!.tags.length} (${JSON.stringify(r!.tags)})`);
	ok(r!.tags[0] === "A" && r!.tags[1] === "B", `expected the larger-area pair {A,B}=2000 to win over {B,C}=1000, got ${JSON.stringify(r!.tags)}`);
}
```

Register it in `test/index.ts`:

```ts
import "./intersection-region.test";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/layout/intersection-region'`.

- [ ] **Step 3: Implement `resolveNodeRegion`**

Create `src/layout/intersection-region.ts`:

```ts
export interface RegionResult {
	tags: string[];
	rect: { x: number; y: number; w: number; h: number };
}

// All size-`d` combinations of `items`, as arrays preserving `items`' order.
function combinations<T>(items: T[], d: number): T[][] {
	const out: T[][] = [];
	const cur: T[] = [];
	const recur = (start: number): void => {
		if (cur.length === d) {
			out.push([...cur]);
			return;
		}
		for (let i = start; i < items.length; i++) {
			cur.push(items[i]);
			recur(i + 1);
			cur.pop();
		}
	};
	recur(0);
	return out;
}

// AABB intersection of a list of rects (sequential reduce). Returns null if
// any rect is missing or the running intersection degenerates (non-positive
// width or height) at any step.
function intersectAll(
	tags: string[],
	mainRectOf: (tag: string) => { x: number; y: number; w: number; h: number } | null,
): { x: number; y: number; w: number; h: number } | null {
	let left = -Infinity, top = -Infinity, right = Infinity, bottom = Infinity;
	for (const t of tags) {
		const r = mainRectOf(t);
		if (!r) return null;
		left = Math.max(left, r.x);
		top = Math.max(top, r.y);
		right = Math.min(right, r.x + r.w);
		bottom = Math.min(bottom, r.y + r.h);
		if (right - left <= 0 || bottom - top <= 0) return null;
	}
	return { x: left, y: top, w: right - left, h: bottom - top };
}

// Cascading degree search: try the node's full signature first (highest
// degree); if its intersection isn't drawable, drop one tag at a time
// (every combination, at each decreasing degree) until one is. Degree 1 is
// the guaranteed base case (a tag's own rect, assumed always present for
// any tag actually in the signature).
export function resolveNodeRegion(
	signature: string[],
	mainRectOf: (tag: string) => { x: number; y: number; w: number; h: number } | null,
): RegionResult | null {
	const k = signature.length;
	if (k === 0) return null;
	if (k === 1) {
		const r = mainRectOf(signature[0]);
		return r ? { tags: [...signature], rect: r } : null;
	}

	const degrees: number[] = [];
	if (k > 8) {
		degrees.push(k, k - 1, k - 2, 1);
	} else {
		for (let d = k; d >= 1; d--) degrees.push(d);
	}

	for (const d of degrees) {
		const combos = combinations(signature, d);
		let best: RegionResult | null = null;
		let bestArea = -1;
		for (const combo of combos) {
			const rect = intersectAll(combo, mainRectOf);
			if (!rect) continue;
			const area = rect.w * rect.h;
			const sortedTags = [...combo].sort();
			const key = sortedTags.join("");
			if (
				area > bestArea ||
				(area === bestArea && best !== null && key < best.tags.join(""))
			) {
				bestArea = area;
				best = { tags: sortedTags, rect };
			}
		}
		if (best) return best;
	}
	return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, all assertions including the new intersection-region suite.

- [ ] **Step 5: Commit**

```bash
git add src/layout/intersection-region.ts test/intersection-region.test.ts test/index.ts
git commit -m "Add resolveNodeRegion: degree-cascading intersection region search"
```

---

### Task 6: Wire both into `layoutEulerTrue` for `bubblesets`

**Files:**
- Modify: `src/layout/layout.ts`
- Test: `test/bubblesets-degree-cascade.test.ts`
- Modify: `test/index.ts` (register the new test file)

**Interfaces:**
- Consumes: `guaranteeTripleOverlaps` (Task 4), `resolveNodeRegion` (Task 5), and the existing `tagMembers`, `pack`, `clusters`, `nodes`, `idToRect`, `sizedById`, `cardW`, `cardH`, `gap` locals already inside `layoutEulerTrue` (from the prior plan's Task 2 wiring).
- Produces: no new exports — `layout(data, sized, { ...opts, viewMode: "bubblesets" })` now places degree ≥ 2 nodes in their cascaded region; `viewMode: "euler-true"` is unchanged.

- [ ] **Step 1: Write the failing tests**

Create `test/bubblesets-degree-cascade.test.ts`:

```ts
// bubblesets mode must place a node inside the highest-degree drawable
// intersection of its own tag signature, cascading down when the exact
// region can't be realized — and must guarantee a true triple region for
// any 3 tags that genuinely share members (n=3 strict, per
// docs/superpowers/specs/2026-06-22-bubblesets-degree-cascade-design.md).
// euler-true keeps its old single-tag-plus-exclave-marker placement.
import { ok } from "./assert";
import { layout, type SizedNode, type LayoutOptions } from "../src/layout/layout";
import type { GraphData, GraphNode, ViewMode } from "../src/types";

function makeData(): GraphData {
	const n = (id: string, tags: string[]): GraphNode => ({ id, label: id, memberships: tags });
	const nodes: GraphNode[] = [];
	// Three mutually cross-cutting tags A, B, C, each with several
	// exclusive members, plus one node belonging to ALL THREE (the literal
	// degree-3 case the n=3 guarantee must serve).
	for (let i = 0; i < 5; i++) nodes.push(n(`a${i}`, ["A"]));
	for (let i = 0; i < 5; i++) nodes.push(n(`b${i}`, ["B"]));
	for (let i = 0; i < 5; i++) nodes.push(n(`c${i}`, ["C"]));
	nodes.push(n("abc1", ["A", "B", "C"]));
	return { nodes, edges: [] };
}
const sizedFrom = (d: GraphData): SizedNode[] => d.nodes.map((n) => ({ ...n, width: 40, height: 24 }));
function opts(viewMode: ViewMode): LayoutOptions {
	return {
		clusterSpacing: 80, nodeSpacing: 16, cellW: 40, cellH: 24, minFontPx: 8,
		clusterLabels: new Map<string, string>(), anchorPlacement: "concentric", viewMode,
		bipartiteMaxTags: 80, bipartiteLayout: "concentric",
	} as LayoutOptions;
}

function mainRectOf(clusters: ReturnType<typeof layout>["clusters"], key: string) {
	const c = clusters.find((cl) => cl.groupKey === key)!;
	const main = c.pieces!.find((p) => p.kind === "main" && !p.contour)!;
	return { x: main.x, y: main.y, w: main.w, h: main.h };
}
function contains(rect: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
	return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

// bubblesets: the degree-3 node must land inside the TRUE triple-overlap
// region of A, B, and C's main rects (not just inside any one of them).
{
	const d = makeData();
	const r = layout(d, sizedFrom(d), opts("bubblesets"));
	const a = mainRectOf(r.clusters, "A");
	const b = mainRectOf(r.clusters, "B");
	const c = mainRectOf(r.clusters, "C");
	const left = Math.max(a.x, b.x, c.x);
	const top = Math.max(a.y, b.y, c.y);
	const right = Math.min(a.x + a.w, b.x + b.w, c.x + c.w);
	const bottom = Math.min(a.y + a.h, b.y + b.h, c.y + c.h);
	ok(right - left > 0 && bottom - top > 0, `[bubblesets] A, B, C main rects must have a real triple overlap, got bounds ${JSON.stringify({ left, top, right, bottom })}`);

	const abc1 = r.nodes.find((n) => n.id === "abc1")!;
	ok(
		contains({ x: left, y: top, w: right - left, h: bottom - top }, abc1.x, abc1.y),
		`[bubblesets] degree-3 node must be placed inside the true A∩B∩C region, got (${abc1.x}, ${abc1.y}) vs region ${JSON.stringify({ left, top, right, bottom })}`,
	);
}

// euler-true: the degree-3 node keeps the OLD behavior (homed in one of
// A/B/C's own block, not necessarily inside any triple region) — this
// mode must be unaffected by this plan.
{
	const d = makeData();
	const r1 = layout(d, sizedFrom(d), opts("euler-true"));
	const r2 = layout(d, sizedFrom(d), opts("euler-true"));
	const abc1a = r1.nodes.find((n) => n.id === "abc1")!;
	const abc1b = r2.nodes.find((n) => n.id === "abc1")!;
	ok(abc1a.x === abc1b.x && abc1a.y === abc1b.y, "[euler-true] placement is deterministic and unaffected by this plan (unchanged exclave-marker behavior)");
}
```

Register it in `test/index.ts`:

```ts
import "./bubblesets-degree-cascade.test";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL on the `[bubblesets] degree-3 node must be placed inside the true A∩B∩C region` assertion (current behavior homes `abc1` in one single tag's own block, with only a tiny exclave marker elsewhere — not a true triple region).

- [ ] **Step 3: Implement the wiring**

In `src/layout/layout.ts`, add imports near the top (next to the existing `siblingOverlapPack` import):

```ts
import { guaranteeTripleOverlaps } from "./triple-overlap-guarantee";
import { resolveNodeRegion } from "./intersection-region";
```

Replace the existing `bubblesets`-only `pack` definition (the one Task 2 of the prior plan added, currently reading):

```ts
	const pack =
		opts.viewMode === "bubblesets"
			? (boxes: SizedNode[], gp: number) => siblingOverlapPack(boxes, gp, { sharedCount, sizeOf })
			: shelfPack;
```

with:

```ts
	const hasTripleShare = (a: string, b: string, c: string): boolean => {
		const sa = tagMembers.get(a);
		const sb = tagMembers.get(b);
		const sc = tagMembers.get(c);
		if (!sa || !sb || !sc) return false;
		for (const id of sa) if (sb.has(id) && sc.has(id)) return true;
		return false;
	};
	const pack =
		opts.viewMode === "bubblesets"
			? (boxes: SizedNode[], gp: number) => {
					const r = siblingOverlapPack(boxes, gp, { sharedCount, sizeOf });
					guaranteeTripleOverlaps(boxes, r.positions, hasTripleShare, Math.max(gp, 8));
					let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
					for (let i = 0; i < boxes.length; i++) {
						const b = boxes[i];
						const p = r.positions[i];
						minX = Math.min(minX, p.x - b.width / 2);
						minY = Math.min(minY, p.y - b.height / 2);
						maxX = Math.max(maxX, p.x + b.width / 2);
						maxY = Math.max(maxY, p.y + b.height / 2);
					}
					for (const p of r.positions) { p.x -= minX; p.y -= minY; }
					return { positions: r.positions, width: maxX - minX, height: maxY - minY };
				}
			: shelfPack;
```

This recomputes the bounding box after `guaranteeTripleOverlaps` may have nudged a box outside the previously-computed bbox (mirroring `siblingOverlapPack`'s own tail bbox-recompute, Task 1 of the prior plan).

Then, immediately after the existing "PARTIAL-OVERLAP exclaves" block (the `for (const c of clusters) { ... }` loop that pushes tiny marker squares — find it by its preceding comment block starting `// PARTIAL-OVERLAP exclaves`), wrap that ENTIRE existing block in `if (opts.viewMode !== "bubblesets") { ... }` (so `euler-true` keeps it verbatim, unchanged), and add a new `else` branch with the region-cascade placement:

```ts
	if (opts.viewMode !== "bubblesets") {
		// [the existing PARTIAL-OVERLAP exclave block goes here, UNCHANGED]
	} else {
		// Degree-cascading region placement (bubblesets only): reposition
		// every degree >= 2 node into the highest-degree drawable
		// intersection of its OWN tag signature, instead of the single-tag
		// exclave-marker scheme above.
		const mainRectOf = (tag: string): { x: number; y: number; w: number; h: number } | null => {
			const c = clusters.find((cl) => cl.groupKey === tag);
			const m = c?.pieces?.find((p) => p.kind === "main" && !p.contour);
			return m ? { x: m.x, y: m.y, w: m.w, h: m.h } : null;
		};
		const regionGroups = new Map<string, { tags: string[]; rect: { x: number; y: number; w: number; h: number }; nodeList: PositionedNode[] }>();
		for (const n of nodes) {
			const sig = n.memberships.length > 0 ? [...new Set(n.memberships)].sort() : [NONE_BUCKET];
			if (sig.length < 2) continue; // degree 1: already correctly placed by place()
			const region = resolveNodeRegion(sig, mainRectOf);
			if (!region || region.tags.length < 2) continue;
			const key = region.tags.join("");
			let g = regionGroups.get(key);
			if (!g) {
				g = { tags: region.tags, rect: region.rect, nodeList: [] };
				regionGroups.set(key, g);
			}
			g.nodeList.push(n);
		}
		for (const g of regionGroups.values()) {
			const sizes: SizedNode[] = g.nodeList.map((n) => {
				const sz = sizedById.get(n.id);
				return { id: n.id, label: n.label, memberships: n.memberships, width: sz?.width ?? cardW, height: sz?.height ?? cardH };
			});
			const p = shelfPack(sizes, gap);
			g.nodeList.forEach((n, i) => {
				n.x = g.rect.x + gap + p.positions[i].x;
				n.y = g.rect.y + gap + p.positions[i].y;
				idToRect.set(n.id, { x: n.x, y: n.y, w: n.width, h: n.height });
			});
			const hostTag = [...g.tags].sort()[0];
			const hostCluster = clusters.find((c) => c.groupKey === hostTag);
			hostCluster?.pieces?.push({
				x: g.rect.x,
				y: g.rect.y,
				w: g.rect.w,
				h: g.rect.h,
				kind: "sub",
				hueKey: hostTag,
				hueKeys: g.tags,
			});
		}
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all assertions, including the new degree-cascade test and every pre-existing test (`euler-true-stripes.test.ts`, `bubblesets-sibling-overlap.test.ts`, `sibling-overlap-pack.test.ts`, `triple-overlap-guarantee.test.ts`, `intersection-region.test.ts`).

If `euler-true-stripes.test.ts` or `bubblesets-sibling-overlap.test.ts` fail: re-read the diff against the exact wrapping described above — the existing exclave block must be moved verbatim into the `if (opts.viewMode !== "bubblesets")` branch with NO logic changes, only the new `else` branch is new code. A failure here means something inside the moved block was altered by mistake; revert to the original block content and re-apply only the wrapping.

- [ ] **Step 5: Commit**

```bash
git add src/layout/layout.ts test/bubblesets-degree-cascade.test.ts test/index.ts
git commit -m "Wire degree-cascading region placement + triple guarantee into bubblesets"
```

---

### Task 7: Full-suite regression + manual visual confirmation

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, every test in `test/index.ts` — confirms this plan's bubblesets-only branch didn't regress any other mode.

- [ ] **Step 2: Build the plugin**

Run: `npm run build`
Expected: exits 0, no esbuild errors.

- [ ] **Step 3: Manual visual confirmation**

Copy `main.js`, `manifest.json`, `styles.css` into the dev vault's plugin folder
(`/home/ubuntu/obsidian-plugins/開発/.obsidian/plugins/tag-lens/`), then drive a
fresh isolated Obsidian profile (separate `--user-data-dir` and
`--remote-debugging-port`, NOT the user's already-running instance — see
`test/e2e/e2e-closeup.mjs` for the established pattern) into `bubblesets`
mode against real vault data with a known 3-way-sharing tag triple, and
inspect `view.laid.clusters`/`view.laid.nodes` directly (via
`Runtime.evaluate` over the CDP WebSocket) to confirm: (a) a real,
non-degenerate triple-overlap rectangle exists for that triple, and (b) the
degree-3 node's actual `(x, y)` falls inside it. Record what was observed —
this step has no scripted pass/fail to paste blindly; if the live check
disagrees with the unit/integration tests, that is itself a finding to
report, not something to paper over.
