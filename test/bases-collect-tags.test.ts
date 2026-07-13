// Bases tag collector tests. Pure — feeds cache-shaped objects, no Obsidian
// runtime. Guards parity with the main pipeline (src/insight/compute.ts): a
// comma-separated frontmatter `tags` string must split into separate tags, not
// collapse into one bogus tag that drops notes out of tag-filtered `.base`s.
import type { CachedMetadata } from "obsidian";
import { collectTags } from "../src/bases/collect-tags";
import { ok } from "./assert";

// Minimal CachedMetadata shape: inline tags + frontmatter.
function cache(opts: { tags?: string[]; fmTags?: unknown }): CachedMetadata {
	const c: Record<string, unknown> = {};
	if (opts.tags) c.tags = opts.tags.map((tag) => ({ tag }));
	if (opts.fmTags !== undefined) c.frontmatter = { tags: opts.fmTags };
	return c as unknown as CachedMetadata;
}

function eq(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((x, i) => x === b[i]);
}

// --- the core bug: comma-separated frontmatter string is split ---
{
	ok(eq(collectTags(cache({ fmTags: "書籍, 小説" })), ["書籍", "小説"]), "comma string → split + trimmed");
	ok(eq(collectTags(cache({ fmTags: "書籍,小説,漫画" })), ["書籍", "小説", "漫画"]), "no-space commas split too");
	ok(eq(collectTags(cache({ fmTags: "solo" })), ["solo"]), "single-value string → one tag");
}

// --- array frontmatter form (with trim + # strip + empty drop) ---
{
	ok(eq(collectTags(cache({ fmTags: ["a", "b"] })), ["a", "b"]), "array form preserved");
	ok(eq(collectTags(cache({ fmTags: ["#a", " b ", ""] })), ["a", "b"]), "array: # stripped, trimmed, empty dropped");
}

// --- inline cache.tags + frontmatter combine; leading # stripped ---
{
	ok(
		eq(collectTags(cache({ tags: ["#inline"], fmTags: "書籍, 小説" })), ["inline", "書籍", "小説"]),
		"inline tags first, then split frontmatter",
	);
}

// --- edge cases: null cache, empty/blank, whitespace-only pieces ---
{
	ok(eq(collectTags(null), []), "null cache → []");
	ok(eq(collectTags(cache({ fmTags: "" })), []), "empty string → []");
	ok(eq(collectTags(cache({ fmTags: " , , " })), []), "blank comma pieces dropped");
	ok(eq(collectTags(cache({})), []), "no tags at all → []");
}

console.log("bases-collect-tags tests passed");
