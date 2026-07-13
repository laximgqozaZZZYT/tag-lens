// `.base` (Obsidian Bases) parser. The Obsidian-dependent surface is kept to a
// single thin wrapper (`scanBaseFiles` + `parseBaseFile`); all structural
// mapping (`parseBaseStructure`, `parseBaseFilter`, `parseCond`) is pure so the
// test-suite can exercise it without an Obsidian runtime or a YAML parser.
//
// The Bases filter grammar is not publicly specified; this parser handles the
// OBSERVED subset and degrades gracefully (never throws) on anything else:
//   - boolean nodes:   { and: [...] } | { or: [...] }
//   - tag membership:  file.tags.contains("#tag")   (also note.<prop>.contains)
//   - field compare:   file.name == "x", file.ext != "md", note.foo >= 3, …
//                      operators: == != > < >= <=
// Anything unrecognised is preserved as { raw: <string> } and IGNORED at eval.

import type { App, TFile } from "obsidian";
import { parseYaml } from "obsidian";
import type { BaseCond, BaseFilter, BaseSort, BaseTable, BaseView } from "./types";

// --- Obsidian-dependent surface (thin) ---

// getMarkdownFiles() excludes `.base`, so we filter getFiles() by extension.
export function scanBaseFiles(app: App): TFile[] {
	return app.vault.getFiles().filter((f) => f.extension === "base");
}

export async function parseBaseFile(app: App, file: TFile): Promise<BaseTable> {
	let obj: unknown = null;
	try {
		const text = await app.vault.cachedRead(file);
		obj = parseYaml(text);
	} catch {
		// Unreadable / malformed YAML → empty table (never throw).
		obj = null;
	}
	return parseBaseStructure(obj, file.path);
}

// --- Pure structural mapping ---

export function parseBaseStructure(obj: unknown, filePath: string): BaseTable {
	const root = isRecord(obj) ? obj : {};
	const name = baseNameFromPath(filePath);

	const formulas: Record<string, string> = {};
	const rawFormulas = root["formulas"];
	if (isRecord(rawFormulas)) {
		for (const [k, v] of Object.entries(rawFormulas)) {
			formulas[k] = v == null ? "" : String(v);
		}
	}

	const views: BaseView[] = [];
	const rawViews = root["views"];
	if (Array.isArray(rawViews)) {
		rawViews.forEach((v, i) => { views.push(parseView(v, i)); });
	}

	return { filePath, name, views, formulas };
}

function parseView(raw: unknown, index: number): BaseView {
	const v = isRecord(raw) ? raw : {};
	const type = typeof v["type"] === "string" ? v["type"] : "table";
	const name =
		typeof v["name"] === "string" && v["name"].length > 0
			? v["name"]
			: `view${index + 1}`;

	const columns: string[] = [];
	const order = v["order"];
	if (Array.isArray(order)) {
		for (const c of order) if (typeof c === "string") columns.push(c);
	}

	const filter = parseBaseFilter(v["filters"] ?? v["filter"] ?? null);
	const sort = parseSort(v["sort"]);

	return { name, type, filter, columns, sort };
}

function parseSort(raw: unknown): BaseSort[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const out: BaseSort[] = [];
	for (const s of raw) {
		if (typeof s === "string") {
			out.push({ property: s, direction: "ASC" });
		} else if (isRecord(s)) {
			const property =
				typeof s["property"] === "string"
					? s["property"]
					: typeof s["column"] === "string"
						? s["column"]
						: "";
			if (!property) continue;
			const dirRaw = String(s["direction"] ?? s["order"] ?? "ASC").toUpperCase();
			out.push({ property, direction: dirRaw === "DESC" ? "DESC" : "ASC" });
		}
	}
	return out.length > 0 ? out : undefined;
}

// Recursively map a `filters` node to a BaseFilter tree. Accepts the object
// forms ({and|or: [...]}) and the string-condition form. Never throws.
export function parseBaseFilter(node: unknown): BaseFilter | null {
	if (node == null) return null;

	if (typeof node === "string") {
		const trimmed = node.trim();
		if (trimmed.length === 0) return null;
		const cond = parseCond(trimmed);
		return cond ? { cond } : { raw: trimmed };
	}

	if (Array.isArray(node)) {
		// A bare array is treated as an implicit AND of its members.
		const children = mapChildren(node);
		return children.length > 0 ? { and: children } : null;
	}

	if (isRecord(node)) {
		if (Array.isArray(node["and"])) {
			const children = mapChildren(node["and"] as unknown[]);
			return children.length > 0 ? { and: children } : null;
		}
		if (Array.isArray(node["or"])) {
			const children = mapChildren(node["or"] as unknown[]);
			return children.length > 0 ? { or: children } : null;
		}
		// Unknown object shape — preserve as raw for visibility.
		return { raw: safeStringify(node) };
	}

	return { raw: String(node) };
}

function mapChildren(arr: unknown[]): BaseFilter[] {
	const out: BaseFilter[] = [];
	for (const c of arr) {
		const f = parseBaseFilter(c);
		if (f) out.push(f);
	}
	return out;
}

// Decompose a single string condition. Returns null when the shape is unknown
// (caller wraps it as { raw }).
//   method form:  <lhs>.contains("rhs")  /  <lhs>.contains('rhs')  / unquoted
//   compare form: <lhs> <op> <rhs>       op ∈ == != >= <= > <
//   negation:     leading `!` (double-negation cancels) and the Bases-native
//                 boolean-predicate form `<pred> == false` / `<pred> != true`.
// A negated leaf keeps its `cond` (with `negate:true`) rather than degrading to
// `{ raw }`, so the negation is honoured instead of silently ignored at eval.
export function parseCond(text: string): BaseCond | null {
	// Strip leading `!` negations first (even count → no net negation), then
	// parse the remainder. The core parser may itself flag negation (the
	// `<pred> == false` form), which withNegate XORs in.
	let s = text.trim();
	let negate = false;
	while (s.startsWith("!")) {
		negate = !negate;
		s = s.slice(1).trim();
	}
	const cond = parseMethod(s) ?? parseIn(s) ?? parseCompare(s);
	return cond ? withNegate(cond, negate) : null;
}

// Fold `neg` into `cond.negate` (XOR with any existing flag). Clears the flag
// when the net negation is even. Mutates and returns the same object.
function withNegate(cond: BaseCond, neg: boolean): BaseCond {
	if (neg !== Boolean(cond.negate)) cond.negate = true;
	else if (cond.negate) cond.negate = undefined;
	return cond;
}

// method form, e.g. file.tags.contains("#tag") or the multi-arg
// file.tags.containsAny("書籍", "小説"). Split the arg list on top-level commas
// (quoted commas preserved) so each argument is unquoted independently.
function parseMethod(s: string): BaseCond | null {
	const m = s.match(/^([A-Za-z0-9_.]+)\.([A-Za-z_]+)\((.*)\)\s*$/);
	if (!m) return null;
	const args = splitArgs(m[3]).map((a) => unquote(a.trim()));
	// Mirror the first arg into `rhs` so single-value consumers keep working;
	// multi-arg operators read the full `args` list.
	return { lhs: m[1], op: m[2], rhs: args[0] ?? "", args };
}

// `<lhs> IN (a, b, …)`: membership against a parenthesised list. The eval side
// (resolve.ts) is array-aware. Keyword is case-insensitive; the required
// whitespace before IN means a `.method(` call never collides. Reuses splitArgs
// so quoted commas inside a value are preserved.
function parseIn(s: string): BaseCond | null {
	const m = s.match(/^([A-Za-z0-9_.]+)\s+IN\s*\((.*)\)$/i);
	if (!m) return null;
	const args = splitArgs(m[2]).map((a) => unquote(a.trim()));
	return { lhs: m[1], op: "IN", rhs: args[0] ?? "", args };
}

// compare form: `<lhs> <op> <rhs>`, longest operators first so `>=` isn't split
// as `>`. Also handles the boolean-predicate negation `<pred> == false`.
function parseCompare(s: string): BaseCond | null {
	const ops = ["==", "!=", ">=", "<=", ">", "<"];
	for (const op of ops) {
		const idx = s.indexOf(op);
		if (idx <= 0) continue;
		const lhs = s.slice(0, idx).trim();
		if (lhs.length === 0) continue;
		const rhs = unquote(s.slice(idx + op.length).trim());

		const boolPred = parseBoolPredicate(op, lhs, rhs);
		if (boolPred) return boolPred;

		// Only accept a clean field-path lhs. A mis-split inline compound such as
		// `file.tags.contains("#a") AND file.name` (spaces/parens) is rejected →
		// null → the caller keeps it as { raw } and ignores it, rather than
		// imposing a wrong constraint.
		if (/^[A-Za-z0-9_.]+$/.test(lhs)) return { lhs, op, rhs };
	}
	return null;
}

// Boolean-predicate negation: `<pred> == false` / `<pred> != true` → the inner
// predicate, negated; `<pred> == true` / `<pred> != false` → it unchanged.
// Returns null when this isn't an `== true/false` comparison.
function parseBoolPredicate(op: string, lhs: string, rhs: string): BaseCond | null {
	if (op !== "==" && op !== "!=") return null;
	if (rhs !== "true" && rhs !== "false") return null;
	const inner = parseCond(lhs);
	if (!inner) return null;
	return withNegate(inner, op === "==" ? rhs === "false" : rhs === "true");
}

// Split a method-call argument list on top-level commas, respecting quoted
// strings so `containsAny("A", "B,C")` yields ['"A"', ' "B,C"']. Blank input
// yields []. Never throws: an unbalanced quote just runs to the end of the
// segment (the caller unquotes each piece leniently).
function splitArgs(raw: string): string[] {
	const s = raw.trim();
	if (s.length === 0) return [];
	const out: string[] = [];
	let cur = "";
	let quote: string | null = null;
	for (const ch of s) {
		if (quote) {
			cur += ch;
			if (ch === quote) quote = null;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
			cur += ch;
		} else if (ch === ",") {
			out.push(cur);
			cur = "";
		} else {
			cur += ch;
		}
	}
	out.push(cur);
	return out;
}

function unquote(v: string): string {
	if (v.length >= 2) {
		const a = v[0];
		const b = v[v.length - 1];
		if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
			return v.slice(1, -1);
		}
	}
	return v;
}

// --- helpers ---

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function baseNameFromPath(filePath: string): string {
	const base = filePath.split("/").pop() ?? filePath;
	return base.endsWith(".base") ? base.slice(0, -".base".length) : base;
}

function safeStringify(v: unknown): string {
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
}
