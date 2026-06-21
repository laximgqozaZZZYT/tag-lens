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
