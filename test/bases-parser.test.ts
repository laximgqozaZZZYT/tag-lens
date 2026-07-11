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

console.log("bases-parser tests passed");
