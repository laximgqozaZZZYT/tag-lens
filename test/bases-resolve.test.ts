// Bases filter-evaluation tests. evalBaseFilter is pure over FileFacts.
import { ok } from "./assert";
import { evalBaseFilter, resolveElements } from "../src/bases/resolve";
import { parseBaseFilter } from "../src/bases/parser";
import type { FileFacts } from "../src/query/query";
import type { BaseTable, BaseView } from "../src/bases/types";

function facts(path: string, tags: string[], fm: Record<string, unknown> = {}): FileFacts {
	return { path, tags, frontmatter: fm };
}

// --- tag contains (leading # optional on both sides) ---
{
	const f = facts("a.md", ["proj/x", "wip"]);
	ok(evalBaseFilter(parseBaseFilter('file.tags.contains("#wip")'), f), "contains matches with # in cond");
	ok(evalBaseFilter(parseBaseFilter('file.tags.contains("wip")'), f), "contains matches without #");
	ok(!evalBaseFilter(parseBaseFilter('file.tags.contains("nope")'), f), "non-member tag fails");
}

// --- and / or ---
{
	const f = facts("note.md", ["a"], { status: "open" });
	ok(
		evalBaseFilter(parseBaseFilter({ and: ['file.tags.contains("a")', 'note.status == "open"'] }), f),
		"and: both true",
	);
	ok(
		!evalBaseFilter(parseBaseFilter({ and: ['file.tags.contains("a")', 'note.status == "closed"'] }), f),
		"and: one false → false",
	);
	ok(
		evalBaseFilter(parseBaseFilter({ or: ['file.tags.contains("zzz")', 'note.status == "open"'] }), f),
		"or: one true → true",
	);
	ok(
		!evalBaseFilter(parseBaseFilter({ or: ['file.tags.contains("zzz")', 'note.status == "x"'] }), f),
		"or: none true → false",
	);
}

// --- comparisons (numeric + string + file.* fields) ---
{
	const f = facts("dir/My Note.md", [], { count: 5 });
	ok(evalBaseFilter(parseBaseFilter("note.count >= 5"), f), "numeric >= true");
	ok(evalBaseFilter(parseBaseFilter("note.count > 4"), f), "numeric > true");
	ok(!evalBaseFilter(parseBaseFilter("note.count < 5"), f), "numeric < false");
	ok(evalBaseFilter(parseBaseFilter('file.ext == "md"'), f), "file.ext resolved");
	ok(evalBaseFilter(parseBaseFilter('file.basename == "My Note"'), f), "file.basename resolved");
	ok(evalBaseFilter(parseBaseFilter('file.name == "My Note.md"'), f), "file.name resolved");
	ok(evalBaseFilter(parseBaseFilter('file.name != "Other.md"'), f), "!= compare");
}

// --- unsupported (raw) condition is IGNORED (not constraining) ---
{
	const f = facts("a.md", ["a"]);
	const filt = parseBaseFilter({ and: ['file.tags.contains("a")', "some weird %% raw clause"] });
	ok(evalBaseFilter(filt, f), "raw child under AND is skipped → still matches");

	const onlyRaw = parseBaseFilter("totally opaque clause %%");
	ok(evalBaseFilter(onlyRaw, f), "standalone raw → no constraint (true)");

	const orRaw = parseBaseFilter({ or: ["opaque %% clause", 'file.tags.contains("zzz")'] });
	ok(!evalBaseFilter(orRaw, f), "raw under OR contributes nothing → false when no real child matches");
}

// --- multi-value tag operators (the real bug: containsAny matched 0 notes) ---
{
	const f = facts("a.md", ["書籍", "wip"]);
	ok(
		evalBaseFilter(parseBaseFilter('file.tags.containsAny("書籍", "小説")'), f),
		"containsAny: one arg present → true",
	);
	ok(
		!evalBaseFilter(parseBaseFilter('file.tags.containsAny("小説", "漫画")'), f),
		"containsAny: none present → false",
	);
	ok(
		!evalBaseFilter(parseBaseFilter('file.tags.containsAll("書籍", "小説")'), f),
		"containsAll: missing one → false",
	);
	ok(
		evalBaseFilter(parseBaseFilter('file.tags.containsAll("書籍", "wip")'), f),
		"containsAll: all present → true",
	);
	ok(
		evalBaseFilter(parseBaseFilter('file.tags.containsNone("小説", "漫画")'), f),
		"containsNone: none present → true",
	);
	ok(
		!evalBaseFilter(parseBaseFilter('file.tags.containsNone("書籍")'), f),
		"containsNone: one present → false",
	);
	// leading # optional on both sides, matching single-value contains.
	ok(evalBaseFilter(parseBaseFilter('file.tags.containsAny("#書籍")'), f), "containsAny: # optional");
}

// --- startsWith / endsWith over scalar fields ---
{
	const f = facts("dir/Report 2026.md", [], { title: "Weekly Report" });
	ok(evalBaseFilter(parseBaseFilter('file.basename.startsWith("Report")'), f), "startsWith true");
	ok(!evalBaseFilter(parseBaseFilter('file.basename.startsWith("xyz")'), f), "startsWith false");
	ok(evalBaseFilter(parseBaseFilter('note.title.endsWith("Report")'), f), "endsWith true");
	ok(!evalBaseFilter(parseBaseFilter('note.title.endsWith("Daily")'), f), "endsWith false");
}

// --- containsAny over a non-tag array frontmatter field ---
{
	const f = facts("a.md", [], { authors: ["Ada", "Grace"] });
	ok(evalBaseFilter(parseBaseFilter('note.authors.containsAny("Grace", "Alan")'), f), "array field containsAny");
	ok(!evalBaseFilter(parseBaseFilter('note.authors.containsAll("Grace", "Alan")'), f), "array field containsAll false");
}

// --- unknown operator falls back to false (never throws) ---
{
	const f = facts("a.md", ["a"]);
	// a cond with an unrecognised op is parsed but must not throw and must not match.
	ok(!evalBaseFilter({ cond: { lhs: "note.x", op: "wat", rhs: "y" } }, f), "unknown operator → false (no throw)");
}

// --- null filter matches everything ---
{
	ok(evalBaseFilter(null, facts("x.md", [])), "null filter → true");
}

// --- resolveElements: filtering + fields + tags + links ---
{
	const table: BaseTable = { filePath: "B.base", name: "B", views: [], formulas: {} };
	const view: BaseView = {
		name: "v1",
		type: "table",
		filter: parseBaseFilter('file.tags.contains("keep")'),
		columns: ["file.name", "note.status", "file.tags"],
	};
	const factsByPath = new Map<string, FileFacts>([
		["a.md", facts("a.md", ["keep"], { status: "open" })],
		["b.md", facts("b.md", ["drop"], { status: "open" })],
		["c.md", facts("c.md", ["keep"], { status: "done" })],
	]);
	const forward = new Map<string, string[]>([["a.md", ["c.md", "ext.md"]]]);

	const els = resolveElements(table, view, factsByPath, forward);
	ok(els.length === 2, "only the two notes with #keep resolve");
	const a = els.find((e) => e.notePath === "a.md")!;
	ok(a.key === "B.base::v1::a.md", "element key format tablePath::view::note");
	ok(a.fields["file.name"] === "a.md" && a.fields["note.status"] === "open", "fields extracted");
	ok(JSON.stringify(a.links) === JSON.stringify(["c.md", "ext.md"]), "forward links captured");
	ok(JSON.stringify(a.tags) === JSON.stringify(["keep"]), "tags captured");
}

console.log("bases-resolve tests passed");
