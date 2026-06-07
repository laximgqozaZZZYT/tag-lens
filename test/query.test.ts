// Query engine tests. Covers the nested-tag hierarchy extension (tagN:) and,
// once Patch B lands, the tag-page frontmatter join (tag.<key>:). The base
// AND/OR/NOT/wildcard behaviour is exercised indirectly here too.
import { ok } from "./assert";
import { parseQuery, evalQuery, isMatched, type FileFacts } from "../src/query";

function facts(tags: string[], frontmatter: Record<string, unknown> = {}): FileFacts {
	return { path: "n.md", tags, frontmatter };
}

// distinct bound values for a single-binding GROUP_BY key, sorted for stable compare
function boundValues(ast: ReturnType<typeof parseQuery>, f: FileFacts, key: string): string[] {
	const r = evalQuery(ast, f);
	return r.instances.map((m) => m.get(key) ?? "").sort();
}

// === Patch A: nested-tag hierarchy (tagN:) ===

// tag1:* collapses nested tags to their top-level segment, de-duplicated.
{
	const f = facts(["Programming/Python", "Programming/Rust", "Writing"]);
	ok(
		JSON.stringify(boundValues(parseQuery("tag1:*"), f, "tag")) ===
			JSON.stringify(["Programming", "Writing"]),
		"tag1:* collapses to distinct top-level segments",
	);
}

// tag2:* keeps two segments.
{
	const f = facts(["Programming/Python/Django", "Programming/Rust", "Writing"]);
	ok(
		JSON.stringify(boundValues(parseQuery("tag2:*"), f, "tag")) ===
			JSON.stringify(["Programming/Python", "Programming/Rust", "Writing"]),
		"tag2:* keeps first two path segments",
	);
}

// Plain tag:* is unchanged (whole nested path).
{
	const f = facts(["Programming/Python", "Writing"]);
	ok(
		JSON.stringify(boundValues(parseQuery("tag:*"), f, "tag")) ===
			JSON.stringify(["Programming/Python", "Writing"]),
		"tag:* still partitions by full nested path",
	);
}

// tagN:literal is a SUBTREE match: tag1:Programming matches Programming/anything.
{
	const f = facts(["Programming/Python"]);
	ok(isMatched(evalQuery(parseQuery("tag1:Programming"), f)), "tag1:Programming matches a child tag");
	ok(!isMatched(evalQuery(parseQuery("tag:Programming"), f)), "tag:Programming (no depth) stays exact — no match on a child");
	ok(isMatched(evalQuery(parseQuery("tag:Programming/Python"), f)), "tag: exact still matches the full path");
}

// Subtree exclusion: -tag1:todo removes a note tagged todo OR todo/*.
{
	ok(!isMatched(evalQuery(parseQuery("-tag1:todo"), facts(["todo"]))), "-tag1:todo excludes exact todo");
	ok(!isMatched(evalQuery(parseQuery("-tag1:todo"), facts(["todo/urgent"]))), "-tag1:todo excludes todo subtree");
	ok(isMatched(evalQuery(parseQuery("-tag1:todo"), facts(["project"]))), "-tag1:todo keeps unrelated tags");
}

// Combines with the rest of the grammar.
{
	const f = facts(["Programming/Python", "todo"]);
	ok(
		!isMatched(evalQuery(parseQuery("tag1:Programming AND -tag1:todo"), f)),
		"tagN composes with AND/NOT",
	);
}
