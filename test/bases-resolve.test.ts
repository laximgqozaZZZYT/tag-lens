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

// --- `*tags` frontmatter fields must NOT be routed to file.tags ---
{
	// subtags is a frontmatter array; the file's real tags are ["書籍"]. The loose
	// /tags$/ used to evaluate note.subtags against facts.tags (書籍), ignoring the
	// property entirely.
	const f = facts("a.md", ["書籍"], { subtags: ["x", "y"], booktags: ["a"] });
	ok(evalBaseFilter(parseBaseFilter('note.subtags.contains("x")'), f), "note.subtags reads the frontmatter field (has x)");
	ok(
		!evalBaseFilter(parseBaseFilter('note.subtags.contains("書籍")'), f),
		"note.subtags does NOT see the file tag 書籍",
	);
	ok(
		evalBaseFilter(parseBaseFilter('note.booktags.containsAny("a", "b")'), f),
		"multi-value operators on a *tags field also hit the frontmatter",
	);
	// regression: the canonical tag fields still address the note's tag set.
	ok(evalBaseFilter(parseBaseFilter('file.tags.contains("書籍")'), f), "file.tags still reads file tags");
	const g = facts("g.md", ["keep"], {});
	ok(evalBaseFilter(parseBaseFilter('note.tags.contains("keep")'), g), "note.tags still routes to file tags");
}

// --- negation: `!pred` and `pred == false` must EXCLUDE, not pass everything ---
{
	const book = facts("book.md", ["書籍"]);
	const other = facts("other.md", ["雑記"]);
	// The real bug: a negated exclusion was dropped to { raw } → ignored → true.
	ok(!evalBaseFilter(parseBaseFilter('!file.tags.contains("書籍")'), book), "!contains excludes the tagged note");
	ok(evalBaseFilter(parseBaseFilter('!file.tags.contains("書籍")'), other), "!contains keeps the untagged note");
	// Bases-native boolean-predicate form behaves the same.
	ok(!evalBaseFilter(parseBaseFilter('file.tags.contains("書籍") == false'), book), "`== false` excludes tagged");
	ok(evalBaseFilter(parseBaseFilter('file.tags.contains("書籍") == false'), other), "`== false` keeps untagged");
	// Negation composes under and/or: a true predicate AND its negation → false
	// (pre-fix the negated child was raw-ignored, so the AND wrongly stayed true).
	ok(
		!evalBaseFilter(parseBaseFilter({ and: ['file.tags.contains("書籍")', '!file.tags.contains("書籍")'] }), book),
		"negated child actually constrains an AND",
	);
}

// --- numeric == / != coerce (were string-only, so 3 !== 3.0) ---
{
	const f = facts("n.md", [], { count: 3 });
	ok(evalBaseFilter(parseBaseFilter("note.count == 3"), f), "== 3 matches number 3");
	ok(evalBaseFilter(parseBaseFilter("note.count == 3.0"), f), "== 3.0 matches number 3 (numeric)");
	ok(!evalBaseFilter(parseBaseFilter("note.count != 3.0"), f), "!= 3.0 is false for number 3");
	ok(!evalBaseFilter(parseBaseFilter("note.count == 4"), f), "== 4 does not match 3");
	// regression: array field == keeps string membership (not numeric).
	const g = facts("g.md", [], { authors: ["Grace", "Ada"] });
	ok(evalBaseFilter(parseBaseFilter('note.authors == "Grace"'), g), "array == keeps string membership");
}

// --- IN membership: parsed end-to-end, no longer ignored ---
{
	ok(
		evalBaseFilter(parseBaseFilter('note.status IN ("done", "wip")'), facts("a.md", [], { status: "done" })),
		"IN: member value → true",
	);
	ok(
		!evalBaseFilter(parseBaseFilter('note.status IN ("done", "wip")'), facts("a.md", [], { status: "other" })),
		"IN: non-member EXCLUDES (the dead-code bug: was silently kept)",
	);
	// array-valued field: true when any element is listed.
	ok(
		evalBaseFilter(parseBaseFilter('note.authors IN ("Ada")'), facts("a.md", [], { authors: ["Ada", "Grace"] })),
		"IN over an array field matches a listed member",
	);
	// empty list never matches, never throws.
	ok(!evalBaseFilter(parseBaseFilter("note.status IN ()"), facts("a.md", [], { status: "done" })), "IN (): empty → false");
}

// --- official Bases file predicates: hasTag / inFolder / hasProperty ---
{
	const f = facts("Projects/sub/note.md", ["書籍/新刊"], { author: "Ada" });
	ok(evalBaseFilter(parseBaseFilter('file.hasTag("書籍")'), f), "hasTag is nested-aware (書籍 matches 書籍/新刊)");
	ok(evalBaseFilter(parseBaseFilter('file.hasTag("書籍/新刊")'), f), "hasTag exact match");
	ok(!evalBaseFilter(parseBaseFilter('file.hasTag("小説")'), f), "hasTag: absent tag → false");
	ok(evalBaseFilter(parseBaseFilter('file.hasTag("小説", "書籍")'), f), "hasTag: multi-arg is any-of");

	ok(evalBaseFilter(parseBaseFilter('file.inFolder("Projects")'), f), "inFolder matches an ancestor folder");
	ok(evalBaseFilter(parseBaseFilter('file.inFolder("Projects/sub")'), f), "inFolder matches the exact folder");
	ok(!evalBaseFilter(parseBaseFilter('file.inFolder("Proj")'), f), "inFolder is not a bare prefix match");
	ok(!evalBaseFilter(parseBaseFilter('file.inFolder("Other")'), f), "inFolder: different folder → false");
	ok(evalBaseFilter(parseBaseFilter('file.inFolder("")'), facts("root.md", [])), "inFolder(\"\") matches vault root");

	ok(evalBaseFilter(parseBaseFilter('file.hasProperty("author")'), f), "hasProperty: present key → true");
	ok(!evalBaseFilter(parseBaseFilter('file.hasProperty("missing")'), f), "hasProperty: absent key → false");
	ok(!evalBaseFilter(parseBaseFilter('file.hasProperty("toString")'), f), "hasProperty: inherited proto key → false (own keys only)");
}

// --- file.hasLink / file.links (were unsupported → link filters dropped notes) ---
{
	const f: FileFacts = { ...facts("dir/n.md", []), links: ["dir/Target.md", "Other.md"] };
	ok(evalBaseFilter(parseBaseFilter('file.hasLink("Target")'), f), "hasLink by basename");
	ok(evalBaseFilter(parseBaseFilter('file.hasLink("dir/Target")'), f), "hasLink by path (no ext)");
	ok(evalBaseFilter(parseBaseFilter('file.hasLink("dir/Target.md")'), f), "hasLink by full path");
	ok(evalBaseFilter(parseBaseFilter('file.hasLink("[[Target]]")'), f), "hasLink normalises wikilink wrapping");
	ok(evalBaseFilter(parseBaseFilter('file.hasLink("[[Target|Alias]]")'), f), "hasLink drops a display alias");
	ok(evalBaseFilter(parseBaseFilter('file.hasLink("Nope", "Target")'), f), "hasLink is any-of");
	ok(!evalBaseFilter(parseBaseFilter('file.hasLink("Missing")'), f), "hasLink: absent target → false");
	ok(!evalBaseFilter(parseBaseFilter('file.hasLink("Target")'), facts("n.md", [])), "hasLink: no links field → false");
	// file.links resolves to the array → generic list operators work.
	ok(evalBaseFilter(parseBaseFilter('file.links.contains("dir/Target.md")'), f), "file.links.contains works");
	ok(evalBaseFilter(parseBaseFilter('file.links.containsAny("x", "Other.md")'), f), "file.links.containsAny works");
}

// --- file.size / file.ctime / file.mtime (stat) + date-aware comparison ---
{
	const jan2025 = Date.parse("2025-01-01");
	const f: FileFacts = { ...facts("n.md", []), size: 2048, mtime: jan2025, ctime: jan2025 };
	ok(evalBaseFilter(parseBaseFilter("file.size > 1000"), f), "file.size numeric compare");
	ok(!evalBaseFilter(parseBaseFilter("file.size < 1000"), f), "file.size < false");
	// date-string rhs is coerced to epoch (would string-compare without the fix).
	ok(evalBaseFilter(parseBaseFilter('file.mtime > "2024-06-01"'), f), "mtime > earlier date-string → true");
	ok(!evalBaseFilter(parseBaseFilter('file.mtime > "2025-06-01"'), f), "mtime > later date-string → false");
	ok(evalBaseFilter(parseBaseFilter('file.mtime == date("2025-01-01")'), f), 'mtime == date("...") → true');
	ok(evalBaseFilter(parseBaseFilter("file.mtime < now()"), f), "mtime < now() → true");
	ok(evalBaseFilter(parseBaseFilter("file.ctime <= today()"), f), "ctime <= today() → true (past file)");
	ok(evalBaseFilter(parseBaseFilter("file.mtime >= 100"), f), "bare epoch rhs still compares numerically");
	// unset stat → no throw, comparison false.
	ok(!evalBaseFilter(parseBaseFilter("file.size > 1000"), facts("x.md", [])), "unset size → false, no throw");
}

// --- file.backlinks / file.embeds (list accessors, were undefined) ---
{
	const f: FileFacts = { ...facts("n.md", []), backlinks: ["a.md", "b.md"], embeds: ["img/x.png"] };
	ok(evalBaseFilter(parseBaseFilter('file.backlinks.contains("a.md")'), f), "backlinks.contains");
	ok(!evalBaseFilter(parseBaseFilter('file.backlinks.contains("z.md")'), f), "backlinks: absent → false");
	ok(evalBaseFilter(parseBaseFilter('file.backlinks.containsAny("z.md", "b.md")'), f), "backlinks.containsAny");
	ok(evalBaseFilter(parseBaseFilter('file.embeds.contains("img/x.png")'), f), "embeds.contains");
	ok(!evalBaseFilter(parseBaseFilter('file.backlinks.contains("a.md")'), facts("x.md", [])), "no backlinks field → false");
}

// --- file.folder property (was undefined → folder filters dropped every note) ---
{
	const f = facts("Projects/sub/n.md", []);
	ok(evalBaseFilter(parseBaseFilter('file.folder == "Projects/sub"'), f), "file.folder == parent folder → true");
	ok(!evalBaseFilter(parseBaseFilter('file.folder == "Projects"'), f), "file.folder is the full parent path, not an ancestor");
	ok(evalBaseFilter(parseBaseFilter('file.folder.contains("Projects")'), f), "file.folder.contains works");
	ok(evalBaseFilter(parseBaseFilter('file.folder.startsWith("Proj")'), f), "file.folder.startsWith works");
	ok(evalBaseFilter(parseBaseFilter('file.folder == ""'), facts("root.md", [])), "vault-root file → folder is \"\"");
}

// --- isEmpty(): empty/absent value (was unhandled → always false, dropped notes) ---
{
	ok(evalBaseFilter(parseBaseFilter("note.foo.isEmpty()"), facts("a.md", [], {})), "isEmpty: unset field → true");
	ok(evalBaseFilter(parseBaseFilter("note.foo.isEmpty()"), facts("a.md", [], { foo: "" })), "isEmpty: empty string → true");
	ok(evalBaseFilter(parseBaseFilter("note.foo.isEmpty()"), facts("a.md", [], { foo: [] })), "isEmpty: empty list → true");
	ok(!evalBaseFilter(parseBaseFilter("note.foo.isEmpty()"), facts("a.md", [], { foo: "x" })), "isEmpty: value present → false");
	// empty object (e.g. a frontmatter record with no keys) was always false (bug).
	ok(evalBaseFilter(parseBaseFilter("note.meta.isEmpty()"), facts("a.md", [], { meta: {} })), "isEmpty: empty object → true");
	ok(!evalBaseFilter(parseBaseFilter("note.meta.isEmpty()"), facts("a.md", [], { meta: { k: 1 } })), "isEmpty: non-empty object → false");
}

// --- file.properties and file.properties.<key> ---
{
	const f = facts("n.md", [], { author: "Alice", year: 2025 });
	ok(evalBaseFilter(parseBaseFilter('file.properties.author == "Alice"'), f), "file.properties.<key> maps to frontmatter");
	ok(!evalBaseFilter(parseBaseFilter('file.properties.author == "Bob"'), f), "file.properties.<key> mismatch → false");
	// file.properties itself is the frontmatter object → isEmpty() checks object emptiness.
	ok(evalBaseFilter(parseBaseFilter("file.properties.isEmpty()"), facts("e.md", [], {})), "file.properties.isEmpty() → true on empty frontmatter");
	ok(!evalBaseFilter(parseBaseFilter("file.properties.isEmpty()"), f), "file.properties.isEmpty() → false when frontmatter has keys");
}

// --- .length property on list / string fields ---
{
	const f = facts("n.md", ["a", "b", "c"], { authors: ["X", "Y"], title: "Hello" });
	ok(evalBaseFilter(parseBaseFilter("file.tags.length >= 3"), f), "file.tags.length >= 3 → true");
	ok(!evalBaseFilter(parseBaseFilter("file.tags.length > 3"), f), "file.tags.length > 3 → false (exactly 3)");
	ok(evalBaseFilter(parseBaseFilter("note.authors.length == 2"), f), "note.authors.length == 2 → true");
	ok(evalBaseFilter(parseBaseFilter("note.title.length > 0"), f), "note.title.length > 0 (string) → true");
	// empty list → length 0.
	const empty = facts("e.md", []);
	ok(evalBaseFilter(parseBaseFilter("file.tags.length == 0"), empty), "file.tags.length == 0 → true");
	// unset field → length undefined → not numeric → false.
	ok(!evalBaseFilter(parseBaseFilter("note.missing.length > 0"), empty), "unset field.length → undefined → false, no throw");
}

// --- not: structured operator inverts; raw child is ignored (not exclude-all) ---
{
	const book = facts("book.md", ["書籍"]);
	ok(!evalBaseFilter(parseBaseFilter({ not: 'file.hasTag("書籍")' }), book), "not hasTag excludes the tagged note");
	ok(evalBaseFilter(parseBaseFilter({ not: 'file.hasTag("小説")' }), book), "not hasTag keeps the untagged note");
	ok(evalBaseFilter(parseBaseFilter({ not: "some %% unparseable clause" }), book), "not of a raw/unparseable child → ignored (true)");
}

// --- inline && / || evaluate as AND / OR (were raw-ignored) ---
{
	const f = facts("d/n.md", ["x"], { author: "Ada" });
	ok(evalBaseFilter(parseBaseFilter('file.hasTag("x") && note.author == "Ada"'), f), "&&: both true → true");
	ok(!evalBaseFilter(parseBaseFilter('file.hasTag("x") && note.author == "Bob"'), f), "&&: one false → false");
	ok(evalBaseFilter(parseBaseFilter('note.author == "Bob" || file.hasTag("x")'), f), "||: one true → true");
	ok(!evalBaseFilter(parseBaseFilter('note.author == "Bob" || file.hasTag("y")'), f), "||: none true → false");
	// precedence: a || b && c with a true.
	ok(
		evalBaseFilter(parseBaseFilter('note.author == "Ada" || file.hasTag("y") && file.hasTag("z")'), f),
		"a || (b && c): a true short-circuits to true",
	);
}

// --- parenthesised grouping evaluates correctly (grouped operand was ignored) ---
{
	const inD = facts("d/n.md", ["a"]); // has tag a, in folder d
	const outD = facts("e/n.md", ["a"]); // has tag a, NOT in folder d
	const neither = facts("d/m.md", ["z"]); // in folder d, but neither a nor b
	const expr = '(file.hasTag("a") || file.hasTag("b")) && file.inFolder("d")';
	ok(evalBaseFilter(parseBaseFilter(expr), inD), "(a||b) && d: a & in-d → true");
	ok(!evalBaseFilter(parseBaseFilter(expr), outD), "(a||b) && d: a but out-of-d → false");
	ok(!evalBaseFilter(parseBaseFilter(expr), neither), "(a||b) && d: in-d but neither a nor b → false (group honoured)");

	// !(a && b): true unless the note has BOTH.
	const both = facts("x.md", ["x", "y"]);
	const oneOnly = facts("y.md", ["x"]);
	ok(!evalBaseFilter(parseBaseFilter('!(file.hasTag("x") && file.hasTag("y"))'), both), "!(x && y): has both → false");
	ok(evalBaseFilter(parseBaseFilter('!(file.hasTag("x") && file.hasTag("y"))'), oneOnly), "!(x && y): has one → true");
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

// --- date arithmetic: today()/now()/date() ± "<n><unit>" ---
{
	const now = Date.now();
	const todayStart = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();

	// today() - "7d": a file modified today should be newer than today minus 7 days.
	const recent: FileFacts = { ...facts("r.md", []), mtime: now };
	ok(evalBaseFilter(parseBaseFilter('file.mtime > today() - "7d"'), recent), "mtime=now > today-7d → true");
	ok(!evalBaseFilter(parseBaseFilter('file.mtime < today() - "7d"'), recent), "mtime=now < today-7d → false");

	// A file from 10 days ago should be older than today minus 7 days.
	const old10d: FileFacts = { ...facts("o.md", []), mtime: todayStart - 10 * 864e5 };
	ok(!evalBaseFilter(parseBaseFilter('file.mtime > today() - "7d"'), old10d), "mtime=10d ago > today-7d → false");
	ok(evalBaseFilter(parseBaseFilter('file.mtime < today() - "7d"'), old10d), "mtime=10d ago < today-7d → true");

	// now() - "2h" vs now() - "48h": use comfortable margins to avoid timing flakiness.
	const oneHourAgo = now - 36e5;        // 1h ago → clearly within last 2h
	const threeDaysAgo = now - 72 * 36e5; // 3d ago → clearly older than 2h
	const fH: FileFacts = { ...facts("h.md", []), mtime: oneHourAgo };
	ok(!evalBaseFilter(parseBaseFilter('file.mtime < now() - "2h"'), fH), "mtime=1h ago is NOT < now-2h");
	ok(evalBaseFilter(parseBaseFilter('file.mtime > now() - "48h"'), fH), "mtime=1h ago > now-48h → true");
	const fD: FileFacts = { ...facts("d.md", []), mtime: threeDaysAgo };
	ok(evalBaseFilter(parseBaseFilter('file.mtime < now() - "2h"'), fD), "mtime=3d ago < now-2h → true");

	// date("2025-01-01") + "1M" == 2025-02-01
	const feb2025 = Date.parse("2025-02-01");
	const fMon: FileFacts = { ...facts("m.md", []), mtime: feb2025 };
	ok(evalBaseFilter(parseBaseFilter('file.mtime == date("2025-01-01") + "1M"'), fMon), 'date("2025-01-01")+"1M" == 2025-02-01');

	// M (month) vs m (minute) are distinct units.
	const oneMinuteMs = 6e4;
	const oneMonthMs = Date.parse("2025-02-01") - Date.parse("2025-01-01");
	ok(oneMonthMs > oneMinuteMs * 1000, "1M (month) >> 1m (minute) sanity");

	// "1day" alias works same as "1d".
	const fDay: FileFacts = { ...facts("dd.md", []), mtime: now - 2 * 864e5 };
	ok(evalBaseFilter(parseBaseFilter('file.mtime < today() - "1day"'), fDay), '"1day" alias = 1d');

	// "1y" calendar year.
	const nextYear = (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.getTime(); })();
	const fY: FileFacts = { ...facts("y.md", []), mtime: nextYear };
	ok(evalBaseFilter(parseBaseFilter('file.mtime > today() + "1y"'), fY), '"1y" one calendar year forward');

	// Unknown unit → NaN → evalDateCompare returns null → falls through to generic compare → false, no throw.
	ok(!evalBaseFilter(parseBaseFilter('file.mtime > today() - "1x"'), recent), 'unknown unit "1x" → NaN → no throw, false');

	// Chained arithmetic: today() - "1M" - "1d" (recursive).
	const oneMonthOneDayAgo = (() => {
		const d = new Date(); d.setHours(0,0,0,0); d.setMonth(d.getMonth()-1); d.setDate(d.getDate()-1);
		return d.getTime();
	})();
	const fChain: FileFacts = { ...facts("ch.md", []), mtime: oneMonthOneDayAgo - 1 };
	ok(evalBaseFilter(parseBaseFilter('file.mtime < today() - "1M" - "1d"'), fChain), 'chained today()-"1M"-"1d"');

	// Regression: date("2025-01-01") literal equality still works (no mis-parse as arithmetic).
	const jan2025 = Date.parse("2025-01-01");
	const fReg: FileFacts = { ...facts("reg.md", []), mtime: jan2025 };
	ok(evalBaseFilter(parseBaseFilter('file.mtime == date("2025-01-01")'), fReg), 'regression: date("2025-01-01") literal unaffected');
}

console.log("bases-resolve tests passed");
