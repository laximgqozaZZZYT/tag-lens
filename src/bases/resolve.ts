// Resolve a parsed base view into BaseElements (filter-matched notes) and
// evaluate the filter tree against FileFacts. Both functions are pure — facts
// and the forward-link lookup are injected so no Obsidian runtime is needed
// (the Obsidian wiring lives in build-index.ts).

import type { FileFacts } from "../query/query";
import { isTagOrSubtag } from "../insight/tag-path";
import type { BaseCond, BaseElement, BaseFilter, BaseTable, BaseView } from "./types";

// Evaluate a filter tree against one note's facts.
//
// Semantics:
//   - and → every child must hold (vacuously true when empty)
//   - or  → at least one child holds (false when empty)
//   - cond → evaluated per operator below
//   - raw → IGNORED. An un-parsed condition does NOT constrain the result; it
//     is treated as "no condition" (skipped). This is deliberate: we never
//     publicly know the full Bases grammar, so silently dropping a note because
//     of a condition we failed to parse would be worse than including it. Under
//     `and` a raw child is true (no-op); under `or` a raw child is false (it
//     contributes nothing). Build-time `errors[]` can record such cases.
export function evalBaseFilter(filter: BaseFilter | null, facts: FileFacts): boolean {
	if (filter == null) return true;

	if ("and" in filter) return evalAll(filter.and, facts);
	if ("or" in filter) return evalAny(filter.or, facts);

	if ("not" in filter) {
		// `not:` inverts its child. An unparseable child ({ raw }) is treated as
		// "no constraint" (true), so `not` of it is also no-constraint (true) —
		// we never exclude everything because of a condition we couldn't parse.
		return isRaw(filter.not) ? true : !evalBaseFilter(filter.not, facts);
	}

	if ("raw" in filter) return true; // standalone raw → no constraint

	return evalCond(filter, facts);
}

function isRaw(f: BaseFilter): boolean {
	return "raw" in f;
}

// AND: every non-raw child holds (raw children are skipped = no constraint).
function evalAll(children: BaseFilter[], facts: FileFacts): boolean {
	for (const c of children) {
		if (isRaw(c)) continue;
		if (!evalBaseFilter(c, facts)) return false;
	}
	return true;
}

// OR: at least one non-raw child holds (raw children contribute nothing).
function evalAny(children: BaseFilter[], facts: FileFacts): boolean {
	for (const c of children) {
		if (isRaw(c)) continue;
		if (evalBaseFilter(c, facts)) return true;
	}
	return false;
}

// Evaluate a leaf, honouring `negate` (from `!pred` or `pred == false`) by
// flipping the operator result in one place.
function evalCond(node: { cond: BaseCond }, facts: FileFacts): boolean {
	const r = evalCondInner(node, facts);
	return node.cond.negate ? !r : r;
}

function evalCondInner(node: { cond: BaseCond }, facts: FileFacts): boolean {
	const { lhs, op, rhs, args } = node.cond;
	// ONLY the canonical tag fields address the note's tag set. A loose `/tags$/`
	// wrongly captured any `*tags` frontmatter field (note.subtags, note.booktags)
	// and evaluated it against facts.tags instead of the property — anchor it.
	const isTags = /^(?:file|note)\.tags$/.test(lhs);
	// Multi-arg method forms carry `args`; fall back to the single `rhs` so a
	// one-arg call (or a legacy cond without `args`) still works.
	const values = args ?? (rhs != null ? [rhs] : []);

	// tag membership: file.tags.contains("#tag") (leading # optional both sides).
	if (op === "contains" && isTags) {
		const want = stripHash(rhs ?? "");
		return facts.tags.some((t) => stripHash(t) === want);
	}

	// multi-value tag membership: containsAny/All/None over file.tags (leading #
	// optional on both sides, matching single-value `contains`).
	if ((op === "containsAny" || op === "containsAll" || op === "containsNone") && isTags) {
		const wants = values.map(stripHash);
		const has = (w: string) => facts.tags.some((t) => stripHash(t) === w);
		if (op === "containsAny") return wants.some(has);
		if (op === "containsAll") return wants.every(has);
		return !wants.some(has); // containsNone
	}

	// Official Bases predicates: file.hasTag / file.inFolder / file.hasProperty / isEmpty.
	const pred = evalNamedPredicate(op, lhs, values, facts);
	if (pred !== null) return pred;

	const actual = resolveLhs(lhs, facts);

	if (op === "contains") {
		// generic contains over an array field or substring of a scalar.
		if (Array.isArray(actual)) return actual.some((x) => String(x) === (rhs ?? ""));
		return String(actual ?? "").includes(rhs ?? "");
	}

	// generic multi-value contains: array membership, or scalar substring.
	if (op === "containsAny" || op === "containsAll" || op === "containsNone") {
		const has = (w: string) =>
			Array.isArray(actual) ? actual.some((x) => String(x) === w) : String(actual ?? "").includes(w);
		if (op === "containsAny") return values.some(has);
		if (op === "containsAll") return values.every(has);
		return !values.some(has); // containsNone
	}

	if (op === "startsWith") return String(actual ?? "").startsWith(rhs ?? "");
	if (op === "endsWith") return String(actual ?? "").endsWith(rhs ?? "");

	// `x IN (a, b, …)`: actual equals any listed value (array-aware).
	if (op === "IN") {
		if (Array.isArray(actual)) return actual.some((x) => values.includes(String(x)));
		return values.includes(String(actual ?? ""));
	}

	// Date fields (epoch-ms) vs a date-string rhs need epoch coercion, else the
	// generic compare would string-compare the epoch number.
	if (lhs === "file.ctime" || lhs === "file.mtime") {
		const dc = evalDateCompare(op, rhs ?? "", actual);
		if (dc !== null) return dc;
	}

	return compare(actual, op, rhs ?? "");
}

// Map a `file.*` / `note.<prop>` / bare-field lhs to a concrete value from facts.
function resolveLhs(lhs: string, facts: FileFacts): unknown {
	const base = facts.path.split("/").pop() ?? facts.path;
	const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
	const basename = ext ? base.slice(0, base.length - ext.length - 1) : base;

	switch (lhs) {
		case "file.path":
			return facts.path;
		case "file.name":
			return base;
		case "file.basename":
			return basename;
		case "file.ext":
			return ext;
		case "file.folder":
			return folderOf(facts.path);
		case "file.tags":
			return facts.tags;
		case "file.links":
			return facts.links ?? [];
		case "file.size":
			return facts.size;
		case "file.ctime":
			return facts.ctime;
		case "file.mtime":
			return facts.mtime;
	}

	// note.<key> or note.frontmatter.<key>
	let key: string | null = null;
	if (lhs.startsWith("note.frontmatter.")) key = lhs.slice("note.frontmatter.".length);
	else if (lhs.startsWith("note.")) key = lhs.slice("note.".length);
	else if (!lhs.includes(".")) key = lhs; // bare frontmatter field

	if (key != null) return facts.frontmatter[key];
	return undefined;
}

function compare(actual: unknown, op: string, rhs: string): boolean {
	const an = typeof actual === "number" ? actual : Number(actual);
	const rn = Number(rhs);
	const numeric = !Number.isNaN(an) && !Number.isNaN(rn) && rhs.trim() !== "";
	// Numeric equality only for scalar actuals — arrays keep string membership so
	// `note.authors == "Grace"` still matches a list member.
	const numEq = numeric && !Array.isArray(actual);

	switch (op) {
		case "==":
			return numEq ? an === rn : arrAwareEq(actual, rhs);
		case "!=":
			return numEq ? an !== rn : !arrAwareEq(actual, rhs);
		case ">":
			return numeric ? an > rn : String(actual ?? "") > rhs;
		case "<":
			return numeric ? an < rn : String(actual ?? "") < rhs;
		case ">=":
			return numeric ? an >= rn : String(actual ?? "") >= rhs;
		case "<=":
			return numeric ? an <= rn : String(actual ?? "") <= rhs;
		default:
			return false; // unknown operator → no constraint satisfied
	}
}

function arrAwareEq(actual: unknown, rhs: string): boolean {
	if (Array.isArray(actual)) return actual.some((x) => String(x) === rhs);
	return String(actual ?? "") === rhs;
}

// Compare an epoch-ms date field against a date-ish rhs. Returns null when either
// side isn't a usable epoch (→ caller falls back to the generic compare).
function evalDateCompare(op: string, rhs: string, actual: unknown): boolean | null {
	const a = typeof actual === "number" ? actual : NaN;
	const b = coerceDateRhs(rhs);
	if (Number.isNaN(a) || Number.isNaN(b)) return null;
	switch (op) {
		case "==":
			return a === b;
		case "!=":
			return a !== b;
		case ">":
			return a > b;
		case "<":
			return a < b;
		case ">=":
			return a >= b;
		case "<=":
			return a <= b;
		default:
			return null;
	}
}

// Resolve a filter rhs to an epoch-ms number: now()/today()/date("X")/"X"/ISO
// string, or a bare epoch number. Unparseable → NaN. Date arithmetic is not
// handled here (out of scope).
function coerceDateRhs(rhs: string): number {
	const s = rhs.trim();
	if (s === "now()") return Date.now();
	if (s === "today()") {
		const d = new Date();
		d.setHours(0, 0, 0, 0);
		return d.getTime();
	}
	const dateCall = s.match(/^date\((.*)\)$/);
	const inner = dateCall ? unquoteLoose(dateCall[1]) : s;
	if (inner.trim() !== "" && !Number.isNaN(Number(inner))) return Number(inner);
	return Date.parse(inner);
}

// Strip one layer of matching quotes if present (rhs pieces are already unquoted
// by the parser, but date("...") keeps its inner quotes).
function unquoteLoose(v: string): string {
	const t = v.trim();
	if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
		return t.slice(1, -1);
	}
	return t;
}

function stripHash(t: string): string {
	return t.startsWith("#") ? t.slice(1) : t;
}

// Parent folder path of a note ("" for a vault-root file). Used by both the
// `file.folder` accessor and the `file.inFolder()` predicate.
function folderOf(path: string): string {
	return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

// Named boolean predicates from the official Bases function set (hasTag /
// inFolder / hasProperty / isEmpty). Returns null when `op` is not one of them
// so the caller falls through to the operator table.
function evalNamedPredicate(op: string, lhs: string, values: string[], facts: FileFacts): boolean | null {
	if (op === "hasTag") {
		// any-of, nested-aware (hasTag("a") matches the tag "a/b"), # optional.
		const wants = values.map(stripHash);
		return facts.tags.some((t) => wants.some((w) => isTagOrSubtag(stripHash(t), w)));
	}
	if (op === "inFolder") {
		const folder = folderOf(facts.path);
		return values.some((raw) => {
			const f = raw.replace(/\/+$/, "");
			return f === "" || folder === f || folder.startsWith(`${f}/`);
		});
	}
	// Object.keys = own enumerable keys only (no prototype builtin access → no
	// biome noPrototypeBuiltins, and ES2020-safe unlike Object.hasOwn).
	if (op === "hasProperty") return values.length > 0 && Object.keys(facts.frontmatter).includes(values[0]);
	if (op === "isEmpty") return isEmptyValue(resolveLhs(lhs, facts));
	if (op === "hasLink") return hasLinkTo(facts.links ?? [], values);
	return null;
}

// file.hasLink(...): any-of, loose match of a forward-link target by full path,
// path-without-extension, or basename. Args may be wikilink-wrapped / aliased.
function hasLinkTo(links: string[], values: string[]): boolean {
	const wants = values.map(normalizeLinkArg).filter((w) => w !== "");
	if (wants.length === 0) return false;
	return links.some((l) => {
		const noExt = l.replace(/\.md$/i, "");
		const base = noExt.split("/").pop() ?? noExt;
		return wants.some((w) => w === l || w === noExt || w === base);
	});
}

// Strip `[[ ]]`, drop a `|display` alias, trim, drop a trailing `.md`.
function normalizeLinkArg(raw: string): string {
	const inner = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
	const target = inner.split("|")[0].trim();
	return target.replace(/\.md$/i, "");
}

// isEmpty(): empty string, empty list, or an absent/null field value.
function isEmptyValue(v: unknown): boolean {
	if (v == null || v === "") return true;
	if (Array.isArray(v)) return v.length === 0;
	return false;
}

// Resolve all matched notes of a view into BaseElements.
//   factsByPath  : every note's FileFacts (built once by the caller)
//   forwardLinks : note path → array of forward-link target paths
export function resolveElements(
	table: BaseTable,
	view: BaseView,
	factsByPath: Map<string, FileFacts>,
	forwardLinks: Map<string, string[]>,
): BaseElement[] {
	const out: BaseElement[] = [];
	for (const [notePath, facts] of factsByPath) {
		if (!evalBaseFilter(view.filter, facts)) continue;
		out.push({
			key: elementKey(table.filePath, view.name, notePath),
			notePath,
			tablePath: table.filePath,
			viewName: view.name,
			fields: extractFields(view.columns, facts, forwardLinks.get(notePath) ?? []),
			tags: [...facts.tags],
			links: [...(forwardLinks.get(notePath) ?? [])],
		});
	}
	return out;
}

function elementKey(tablePath: string, viewName: string, notePath: string): string {
	return `${tablePath}::${viewName}::${notePath}`;
}

// Pull each declared column into the element's `fields` map. formula.* columns
// are left undefined in Stage 1 (no evaluator yet); they are recorded with the
// key so Stage 2 can fill them.
function extractFields(
	columns: string[],
	facts: FileFacts,
	links: string[],
): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	for (const col of columns) {
		fields[col] = columnValue(col, facts, links);
	}
	return fields;
}

function columnValue(col: string, facts: FileFacts, links: string[]): unknown {
	if (col === "file.tags") return facts.tags;
	if (col === "file.path") return facts.path;
	if (col === "file.links") return links;
	if (col === "file.name" || col === "file.basename" || col === "file.ext") {
		return resolveLhs(col, facts);
	}
	if (col.startsWith("note.frontmatter.")) return facts.frontmatter[col.slice("note.frontmatter.".length)];
	if (col.startsWith("note.")) return facts.frontmatter[col.slice("note.".length)];
	if (col.startsWith("formula.")) return undefined; // Stage 2
	if (col.startsWith("file.")) return resolveLhs(col, facts);
	return facts.frontmatter[col]; // bare field
}
