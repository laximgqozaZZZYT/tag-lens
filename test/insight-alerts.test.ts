import { ok } from "./assert";
import { findRedundantTagPairs, findOverbroadTags } from "../src/insight/compute";

// ── findRedundantTagPairs ────────────────────────────────────────────────────

// Identical member sets → Jaccard = 1.0
{
	const tagMembers = new Map<string, Set<string>>([
		["alpha", new Set(["a", "b", "c", "d", "e"])],
		["beta",  new Set(["a", "b", "c", "d", "e"])],
		["gamma", new Set(["x", "y", "z"])],
	]);
	const result = findRedundantTagPairs(tagMembers, 0.9, 10);
	ok(result.length === 1, `Redundant: expected 1 pair, got ${result.length}`);
	ok(result[0].jaccard === 1.0, `Redundant: expected Jaccard 1.0, got ${result[0].jaccard}`);
	const pair = [result[0].a, result[0].b].sort();
	ok(pair[0] === "alpha" && pair[1] === "beta", `Redundant: expected alpha↔beta, got ${pair}`);
}

// Disjoint sets → no pairs
{
	const tagMembers = new Map<string, Set<string>>([
		["a", new Set(["1", "2", "3"])],
		["b", new Set(["4", "5", "6"])],
	]);
	ok(findRedundantTagPairs(tagMembers, 0.9, 10).length === 0, "Redundant: disjoint sets should return 0");
}

// Singleton tags are skipped (size < 2)
{
	const tagMembers = new Map<string, Set<string>>([
		["solo", new Set(["x"])],
		["also-solo", new Set(["x"])],
	]);
	ok(findRedundantTagPairs(tagMembers, 0.5, 10).length === 0, "Redundant: singleton tags should be skipped");
}

// Boundary: 9/10 shared = Jaccard ≈ 0.818 (< 0.9) when each has 1 unique
// Actually: |A∩B|=9, |A∪B|=11 → 9/11 ≈ 0.818 → below 0.9
{
	const shared = ["1","2","3","4","5","6","7","8","9"];
	const tagMembers = new Map<string, Set<string>>([
		["x", new Set([...shared, "a"])],
		["y", new Set([...shared, "b"])],
	]);
	const result = findRedundantTagPairs(tagMembers, 0.9, 10);
	ok(result.length === 0, `Redundant: 9/11 Jaccard should be below 0.9, got ${result.length} results`);
}

// Exact threshold: 9 shared, 1 only in A → |A|=10, |B|=9, inter=9, union=10 → J=0.9
{
	const shared = ["1","2","3","4","5","6","7","8","9"];
	const tagMembers = new Map<string, Set<string>>([
		["x", new Set([...shared, "a"])],
		["y", new Set(shared)],
	]);
	const result = findRedundantTagPairs(tagMembers, 0.9, 10);
	ok(result.length === 1, `Redundant: 9/10 Jaccard should meet 0.9 threshold, got ${result.length}`);
}

// maxResults cap
{
	const tagMembers = new Map<string, Set<string>>([
		["a", new Set(["1", "2", "3"])],
		["b", new Set(["1", "2", "3"])],
		["c", new Set(["1", "2", "3"])],
	]);
	const result = findRedundantTagPairs(tagMembers, 0.9, 2);
	ok(result.length === 2, `Redundant: maxResults=2 should cap at 2, got ${result.length}`);
}

// ── findOverbroadTags ────────────────────────────────────────────────────────

// Basic detection
{
	const tagCounts = new Map<string, number>([
		["broad", 50],
		["normal", 30],
		["narrow", 5],
	]);
	const result = findOverbroadTags(tagCounts, 100, 0.4);
	ok(result.length === 1, `Overbroad: expected 1, got ${result.length}`);
	ok(result[0].tag === "broad", `Overbroad: expected 'broad', got '${result[0].tag}'`);
	ok(result[0].count === 50, `Overbroad: expected count 50, got ${result[0].count}`);
	ok(Math.abs(result[0].ratio - 0.5) < 0.001, `Overbroad: expected ratio 0.5, got ${result[0].ratio}`);
}

// No tags exceed threshold
{
	const tagCounts = new Map<string, number>([
		["a", 10],
		["b", 20],
	]);
	ok(findOverbroadTags(tagCounts, 100, 0.4).length === 0, "Overbroad: no tags over threshold → empty");
}

// Empty vault
ok(findOverbroadTags(new Map(), 0, 0.4).length === 0, "Overbroad: empty vault → empty");

// Sort by ratio descending
{
	const tagCounts = new Map<string, number>([
		["big", 80],
		["bigger", 90],
	]);
	const result = findOverbroadTags(tagCounts, 100, 0.4);
	ok(result.length === 2, `Overbroad: expected 2, got ${result.length}`);
	ok(result[0].tag === "bigger", `Overbroad: first should be 'bigger', got '${result[0].tag}'`);
	ok(result[1].tag === "big", `Overbroad: second should be 'big', got '${result[1].tag}'`);
}
