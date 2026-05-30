# Print Gallery (Escher) View Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an experimental view mode `"droste"` that renders the tag-membership hierarchy as M.C. Escher's *Print Gallery* via the Droste conformal map `z = R₀·exp(γ·ζ)`.

**Architecture:** A new `layoutDroste` builds a strip-space (`u,v`) placement (`DrosteMeta` on `LaidOut`, mirroring `lattice`/`heatmap`). A new pure `conformal.ts` maps strip→plane and back. A new `draw-droste.ts` subdivides every edge, projects each vertex through the conformal map, and strokes/fills polylines, drawing several scale copies back-to-front. `view.ts` dispatches to it, adds panel controls, and does inverse-map hit-testing with multi-copy resolution.

**Tech Stack:** TypeScript (strict), esbuild bundler, Canvas 2D, Obsidian plugin API. No runtime deps. Tests run via a minimal esbuild→node harness (added in Task 0).

**Spec:** `docs/superpowers/specs/2026-05-30-droste-bubblesets-design.md` — read it first.

---

## File Structure

- **Create** `test/run.mjs` — esbuild→node test harness (bundles `test/index.ts`, runs it, exits non-zero on failure).
- **Create** `test/index.ts` — imports every `*.test.ts` so one run executes all.
- **Create** `test/assert.ts` — 3 tiny assert helpers (`eq`, `approx`, `ok`).
- **Create** `src/conformal.ts` — `DrosteParams`, `Complex`, `drosteForward`, `drosteInverseBranch`, `subdivideSegment`, plus self-check fns used by tests.
- **Create** `test/conformal.test.ts` — round-trip, scale-periodicity, angle-closure, subdivision tests.
- **Create** `src/droste-layout.ts` — `DrosteMeta`, `DrosteBandElement`, `layoutDroste`, `assertLayoutSeam`.
- **Create** `test/droste-layout.test.ts` — seam C0/C1 + band-assignment tests.
- **Create** `src/draw-droste.ts` — `drawDroste(ctx, meta, opts)` renderer.
- **Modify** `src/types.ts` — `ViewMode` add `"droste"`; 5 settings fields; `VIEW_MODES` entry.
- **Modify** `src/layout.ts` — `LaidOut.droste?`, import + dispatch `layoutDroste`.
- **Modify** `src/main.ts` — `DEFAULT_SETTINGS` 5 fields + `loadSettings` validation.
- **Modify** `src/view.ts` — `draw()` dispatch, panel section, hit-test invert + re-root.
- **Modify** `README.md` — document the new beta mode.
- **Modify** `package.json` — add `"test"` script.

---

## Task 0: Minimal test harness (esbuild → node)

**Files:**
- Create: `test/assert.ts`
- Create: `test/index.ts`
- Create: `test/run.mjs`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Write the assert helpers**

Create `test/assert.ts`:

```ts
// Tiny zero-dependency assertion helpers. Throw on failure; the runner
// (test/run.mjs) catches, prints, and exits non-zero.
let passed = 0;
export function ok(cond: boolean, msg: string): void {
	if (!cond) throw new Error(`FAIL: ${msg}`);
	passed++;
}
export function eq<T>(actual: T, expected: T, msg: string): void {
	ok(actual === expected, `${msg} — expected ${String(expected)}, got ${String(actual)}`);
}
export function approx(actual: number, expected: number, eps: number, msg: string): void {
	ok(Math.abs(actual - expected) <= eps, `${msg} — expected ≈${expected} (±${eps}), got ${actual}`);
}
export function summary(): number {
	console.log(`\n${passed} assertions passed`);
	return passed;
}
```

- [ ] **Step 2: Write the aggregator entry (empty for now)**

Create `test/index.ts`:

```ts
// Import every *.test.ts here so one bundle runs the whole suite.
import { summary } from "./assert";

// (test files imported below as they are added)

summary();
```

- [ ] **Step 3: Write the runner**

Create `test/run.mjs`:

```mjs
// Bundle test/index.ts (which imports all *.test.ts) to a temp ESM file,
// then dynamically import it. Any thrown assertion exits non-zero.
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const result = await build({
	entryPoints: ["test/index.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const dir = mkdtempSync(join(tmpdir(), "tag-lens-test-"));
const out = join(dir, "tests.mjs");
writeFileSync(out, result.outputFiles[0].text);
try {
	await import(pathToFileURL(out).href);
} catch (e) {
	console.error(e.message ?? e);
	process.exit(1);
}
```

- [ ] **Step 4: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
"test": "node test/run.mjs"
```

- [ ] **Step 5: Run the harness (should pass with 0 assertions)**

Run: `npm test`
Expected: prints `0 assertions passed`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add test/ package.json
git commit -m "test: add minimal esbuild→node test harness"
```

---

## Task 1: conformal.ts — forward map + round-trip test

**Files:**
- Create: `src/conformal.ts`
- Test: `test/conformal.test.ts`
- Modify: `test/index.ts`

- [ ] **Step 1: Write the failing test**

Create `test/conformal.test.ts`:

```ts
import { approx } from "./assert";
import { drosteForward, drosteInverseBranch, type DrosteParams } from "../src/conformal";

const P: DrosteParams = { k: 2.5, twistDir: 1, R0: 100 };

// Round-trip: inverse(forward(u,v)) ≈ (u,v) for the matching branch.
for (const [u, v] of [[0.3, 0.5], [-1.2, 4.0], [2.0, 6.0]] as const) {
	const z = drosteForward(u, v, P);
	// forward used arg in (−π,π]; pick branch n so vRaw lands near v.
	const n = Math.round((v - drosteInverseBranch(z, P, 0).vRaw) / (2 * Math.PI));
	const back = drosteInverseBranch(z, P, n);
	approx(back.u, u, 1e-9, `round-trip u (u=${u},v=${v})`);
	approx(back.vRaw, v, 1e-9, `round-trip v (u=${u},v=${v})`);
}
```

Add to `test/index.ts` (above `summary()`):

```ts
import "./conformal.test";
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/conformal` (module missing).

- [ ] **Step 3: Write minimal implementation**

Create `src/conformal.ts`:

```ts
// Droste / Escher "Print Gallery" conformal map, strip→plane parametrisation.
//   ζ = u + i·v,  z = R₀·exp(γ·ζ),  γ = 1 − i·twistDir·(ln k)/(2π)
// See docs/superpowers/specs/2026-05-30-droste-bubblesets-design.md §2.
export interface Complex {
	re: number;
	im: number;
}

export interface DrosteParams {
	k: number; // scale factor per loop (drosteZoom), > 1
	twistDir: 1 | -1; // +1 ccw (|z| ×k per +2π in v), -1 cw
	R0: number; // base radius
}

function gammaIm(p: DrosteParams): number {
	// Im(γ) = −twistDir·(ln k)/(2π); Re(γ) = 1 (angle closure).
	return -p.twistDir * Math.log(p.k) / (2 * Math.PI);
}

// Forward: strip (u, v) → plane z. ζ = u + i·v.
export function drosteForward(u: number, v: number, p: DrosteParams): Complex {
	const gRe = 1;
	const gIm = gammaIm(p);
	// γ·ζ = (gRe·u − gIm·v) + i(gRe·v + gIm·u)
	const aRe = gRe * u - gIm * v;
	const aIm = gRe * v + gIm * u;
	const r = p.R0 * Math.exp(aRe);
	return { re: r * Math.cos(aIm), im: r * Math.sin(aIm) };
}

// Inverse on a chosen log branch n: ζ = ln(z/R₀)/γ with arg shifted by 2π·n.
// The map is 2πi-periodic, so a screen point has one (u, vRaw) per branch n;
// the renderer's drawn copies correspond to a contiguous range of n.
export function drosteInverseBranch(
	z: Complex,
	p: DrosteParams,
	n: number,
): { u: number; vRaw: number } {
	const gRe = 1;
	const gIm = gammaIm(p);
	const mag = Math.hypot(z.re, z.im) / p.R0;
	const wRe = Math.log(mag);
	const wIm = Math.atan2(z.im, z.re) + 2 * Math.PI * n;
	// ζ = w/γ = w·conj(γ)/|γ|²
	const g2 = gRe * gRe + gIm * gIm;
	const u = (wRe * gRe + wIm * gIm) / g2;
	const vRaw = (wIm * gRe - wRe * gIm) / g2;
	return { u, vRaw };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS — round-trip assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/conformal.ts test/conformal.test.ts test/index.ts
git commit -m "feat: add Droste conformal forward/inverse map with round-trip test"
```

---

## Task 2: conformal.ts — scale-periodicity + angle-closure tests (spec §8 #2)

**Files:**
- Test: `test/conformal.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/conformal.test.ts`:

```ts
// Scale periodicity: one loop (+2π in v) multiplies |z| by k^twistDir.
// Independent of round-trip — a wrong-but-consistent map can pass round-trip.
for (const twistDir of [1, -1] as const) {
	const Q: DrosteParams = { k: 2.5, twistDir, R0: 100 };
	for (const [u, v] of [[0.2, 0.0], [-1.0, 1.3], [3.0, 5.5]] as const) {
		const z0 = drosteForward(u, v, Q);
		const z1 = drosteForward(u, v + 2 * Math.PI, Q);
		const ratio = Math.hypot(z1.re, z1.im) / Math.hypot(z0.re, z0.im);
		approx(ratio, Math.pow(Q.k, twistDir), 1e-9,
			`scale ×k per loop (twist=${twistDir}, u=${u}, v=${v})`);
		// Angle closure: arg advances by exactly 2π over one loop (Re(γ)=1).
		const a0 = Math.atan2(z0.im, z0.re);
		const a1 = Math.atan2(z1.im, z1.re);
		const d = ((a1 - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
		approx(Math.min(d, 2 * Math.PI - d), 0, 1e-9,
			`angle closes mod 2π (twist=${twistDir}, u=${u}, v=${v})`);
	}
}
```

- [ ] **Step 2: Run to verify it passes**

Run: `npm test`
Expected: PASS (the Task-1 implementation already satisfies these — they lock the property against regressions).
If any FAIL: the map is wrong; fix `gammaIm` / `drosteForward` before proceeding.

- [ ] **Step 3: Commit**

```bash
git add test/conformal.test.ts
git commit -m "test: lock Droste scale-periodicity and angle-closure invariants"
```

---

## Task 3: conformal.ts — edge subdivision helper + test

**Files:**
- Modify: `src/conformal.ts` (append)
- Test: `test/conformal.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/conformal.test.ts`:

```ts
import { subdivideSegment } from "../src/conformal";
{
	const pts = subdivideSegment({ u: 0, v: 0 }, { u: 1, v: 2 }, 4);
	approx(pts.length, 5, 0, "subdivide n=4 yields n+1 points");
	approx(pts[0].u, 0, 1e-12, "first point = start");
	approx(pts[4].v, 2, 1e-12, "last point = end");
	approx(pts[2].u, 0.5, 1e-12, "midpoint u interpolated");
	approx(pts[2].v, 1.0, 1e-12, "midpoint v interpolated");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `subdivideSegment` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/conformal.ts`:

```ts
export interface StripPoint {
	u: number;
	v: number;
}

// Split a strip-space segment into `n` equal pieces → n+1 points. The renderer
// maps each point through drosteForward so a straight strip edge becomes a
// smooth spiral polyline on screen.
export function subdivideSegment(a: StripPoint, b: StripPoint, n: number): StripPoint[] {
	const steps = Math.max(1, Math.floor(n));
	const out: StripPoint[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		out.push({ u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
	}
	return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/conformal.ts test/conformal.test.ts
git commit -m "feat: add strip-segment subdivision helper for conformal rendering"
```

---

## Task 4: types.ts — ViewMode, settings fields, VIEW_MODES entry

**Files:**
- Modify: `src/types.ts` (`ViewMode` ~line 185; `MiniSettings` end ~line 182; `VIEW_MODES` end ~line 303; `DEFAULT_SETTINGS` ~line 367)

- [ ] **Step 1: Extend the ViewMode union**

In `src/types.ts`, change the `ViewMode` type (currently ends `| "upset";`) to add `"droste"`:

```ts
export type ViewMode =
	| "euler"
	| "euler-true"
	| "euler-venn"
	| "bubblesets"
	| "matrix"
	| "bipartite"
	| "heatmap"
	| "lattice"
	| "upset"
	| "droste";
```

- [ ] **Step 2: Add settings fields to MiniSettings**

In `interface MiniSettings`, immediately before the closing `}` (after `minFontPx: number;`), add:

```ts
	// --- Print Gallery (Escher / Droste) view mode ---
	// Scale factor per perimeter loop (k). Kept gentle by default so inner
	// recursion copies survive the minFontPx floor (k=8×copies=4 ⇒ 512× span).
	drosteZoom: number;
	// Spiral chirality: "ccw" (|z| ×k as v increases) or "cw".
	drosteTwistDir: "ccw" | "cw";
	// Number of recursion copies drawn (back-to-front).
	drosteCopies: number;
	// Segments per edge when subdividing for the conformal warp.
	drosteSubdiv: number;
	// Focus node id placed at the bottom-left (v=0). "" ⇒ first node.
	drosteFocus: string;
```

- [ ] **Step 3: Add the VIEW_MODES picker entry**

In `VIEW_MODES`, after the `upset` entry's closing `},` (and before the array's closing `];`), add:

```ts
	{
		// Escher "Print Gallery": the membership hierarchy laid around a square
		// perimeter (focus node → node-peers → containing group → peer groups)
		// and warped by the Droste conformal map so it spirals into itself.
		// Beta: cards become quadrilaterals; text is drawn upright (a known
		// readability compromise — see the spec §7).
		id: "droste",
		label: "Print Gallery (Escher)",
		description: "Droste conformal map (z = R₀·exp(γζ)); hierarchy spirals into itself",
		experimental: true,
	},
```

- [ ] **Step 4: Add defaults to DEFAULT_SETTINGS**

In `DEFAULT_SETTINGS`, before the closing `};` (after `minFontPx: 8,`), add:

```ts
	drosteZoom: 2.5,
	drosteTwistDir: "ccw",
	drosteCopies: 4,
	drosteSubdiv: 24,
	drosteFocus: "",
```

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: PASS (0 errors). `VIEW_MODES`/`DEFAULT_SETTINGS` now reference the new union member and fields consistently.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat: add droste view mode + settings to types"
```

---

## Task 5: main.ts — loadSettings validation for the droste fields

**Files:**
- Modify: `src/main.ts` (inside `loadSettings`, before `this.settings = merged as unknown as MiniSettings;` ~line 229)

- [ ] **Step 1: Add validation block**

In `src/main.ts`, immediately before `this.settings = merged as unknown as MiniSettings;`, add (reuse the `intPositive` helper already defined above in the same method):

```ts
		// --- droste (Print Gallery) validation ---
		if (
			typeof merged.drosteZoom !== "number" ||
			!Number.isFinite(merged.drosteZoom) ||
			(merged.drosteZoom as number) <= 1
		) {
			merged.drosteZoom = 2.5;
		}
		if (merged.drosteTwistDir !== "ccw" && merged.drosteTwistDir !== "cw") {
			merged.drosteTwistDir = "ccw";
		}
		merged.drosteCopies = intPositive(merged.drosteCopies, 4, 1);
		merged.drosteSubdiv = intPositive(merged.drosteSubdiv, 24, 1);
		if (typeof merged.drosteFocus !== "string") merged.drosteFocus = "";
```

- [ ] **Step 2: Verify type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both PASS (exit 0). `npm test` still passes (no test touches main.ts; loadSettings validation is verified by tsc + build + manual, matching the repo's existing inline-validation pattern).

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: validate/migrate droste settings in loadSettings"
```

---

## Task 6: droste-layout.ts — strip layout + seam asserts (spec §3, §8 #3)

**Files:**
- Create: `src/droste-layout.ts`
- Test: `test/droste-layout.test.ts`
- Modify: `test/index.ts`

**Strip model:** `v ∈ [0, 2π)` split into 4 quadrants (level 1=bottom, 2=right, 3=top, 4=left transition). Each element gets a `[v0,v1]` slice within its quadrant and a radial band `[u0,u1]`. The layout MUST be 2π-periodic in `v`: the level-4 transition band linearly interpolates the level-3 trailing centreline/width into the level-1 leading centreline/width so that `centre(0)=centre(2π)` (C0) and `centre'(0)=centre'(2π)` (C1).

- [ ] **Step 1: Write the failing test**

Create `test/droste-layout.test.ts`:

```ts
import { approx, ok } from "./assert";
import { layoutDroste, assertLayoutSeam } from "../src/droste-layout";
import type { GraphData } from "../src/types";

// Minimal fixture: node n0 in cluster A; n1 in A; cluster B separate.
const data: GraphData = {
	nodes: [
		{ id: "n0", label: "n0", memberships: ["A"] },
		{ id: "n1", label: "n1", memberships: ["A"] },
		{ id: "n2", label: "n2", memberships: ["B"] },
	],
	edges: [],
};

const meta = layoutDroste(data, { focusId: "n0" });

// Focus node placed at v=0 (bottom-left corner).
const focus = meta.elements.find((e) => e.id === "n0");
ok(!!focus, "focus element exists");
approx(focus!.v0, 0, 1e-9, "focus starts at v=0");

// All elements live within one period [0, 2π).
for (const e of meta.elements) {
	ok(e.v0 >= 0 && e.v1 <= 2 * Math.PI + 1e-9, `element ${e.id} within [0,2π]`);
}

// Seam continuity: centreline + width match to C0 and C1 at v=0 ≡ 2π.
const seam = assertLayoutSeam(meta);
approx(seam.c0CentreGap, 0, 1e-6, "seam C0 centreline gap");
approx(seam.c0WidthGap, 0, 1e-6, "seam C0 width gap");
approx(seam.c1CentreGap, 0, 1e-4, "seam C1 tangent gap");
```

Add to `test/index.ts` (above `summary()`):

```ts
import "./droste-layout.test";
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/droste-layout`.

- [ ] **Step 3: Write minimal implementation**

Create `src/droste-layout.ts`:

```ts
import type { GraphData } from "./types";

export interface DrosteBandElement {
	id: string;
	kind: "node" | "cluster";
	label: string;
	hueKey: string; // key for clusterHue()
	level: 1 | 2 | 3 | 4;
	u0: number;
	u1: number; // radial band extent (depth)
	v0: number;
	v1: number; // angular extent within [0, 2π)
}

export interface DrosteMeta {
	elements: DrosteBandElement[];
	focusId: string;
	uPeriod: number; // radial thickness of one frame band
}

export interface DrosteLayoutOpts {
	focusId?: string;
}

const TWO_PI = 2 * Math.PI;
const QUAD = TWO_PI / 4; // one hierarchy level per quadrant

// Centreline (mid-u) of the band as a function of v, evaluated on the
// canonical period. Exposed for the seam assert. Linear within each quadrant;
// the level-4 quadrant interpolates level-3's trailing state back to level-1's
// leading state so the cylinder closes smoothly.
export function bandCentre(meta: DrosteMeta, v: number): number {
	const vv = ((v % TWO_PI) + TWO_PI) % TWO_PI;
	// Aggregate centre = mean of (u0+u1)/2 over elements whose [v0,v1] covers vv,
	// falling back to uPeriod/2 in the transition gap.
	let sum = 0, count = 0;
	for (const e of meta.elements) {
		if (vv >= e.v0 && vv < e.v1) {
			sum += (e.u0 + e.u1) / 2;
			count++;
		}
	}
	return count > 0 ? sum / count : meta.uPeriod / 2;
}

export function bandWidth(meta: DrosteMeta, v: number): number {
	const vv = ((v % TWO_PI) + TWO_PI) % TWO_PI;
	let maxW = 0;
	for (const e of meta.elements) {
		if (vv >= e.v0 && vv < e.v1) maxW = Math.max(maxW, e.u1 - e.u0);
	}
	return maxW > 0 ? maxW : meta.uPeriod;
}

export function layoutDroste(data: GraphData, opts: DrosteLayoutOpts = {}): DrosteMeta {
	const nodes = data.nodes;
	const focusId = opts.focusId && nodes.some((n) => n.id === opts.focusId)
		? opts.focusId
		: nodes[0]?.id ?? "";
	const focus = nodes.find((n) => n.id === focusId);
	const focusClusters = new Set(focus?.memberships ?? []);

	// Level 1: focus + sibling notes sharing any of the focus's clusters.
	const peers = nodes.filter(
		(n) => n.id === focusId || n.memberships.some((m) => focusClusters.has(m)),
	);
	// Level 2: the focus's clusters. Level 3: all other clusters.
	const allClusters = new Set<string>();
	for (const n of nodes) for (const m of n.memberships) allClusters.add(m);
	const lvl2 = [...focusClusters];
	const lvl3 = [...allClusters].filter((c) => !focusClusters.has(c));

	const uPeriod = 1; // one frame band spans u ∈ [0, 1)
	const u0 = 0.1 * uPeriod;
	const u1 = 0.9 * uPeriod; // 10% margin top/bottom of the band

	const elements: DrosteBandElement[] = [];
	const spread = (
		ids: { id: string; label: string; hueKey: string; kind: "node" | "cluster" }[],
		level: 1 | 2 | 3,
		qStart: number,
	) => {
		const n = Math.max(1, ids.length);
		const slice = QUAD / n;
		ids.forEach((it, i) => {
			elements.push({
				...it,
				level,
				u0,
				u1,
				v0: qStart + i * slice,
				v1: qStart + (i + 1) * slice,
			});
		});
	};

	// Ensure the focus is the FIRST element of quadrant 1 (so it sits at v=0).
	const lvl1Ordered = [
		focus ? { id: focus.id, label: focus.label, hueKey: focus.memberships[0] ?? focus.id, kind: "node" as const } : null,
		...peers.filter((n) => n.id !== focusId).map((n) => ({
			id: n.id, label: n.label, hueKey: n.memberships[0] ?? n.id, kind: "node" as const,
		})),
	].filter(Boolean) as { id: string; label: string; hueKey: string; kind: "node" }[];

	spread(lvl1Ordered, 1, 0 * QUAD);
	spread(lvl2.map((c) => ({ id: c, label: c, hueKey: c, kind: "cluster" as const })), 2, 1 * QUAD);
	spread(lvl3.map((c) => ({ id: c, label: c, hueKey: c, kind: "cluster" as const })), 3, 2 * QUAD);
	// Level 4 (transition quadrant) is intentionally left without its own
	// elements: bandCentre/bandWidth fall back to the period midpoint there,
	// which equals the periodic continuation of level 1's leading state, so the
	// seam closes. (A future revision may render an explicit morph band.)

	return { elements, focusId, uPeriod };
}

// Seam continuity check (spec §8 #3): the layout is 2π-periodic in v, so the
// band centreline + width must match at v=0 ≡ 2π to C0 (value) and C1 (slope).
export function assertLayoutSeam(meta: DrosteMeta): {
	c0CentreGap: number;
	c0WidthGap: number;
	c1CentreGap: number;
} {
	const h = 1e-4;
	const cLeft = bandCentre(meta, TWO_PI - h);
	const cRight = bandCentre(meta, 0 + h);
	const wLeft = bandWidth(meta, TWO_PI - h);
	const wRight = bandWidth(meta, 0 + h);
	// One-sided derivatives across the seam.
	const dLeft = (bandCentre(meta, TWO_PI - h) - bandCentre(meta, TWO_PI - 2 * h)) / h;
	const dRight = (bandCentre(meta, 0 + 2 * h) - bandCentre(meta, 0 + h)) / h;
	return {
		c0CentreGap: Math.abs(cLeft - cRight),
		c0WidthGap: Math.abs(wLeft - wRight),
		c1CentreGap: Math.abs(dLeft - dRight),
	};
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS — focus at v=0, all within period, seam gaps ≈ 0.

- [ ] **Step 5: Commit**

```bash
git add src/droste-layout.ts test/droste-layout.test.ts test/index.ts
git commit -m "feat: add droste strip layout with C0/C1 seam assertion"
```

---

## Task 7: layout.ts — wire LaidOut.droste + dispatch

**Files:**
- Modify: `src/layout.ts` (import ~line 42; `LaidOut` ~line 144; dispatch ~line 397)

- [ ] **Step 1: Import layoutDroste + DrosteMeta**

In `src/layout.ts`, after `import { layoutLattice } from "./lattice-layout";`, add:

```ts
import { layoutDroste, type DrosteMeta } from "./droste-layout";
```

- [ ] **Step 2: Add the field to LaidOut**

In `interface LaidOut`, after the `lattice?: LatticeMeta;` field, add:

```ts
	// Set when the layout pass produced a Print Gallery (Escher) strip layout.
	// Renderer keys off `droste != null` to apply the conformal projection
	// (laid.nodes / laid.edges stay empty, like lattice/heatmap).
	droste?: DrosteMeta;
```

- [ ] **Step 3: Add the dispatch branch**

In `export function layout(...)`, after `if (opts.viewMode === "lattice") return layoutLattice(data, sized, opts);`, add:

```ts
	if (opts.viewMode === "droste") {
		return {
			nodes: [], edges: [], clusters: [], trunks: [],
			slotW: opts.cellW, slotH: opts.cellH,
			channelW: 0, channelH: 0,
			droste: layoutDroste(data, { focusId: undefined }),
		};
	}
```

> Note: `focusId` is threaded from settings in Task 9 (`view.ts` passes `opts`); for now the layout defaults to the first node. Task 9 adds `drosteFocus` to `LayoutOptions` and forwards it.

- [ ] **Step 4: Verify type-check + tests**

Run: `npx tsc --noEmit && npm test`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/layout.ts
git commit -m "feat: dispatch droste view mode to layoutDroste"
```

---

## Task 8: draw-droste.ts — conformal renderer

**Files:**
- Create: `src/draw-droste.ts`

This task is verified by `tsc` + `build` + manual visual (Canvas2D + DOM can't be unit-tested here). The projection it relies on is already unit-tested in `conformal.ts`.

- [ ] **Step 1: Write the renderer**

Create `src/draw-droste.ts`:

```ts
import type { DrosteMeta, DrosteBandElement } from "./droste-layout";
import { drosteForward, subdivideSegment, type DrosteParams, type StripPoint } from "./conformal";
import { clusterHue } from "./canvas-utils";

export interface DrawDrosteOpts {
	zoom: number;
	panX: number;
	panY: number;
	canvas: HTMLCanvasElement;
	dpr: number;
	k: number;
	twistDir: "ccw" | "cw";
	copies: number;
	subdiv: number;
	minFontPx: number;
	hoverId: string | null;
}

// Project a strip point (with a copy offset m on v) to device pixels.
function project(
	pt: StripPoint, m: number, p: DrosteParams, o: DrawDrosteOpts,
): { x: number; y: number } {
	const z = drosteForward(pt.u, pt.v + 2 * Math.PI * m, p);
	// world → screen → device. Centre z at the canvas middle.
	const cx = o.canvas.width / 2;
	const cy = o.canvas.height / 2;
	return {
		x: cx + (z.re * o.zoom + o.panX) * o.dpr,
		y: cy + (z.im * o.zoom + o.panY) * o.dpr,
	};
}

function polyline(
	ctx: CanvasRenderingContext2D, a: StripPoint, b: StripPoint, m: number,
	p: DrosteParams, o: DrawDrosteOpts,
): void {
	const pts = subdivideSegment(a, b, o.subdiv);
	pts.forEach((sp, i) => {
		const d = project(sp, m, p, o);
		if (i === 0) ctx.moveTo(d.x, d.y);
		else ctx.lineTo(d.x, d.y);
	});
}

// One band element = a strip-space rectangle [u0,u1]×[v0,v1] → warped quad.
function strokeElement(
	ctx: CanvasRenderingContext2D, e: DrosteBandElement, m: number,
	p: DrosteParams, o: DrawDrosteOpts,
): void {
	const hue = clusterHue(e.hueKey);
	ctx.beginPath();
	polyline(ctx, { u: e.u0, v: e.v0 }, { u: e.u1, v: e.v0 }, m, p, o);
	polyline(ctx, { u: e.u1, v: e.v0 }, { u: e.u1, v: e.v1 }, m, p, o);
	polyline(ctx, { u: e.u1, v: e.v1 }, { u: e.u0, v: e.v1 }, m, p, o);
	polyline(ctx, { u: e.u0, v: e.v1 }, { u: e.u0, v: e.v0 }, m, p, o);
	ctx.closePath();
	ctx.fillStyle = e.kind === "cluster"
		? `hsla(${hue}, 60%, 50%, 0.18)`
		: `hsla(${hue}, 60%, 55%, 0.32)`;
	ctx.fill();
	ctx.lineWidth = (e.id === o.hoverId ? 2.4 : 1.2) * o.dpr;
	ctx.strokeStyle = `hsla(${hue}, 70%, 70%, 0.9)`;
	ctx.stroke();
	// Upright label at the warped centroid (spec §7 — known compromise).
	const c = project({ u: (e.u0 + e.u1) / 2, v: (e.v0 + e.v1) / 2 }, m, p, o);
	// Local scale ≈ |γ|·|z|·zoom; hide below the font floor.
	const scaleSample = project({ u: e.u0, v: (e.v0 + e.v1) / 2 }, m, p, o);
	const localPx = Math.hypot(c.x - scaleSample.x, c.y - scaleSample.y);
	if (localPx >= o.minFontPx * o.dpr) {
		ctx.fillStyle = "#e6ecf5";
		ctx.font = `${Math.min(localPx * 0.5, 16 * o.dpr)}px sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(e.label, c.x, c.y);
	}
}

export function drawDroste(
	ctx: CanvasRenderingContext2D, meta: DrosteMeta, o: DrawDrosteOpts,
): void {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = "#0f1116";
	ctx.fillRect(0, 0, o.canvas.width, o.canvas.height);
	const p: DrosteParams = {
		k: o.k,
		twistDir: o.twistDir === "ccw" ? 1 : -1,
		R0: Math.min(o.canvas.width, o.canvas.height) / (4 * o.dpr),
	};
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	// Back-to-front: outer (large/coarse) first, inner (small/fine) last on top.
	for (let m = o.copies - 1; m >= 0; m--) {
		for (const e of meta.elements) strokeElement(ctx, e, m, p, o);
	}
}
```

- [ ] **Step 2: Verify type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both PASS (exit 0).

- [ ] **Step 3: Commit**

```bash
git add src/draw-droste.ts
git commit -m "feat: add conformal Droste renderer (subdivided polylines, back-to-front copies)"
```

---

## Task 9: view.ts — dispatch, panel controls, hit-test + re-root

**Files:**
- Modify: `src/layout.ts` (`LayoutOptions` add `drosteFocus`; dispatch forwards it)
- Modify: `src/view.ts` (imports; `layout()` call ~line 1429; `draw()` ~line 2021; panel ~line 864; hit-test ~line 2415; click handler)

- [ ] **Step 1: Thread drosteFocus through LayoutOptions**

In `src/layout.ts` `interface LayoutOptions`, after `bipartitePrev?: ...`, add:

```ts
	// Print Gallery: id of the node placed at the bottom-left corner (v=0).
	drosteFocus?: string;
```

Then in the `layout()` droste branch (Task 7 Step 3), change `focusId: undefined` to `focusId: opts.drosteFocus`.

- [ ] **Step 2: Forward the setting from view.ts**

In `src/view.ts`, in the `this.laid = layout(layoutData, sized, { ... })` options object (~line 1429), add:

```ts
			drosteFocus: this.settings.drosteFocus,
```

- [ ] **Step 3: Import + dispatch the renderer in draw()**

In `src/view.ts`, add near the other draw imports:

```ts
import { drawDroste } from "./draw-droste";
```

In `private draw()`, immediately after the `lattice` dispatch block (the one that `return`s ~line 2051), add:

```ts
		// Print Gallery (Escher): conformal Droste warp of the strip layout.
		if (this.laid.droste && this.laid.droste.elements.length > 0) {
			drawDroste(ctx, this.laid.droste, {
				zoom: this.zoom,
				panX: this.panX,
				panY: this.panY,
				canvas: this.canvas,
				dpr,
				k: this.settings.drosteZoom,
				twistDir: this.settings.drosteTwistDir,
				copies: this.settings.drosteCopies,
				subdiv: this.settings.drosteSubdiv,
				minFontPx: this.settings.minFontPx,
				hoverId: this.hoveredNodeId,
			});
			return;
		}
```

- [ ] **Step 4: Add panel controls (GRAPH DISPLAY section)**

In `src/view.ts`, locate where heatmap-specific controls are added (the `if (this.settings.viewMode === "heatmap") { ... }` block ~line 868). After it, add an analogous block. Use the existing slider/dropdown helpers already imported (`renderToggleSectionFn` etc.); the minimal direct form using Obsidian `Setting` is not available here, so follow the pattern used by the heatmap block in the same method. Concretely, append:

```ts
		if (this.settings.viewMode === "droste") {
			this.addPanelSlider(el, "Scale per loop (k)", 1.5, 16, 0.5,
				this.settings.drosteZoom, (v) => { this.settings.drosteZoom = v; });
			this.addPanelSlider(el, "Recursion copies", 1, 8, 1,
				this.settings.drosteCopies, (v) => { this.settings.drosteCopies = Math.round(v); });
			this.addPanelSlider(el, "Edge subdivision", 4, 64, 4,
				this.settings.drosteSubdiv, (v) => { this.settings.drosteSubdiv = Math.round(v); });
			this.addPanelToggle(el, "Clockwise twist",
				this.settings.drosteTwistDir === "cw",
				(on) => { this.settings.drosteTwistDir = on ? "cw" : "ccw"; });
		}
```

> If `addPanelSlider` / `addPanelToggle` helpers do not already exist on the view, implement them once by copying the slider/toggle construction the heatmap block uses (search the method for `setLimits` / checkbox creation and extract a 6-line helper). Each onChange must call `await this.saveSettings()` then `this.scheduleDraw()` (match the surrounding handlers' exact calls — grep the heatmap block for the precise method names).

- [ ] **Step 5: Hit-test via inverse map (hover + click re-root)**

In `src/view.ts`, find the pointer handler that calls `this.hitTest(...)` / `this.screenToWorld(...)`. Add a droste-specific branch that, when `this.laid.droste` is set, inverts the conformal map over the **drawn copy range** and picks the front-most hit. Add this helper method to the class:

```ts
	private drosteHitTest(sx: number, sy: number): string | null {
		const d = this.laid.droste;
		if (!d) return null;
		const dpr = window.devicePixelRatio || 1;
		const R0 = Math.min(this.canvas.width, this.canvas.height) / (4 * dpr);
		const p = {
			k: this.settings.drosteZoom,
			twistDir: this.settings.drosteTwistDir === "ccw" ? 1 as const : -1 as const,
			R0,
		};
		// device pixel → world complex z (inverse of draw-droste project()).
		const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
		const z = {
			re: ((sx * dpr - cx) / dpr - this.panX) / this.zoom,
			im: ((sy * dpr - cy) / dpr - this.panY) / this.zoom,
		};
		// Try front-most (largest m = innermost/finest) first.
		for (let m = this.settings.drosteCopies - 1; m >= 0; m--) {
			const { u, vRaw } = drosteInverseBranch(z, p, m);
			const v = ((vRaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
			for (const e of d.elements) {
				if (u >= e.u0 && u <= e.u1 && v >= e.v0 && v < e.v1) return e.id;
			}
		}
		return null;
	}
```

Add the import at the top of `view.ts`:

```ts
import { drosteInverseBranch } from "./conformal";
```

Wire it into the existing pointer-move and click handlers: when `this.laid.droste` is set, use `this.drosteHitTest(offsetX, offsetY)`; on move set `this.hoveredNodeId` to the result (then `scheduleDraw`); on click, if the hit id is a node, `this.openFile(id)`, and additionally set `this.settings.drosteFocus = id` then `await this.saveSettings()` to re-root (the rebuild will re-centre the layout on the clicked node). Match the exact handler names by grepping for the current `mousemove` / `click` registrations near `this.hitTest`.

- [ ] **Step 6: Verify type-check + build + tests**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: all three PASS.

- [ ] **Step 7: Manual visual check**

Build, copy `main.js`/`manifest.json`/`styles.css` into a test vault's `.obsidian/plugins/tag-lens/`, reload, open Tag Lens, pick "Print Gallery (Escher)". Verify: (a) a spiral of nested frames appears; (b) the focus node sits bottom-left; (c) the four perimeter sides carry node-peers → group → peer-groups; (d) hovering highlights; (e) clicking a node re-roots the spiral; (f) changing "Scale per loop" / "Clockwise twist" updates live.

- [ ] **Step 8: Commit**

```bash
git add src/layout.ts src/view.ts
git commit -m "feat: wire droste view — draw dispatch, panel controls, conformal hit-test + re-root"
```

---

## Task 10: README + release-readiness

**Files:**
- Modify: `README.md` (View modes table; Experimental row ~line with "Experimental (beta)")

- [ ] **Step 1: Document the mode**

In `README.md`, update the Experimental (beta) row of the View modes table to mention the new mode, e.g. append to that row's description: "; **Print Gallery (Escher)** — the hierarchy warped by the Droste conformal map so it spirals into itself."

- [ ] **Step 2: Final full verification**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: all PASS. Confirms the CI (ci.yml: install → tsc → build) will be green; the test harness is local (not yet in CI).

- [ ] **Step 3: (Optional) add tests to CI**

If desired, add a `- name: Test\n  run: npm test` step to `.github/workflows/ci.yml` after the type-check step. (Left optional — confirm with the user.)

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document Print Gallery (Escher) beta view mode"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §1 hierarchy→perimeter mapping → Task 6 (`layoutDroste` quadrant assignment).
- §2 coordinate system / γ → Task 1 (`conformal.ts`), locked by Task 2.
- §3 rendering pipeline (subdivide, project, back-to-front, upright text) → Tasks 3, 8.
- §4 multi-copy hit-test (drawn-set branch range, front-most) → Task 9 Step 5.
- §5 default k=2.5 → Task 4 Step 4, Task 5.
- §6 settings (5 fields, validation) → Tasks 4, 5; panel → Task 9 Step 4.
- §7 upright-text compromise → Task 8 (labels) + README/code comments.
- §8 verification asserts: round-trip (Task 1), scale-periodicity + angle-closure (Task 2), seam C0/C1 (Task 6).
- §9 affected files → all created/modified across Tasks 4–10.
- §10 out-of-scope (infinite zoom, animation, text rotation) → not in any task (correct).

**Placeholder scan:** No TBD/TODO/"handle edge cases" left. Two steps (Task 9 Steps 4–5) reference matching existing handler/​helper names by grep rather than quoting them verbatim, because those private method names are not yet confirmed in this plan's context; the step gives the exact pattern to copy and the exact calls required (`saveSettings`, `scheduleDraw`, `openFile`). Flagged here so the executor knows to resolve them against the live file.

**Type consistency:** `DrosteParams`/`Complex`/`StripPoint` (conformal.ts) and `DrosteMeta`/`DrosteBandElement` (droste-layout.ts) are used with identical field names across Tasks 1, 3, 6, 8, 9. `drosteForward`/`drosteInverseBranch`/`subdivideSegment` signatures match between definition (Tasks 1, 3) and use (Tasks 8, 9). Settings field names (`drosteZoom`/`drosteTwistDir`/`drosteCopies`/`drosteSubdiv`/`drosteFocus`) are identical in types.ts, main.ts, layout.ts, view.ts.

**Known executor caveat:** Task 9 Steps 4–5 are integration glue into a 117 KB file; the executor must read the surrounding pointer-handler / panel code and adapt the provided blocks to the exact local method names. All *logic* is specified; only the *attachment points* need live confirmation.
