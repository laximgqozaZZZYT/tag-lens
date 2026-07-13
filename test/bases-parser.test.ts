// Bases parser tests. Exercises the pure structural mapping
// (parseBaseStructure / parseBaseFilter / parseCond) without the Obsidian YAML
// reader — we feed already-parsed objects, mirroring what parseYaml returns.
import { ok } from "./assert";
import { parseBaseStructure, parseBaseFilter, parseCond } from "../src/bases/parser";
import type { BaseFilter } from "../src/bases/types";

// --- parseBaseStructure: views / columns / formulas / names ---
{
	const obj = {
		formulas: { 無題: "", price: "note.cost * 2" },
		views: [
			{ type: "table", name: "表" },
			{
				type: "cards",
				name: "ビュー",
				order: ["file.name", "formula.無題", 42],
				filters: { and: ['file.tags.contains("#proj")', 'file.ext == "md"'] },
				sort: [{ property: "file.name", direction: "DESC" }],
			},
		],
	};
	const t = parseBaseStructure(obj, "Folder/My.base");

	ok(t.name === "My", "table name derived from path basename without extension");
	ok(t.filePath === "Folder/My.base", "filePath preserved");
	ok(t.views.length === 2, "two views parsed");
	ok(t.views[0].name === "表" && t.views[0].type === "table", "view0 name/type");
	ok(t.views[1].type === "cards", "view1 type cards");
	ok(
		JSON.stringify(t.views[1].columns) === JSON.stringify(["file.name", "formula.無題"]),
		"columns = string entries of order[]; non-strings dropped",
	);
	ok(t.formulas["price"] === "note.cost * 2" && t.formulas["無題"] === "", "formulas mapped");
	ok(
		t.views[1].sort?.[0].property === "file.name" && t.views[1].sort?.[0].direction === "DESC",
		"sort property/direction parsed",
	);
}

// --- view name fallback when `name` absent ---
{
	const t = parseBaseStructure({ views: [{ type: "table" }, { type: "list" }] }, "x.base");
	ok(t.views[0].name === "view1" && t.views[1].name === "view2", "missing names → index-numbered");
}

// --- missing / wrong-typed top level is safe ---
{
	const a = parseBaseStructure(null, "n.base");
	ok(a.views.length === 0 && Object.keys(a.formulas).length === 0, "null obj → empty table");
	const b = parseBaseStructure({ views: "nope", formulas: 5 }, "n.base");
	ok(b.views.length === 0 && Object.keys(b.formulas).length === 0, "wrong-typed fields ignored");
}

// --- parseBaseFilter: and/or recursion ---
{
	const f = parseBaseFilter({
		or: [
			'file.tags.contains("#a")',
			{ and: ['file.tags.contains("#b")', "file.ext == md"] },
		],
	});
	ok(f != null && "or" in f, "top level is or");
	const orNode = f as { or: BaseFilter[] };
	ok(orNode.or.length === 2, "or has two children");
	ok("cond" in orNode.or[0], "first or child is a parsed cond");
	ok("and" in orNode.or[1], "second or child is a nested and");
	const andNode = orNode.or[1] as { and: BaseFilter[] };
	ok(andNode.and.length === 2 && "cond" in andNode.and[0], "nested and has two conds");
}

// --- parseBaseFilter: unknown forms preserved as raw, never throw ---
{
	const raw = parseBaseFilter("file.weird.matches(/x/)");
	// method-form regex actually parses (contains-style) — use a truly opaque string:
	const opaque = parseBaseFilter("totally unparseable %% expression");
	ok(opaque != null && "raw" in opaque, "opaque string → raw");
	ok(raw != null, "method-like string still returns a filter (no throw)");
	const empty = parseBaseFilter("   ");
	ok(empty === null, "blank string → null");
	const none = parseBaseFilter(null);
	ok(none === null, "null → null");
}

// --- parseCond: method + compare forms ---
{
	const c1 = parseCond('file.tags.contains("#tag")');
	ok(c1?.lhs === "file.tags" && c1?.op === "contains" && c1?.rhs === "#tag", "contains decomposed, quotes stripped");

	const c2 = parseCond("note.count >= 3");
	ok(c2?.lhs === "note.count" && c2?.op === ">=" && c2?.rhs === "3", ">= split before > (longest op first)");

	const c3 = parseCond('file.name != "draft"');
	ok(c3?.lhs === "file.name" && c3?.op === "!=" && c3?.rhs === "draft", "!= compare, quotes stripped");

	const c4 = parseCond("file.ext == 'md'");
	ok(c4?.rhs === "md", "single quotes stripped");

	const c5 = parseCond("garbage");
	ok(c5 === null, "no operator / no method → null");

	// multi-arg method form: args split on top-level commas, each unquoted.
	const c6 = parseCond('file.tags.containsAny("書籍", "小説")');
	ok(
		c6?.op === "containsAny" &&
			c6?.args?.length === 2 &&
			c6.args[0] === "書籍" &&
			c6.args[1] === "小説" &&
			c6.rhs === "書籍",
		"containsAny multi-arg → args split + unquoted, rhs mirrors args[0]",
	);

	// quoted comma inside an argument must not split it.
	const c7 = parseCond('file.tags.containsAll("a,b", "c")');
	ok(
		c7?.args?.length === 2 && c7.args[0] === "a,b" && c7.args[1] === "c",
		"quoted comma preserved inside argument",
	);

	// single-arg method stays backward compatible via rhs and gains args[0].
	const c8 = parseCond('file.tags.contains("#tag")');
	ok(c8?.rhs === "#tag" && c8?.args?.length === 1 && c8.args[0] === "#tag", "single-arg method: rhs + args[0]");

	// empty argument list → args empty, rhs "".
	const c9 = parseCond("file.tags.isEmpty()");
	ok(c9?.op === "isEmpty" && c9?.args?.length === 0 && c9?.rhs === "", "no-arg method → empty args, rhs \"\"");
}

// --- negation: leading `!`, double-negation, boolean-predicate form ---
{
	const n1 = parseCond('!file.tags.contains("書籍")');
	ok(
		n1?.op === "contains" && n1?.rhs === "書籍" && n1?.negate === true,
		"leading ! → contains cond with negate:true (NOT dropped to raw)",
	);

	const n2 = parseCond('!!file.tags.contains("書籍")');
	ok(n2?.op === "contains" && !n2?.negate, "double negation cancels → no negate flag");

	// Bases-native `<pred> == false` negates the inner predicate.
	const n3 = parseCond('file.tags.contains("x") == false');
	ok(n3?.op === "contains" && n3?.rhs === "x" && n3?.negate === true, "`pred == false` → inner cond negate:true");

	const n4 = parseCond('file.tags.contains("x") == true');
	ok(n4?.op === "contains" && !n4?.negate, "`pred == true` → inner cond, no negation");

	const n5 = parseCond('file.tags.contains("x") != false');
	ok(n5?.op === "contains" && !n5?.negate, "`pred != false` keeps the predicate (no negation)");

	// `!(pred == false)` — the `!` cancels the `== false` negation.
	const n6 = parseCond('!file.tags.contains("x") == false');
	ok(n6?.op === "contains" && !n6?.negate, "! over `pred == false` cancels back to plain");
}

// --- `IN (...)` membership operator (was unparseable → silently ignored) ---
{
	const i1 = parseCond('note.status IN ("done", "wip")');
	ok(
		i1?.op === "IN" && i1?.args?.length === 2 && i1.args[0] === "done" && i1.args[1] === "wip" && i1.rhs === "done",
		"IN → op:IN with unquoted args + rhs mirrors args[0]",
	);

	const i2 = parseCond('note.status IN ("a,b", "c")');
	ok(i2?.args?.length === 2 && i2.args[0] === "a,b" && i2.args[1] === "c", "IN: quoted comma preserved");

	const i3 = parseCond('note.status in ("x")');
	ok(i3?.op === "IN", "IN keyword is case-insensitive");

	const i4 = parseCond('!note.status IN ("x")');
	ok(i4?.op === "IN" && i4?.negate === true, "negated IN → negate:true");
}

// --- inline && / || boolean operators in a filter string (were dropped to raw) ---
{
	const a = parseBaseFilter('file.hasTag("x") && note.author == "Ada"');
	ok(a != null && "and" in a && a.and.length === 2 && "cond" in a.and[0] && "cond" in a.and[1], "&& → { and: [cond, cond] }");

	const o = parseBaseFilter('note.a == "1" || note.a == "2"');
	ok(o != null && "or" in o && o.or.length === 2, "|| → { or: [...] }");

	// precedence: && binds tighter than ||.
	const p = parseBaseFilter('a == "1" || b == "2" && c == "3"');
	ok(p != null && "or" in p && p.or.length === 2 && "and" in p.or[1], "a || b && c → { or: [a, { and: [b, c] }] }");

	// quoted operator must NOT split, and method-call parens are protected.
	const q = parseBaseFilter('note.title == "a && b"');
	ok(q != null && "cond" in q && q.cond.rhs === "a && b", "quoted && stays inside the value");
	const m = parseBaseFilter('file.hasTag("x") && file.inFolder("d")');
	ok(m != null && "and" in m && m.and.length === 2, "method-call parens don't cause a mis-split");
}

// --- parenthesised grouping ( … ) and !( … ) (grouped operand was dropped to raw) ---
{
	const g = parseBaseFilter('(note.a == "1" || note.a == "2") && file.hasTag("x")');
	ok(
		g != null && "and" in g && g.and.length === 2 && "or" in g.and[0] && "cond" in g.and[1],
		"(a || b) && c → { and: [ { or }, { cond } ] }",
	);

	const n = parseBaseFilter('!(file.hasTag("x") && file.hasTag("y"))');
	ok(n != null && "not" in n && "and" in n.not, "!( a && b ) → { not: { and } }");

	const nest = parseBaseFilter('(note.a == "1" && note.b == "2") || note.c == "3"');
	ok(nest != null && "or" in nest && "and" in nest.or[0], "(a && b) || c → { or: [ { and }, cond ] }");

	// `(a) || (b)` is NOT one wrapping group → normal or-split of two leaves.
	const two = parseBaseFilter('(note.a == "1") || (note.b == "2")');
	ok(two != null && "or" in two && two.or.length === 2, "(a) || (b) → or of two (each group unwrapped)");

	// regression: method-call parens are not mistaken for a group.
	const m = parseBaseFilter('file.hasTag("x") && file.inFolder("d")');
	ok(m != null && "and" in m && m.and.length === 2, "method-call parens are not unwrapped");
}

// --- `not:` structured logical operator (was ignored as unknown object) ---
{
	const n = parseBaseFilter({ not: 'file.tags.contains("x")' });
	ok(n != null && "not" in n && "cond" in n.not, "not: → { not: { cond } }");

	const nAnd = parseBaseFilter({ not: ['file.ext == "md"', 'file.tags.contains("x")'] });
	ok(nAnd != null && "not" in nAnd && "and" in nAnd.not, "not: over an array → { not: { and: [...] } }");
}

// --- mis-split inline compound degrades to raw, not a wrong constraint ---
{
	const bad = parseCond('file.tags.contains("#a") AND file.name != "b"');
	ok(bad === null, "inline `a AND b` → null (spaces/parens in lhs rejected) → caller keeps { raw }");

	const wrapped = parseBaseFilter('file.tags.contains("#a") AND file.name != "b"');
	ok(wrapped != null && "raw" in wrapped, "…and parseBaseFilter wraps it as { raw } (ignored at eval)");
}

console.log("bases-parser tests passed");
