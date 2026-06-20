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
		rawViews.forEach((v, i) => views.push(parseView(v, i)));
	}

	return { filePath, name, views, formulas };
}

function parseView(raw: unknown, index: number): BaseView {
	const v = isRecord(raw) ? raw : {};
	const type = typeof v["type"] === "string" ? (v["type"] as string) : "table";
	const name =
		typeof v["name"] === "string" && (v["name"] as string).length > 0
			? (v["name"] as string)
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
					? (s["property"] as string)
					: typeof s["column"] === "string"
						? (s["column"] as string)
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
//   method form: <lhs>.contains("rhs")  /  <lhs>.contains('rhs')  / unquoted
//   compare form: <lhs> <op> <rhs>      op ∈ == != >= <= > <
export function parseCond(text: string): BaseCond | null {
	const s = text.trim();

	// method form, e.g. file.tags.contains("#tag")
	const m = s.match(/^([A-Za-z0-9_.]+)\.([A-Za-z_]+)\((.*)\)\s*$/);
	if (m) {
		const lhs = m[1];
		const op = m[2];
		const rhs = unquote(m[3].trim());
		return { lhs, op, rhs };
	}

	// compare form. Longest operators first so `>=` isn't split as `>`.
	const ops = ["==", "!=", ">=", "<=", ">", "<"];
	for (const op of ops) {
		const idx = s.indexOf(op);
		if (idx > 0) {
			const lhs = s.slice(0, idx).trim();
			const rhs = unquote(s.slice(idx + op.length).trim());
			if (lhs.length > 0) return { lhs, op, rhs };
		}
	}

	return null;
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
