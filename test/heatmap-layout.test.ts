import { test } from "node:test";
import * as assert from "node:assert";
import { layoutHeatmap } from "../src/layout/heatmap-layout";
import type { GraphData } from "../src/types";
import type { LayoutOptions } from "../src/layout/layout";

// Regression guard for the heatmap cell→notes mapping that backs
// `openHeatmapDetail`. The reported bug was: clicking the battle×battle
// DIAGONAL opened a DIFFERENT tag's notes ("sequence"). The root invariant
// that prevents this is that `tags[r]` and `nodeIds[r]` are produced from the
// SAME display order, so for the diagonal (i === j) `nodeIds[i]` is exactly the
// set of notes carrying `tags[i]`, and for an off-diagonal (i !== j) the click
// handler's set-intersection of `nodeIds[i]` and `nodeIds[j]` equals the notes
// carrying BOTH tags. If a future seriation/drop refactor desynchronises the
// two parallel arrays, these assertions fail loudly instead of silently
// opening the wrong tag's notes.

function opts(over: Partial<LayoutOptions> = {}): LayoutOptions {
	return {
		clusterLabels: new Map<string, string>(),
		heatmapMinTagSize: 1,
		heatmapCriterion: "size", // deterministic order (size-desc, alpha tiebreak)
		heatmapSortDir: "desc",
		nodeSpacing: 16,
		minFontPx: 8,
		cellW: 80,
		cellH: 24,
		// Remaining LayoutOptions fields are unused by layoutHeatmap.
	} as unknown as LayoutOptions;
}

// Build a small vault: battle has 4 notes, sequence 3, scene 2. battle∩sequence
// share exactly 1 note (b3==s1). The mix mirrors the live bug: battle and
// sequence are different tags whose diagonals must stay separate.
function makeData(): GraphData {
	const node = (id: string, tags: string[]) =>
		({ id, label: id, memberships: tags, mtime: 0, aliases: [] }) as unknown as GraphData["nodes"][number];
	return {
		nodes: [
			node("b1", ["battle"]),
			node("b2", ["battle"]),
			node("shared", ["battle", "sequence"]),
			node("b4", ["battle", "scene"]),
			node("s2", ["sequence"]),
			node("s3", ["sequence"]),
			node("sc1", ["scene"]),
		],
		edges: [],
	} as GraphData;
}

// Replicate the click handler's set logic (src/view.ts openHeatmapDetail).
function cellNotes(h: ReturnType<typeof layoutHeatmap>["heatmap"], i: number, j: number): string[] {
	const a = h!.nodeIds[i] ?? [];
	if (i === j) return [...new Set(a)];
	const setB = new Set(h!.nodeIds[j] ?? []);
	return [...new Set(a.filter((id) => setB.has(id)))];
}

test("heatmap diagonal click opens exactly that tag's notes (not another tag's)", () => {
	const h = layoutHeatmap(makeData(), opts()).heatmap!;
	assert.ok(h, "heatmap meta produced");

	// Find each tag's display index by label, then assert its diagonal nodeIds.
	const idx = (label: string) => h.tags.findIndex((t) => t.label === label);
	const iBattle = idx("battle");
	const iSequence = idx("sequence");
	const iScene = idx("scene");
	assert.ok(iBattle >= 0 && iSequence >= 0 && iScene >= 0, "all tags present");

	// tags[r] and nodeIds[r] must be the SAME tag — the core anti-bug invariant.
	assert.deepStrictEqual(
		cellNotes(h, iBattle, iBattle).sort(),
		["b1", "b2", "b4", "shared"],
		"battle diagonal must open battle notes",
	);
	assert.deepStrictEqual(
		cellNotes(h, iSequence, iSequence).sort(),
		["s2", "s3", "shared"],
		"sequence diagonal must open sequence notes",
	);
	// The diagonal count metadata also matches the tag size.
	assert.strictEqual(h.counts[iBattle * h.n + iBattle], 4);
	assert.strictEqual(h.counts[iSequence * h.n + iSequence], 3);
});

test("heatmap off-diagonal click opens the tag-pair intersection only", () => {
	const h = layoutHeatmap(makeData(), opts()).heatmap!;
	const idx = (label: string) => h.tags.findIndex((t) => t.label === label);
	const iBattle = idx("battle");
	const iSequence = idx("sequence");
	const iScene = idx("scene");

	assert.deepStrictEqual(cellNotes(h, iBattle, iSequence).sort(), ["shared"]);
	assert.deepStrictEqual(cellNotes(h, iBattle, iScene).sort(), ["b4"]);
	// scene∩sequence share nothing.
	assert.deepStrictEqual(cellNotes(h, iScene, iSequence), []);
	// Symmetric: (i,j) and (j,i) yield the same intersection.
	assert.deepStrictEqual(
		cellNotes(h, iSequence, iBattle).sort(),
		cellNotes(h, iBattle, iSequence).sort(),
	);
	// Off-diagonal count metadata matches.
	assert.strictEqual(h.counts[iBattle * h.n + iSequence], 1);
});

test("tags[] and nodeIds[] stay index-aligned under seriation order", () => {
	// Each tag's nodeIds must contain exactly the notes whose memberships
	// include tags[r].key — for EVERY display row, regardless of order.
	const data = makeData();
	const h = layoutHeatmap(data, opts({ heatmapCriterion: "co-occurrence" } as Partial<LayoutOptions>)).heatmap!;
	for (let r = 0; r < h.n; r++) {
		const key = h.tags[r].key; // membership key for this display row
		const expected = data.nodes
			.filter((n) => n.memberships.includes(key))
			.map((n) => n.id)
			.sort();
		assert.deepStrictEqual(
			[...new Set(h.nodeIds[r])].sort(),
			expected,
			`nodeIds[${r}] must match notes carrying tag "${h.tags[r].label}"`,
		);
	}
});
