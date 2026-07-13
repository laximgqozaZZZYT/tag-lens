// Resolve a parsed base view into BaseElements (filter-matched notes) and
// evaluate the filter tree against FileFacts. Both functions are pure — facts
// and the forward-link lookup are injected so no Obsidian runtime is needed
// (the Obsidian wiring lives in build-index.ts).

import type { FileFacts } from "../query/query";
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

	if ("and" in filter) {
		for (const c of filter.and) {
			if (isRaw(c)) continue; // raw → no constraint
			if (!evalBaseFilter(c, facts)) return false;
		}
		return true;
	}

	if ("or" in filter) {
		for (const c of filter.or) {
			if (isRaw(c)) continue; // raw contributes nothing to an OR
			if (evalBaseFilter(c, facts)) return true;
		}
		return false;
	}

	if ("raw" in filter) return true; // standalone raw → no constraint

	return evalCond(filter, facts);
}

function isRaw(f: BaseFilter): boolean {
	return "raw" in f;
}

// Evaluate a leaf, honouring `negate` (from `!pred` or `pred == false`) by
// flipping the operator result in one place.
function evalCond(node: { cond: BaseCond }, facts: FileFacts): boolean {
	const r = evalCondInner(node, facts);
	return node.cond.negate ? !r : r;
}

function evalCondInner(node: { cond: BaseCond }, facts: FileFacts): boolean {
	const { lhs, op, rhs, args } = node.cond;
	const isTags = /tags$/i.test(lhs);
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
		case "file.tags":
			return facts.tags;
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

function stripHash(t: string): string {
	return t.startsWith("#") ? t.slice(1) : t;
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
