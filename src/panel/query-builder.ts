import type { App, TFile } from "obsidian";
import { collectSuggestSources, type SuggestSources } from "./tag-field-suggest";

// ────────────────────────────────────────────────────────────────────────────
// Visual builder for WHERE / GROUP_BY rows.
//
// The builder is ONLY an alternate UI over the SAME string rows that the text
// editor already produces. It never introduces a new save format: a builder
// row is round-tripped to one of these simple textual patterns and written
// straight back into the existing `where[]` / `groupBy[]` arrays:
//
//   tag:#value     Tag — Has this tag           (TagHas)
//   -tag:#value    Tag — Does not have this tag (TagNot)
//   tag:?          Tag — Has any tag (split)    (TagAny)
//   field:value    Property — Equals            (FmEq)
//   -field:value   Property — Not equals        (FmNot)
//   field:?        Property — Has any value      (FmAny)
//
// Anything more complex (AND/OR/parens, tagN:, tag.fm:, multiple atoms, …)
// CANNOT be represented by the builder. parseSimpleRow returns null for those
// rows; the UI then falls back to a raw text input so the original string is
// preserved verbatim and never lost or rewritten.
// ────────────────────────────────────────────────────────────────────────────

export type SimpleKind =
	| "tag-has" // tag:#value
	| "tag-not" // -tag:#value
	| "tag-any" // tag:?
	| "fm-eq" // field:value
	| "fm-not" // -field:value
	| "fm-any"; // field:?

export interface SimpleCondition {
	kind: SimpleKind;
	// Frontmatter field name. Empty/ignored for the tag-* kinds (field === "tag").
	field: string;
	// Selected value (no leading '#'). Empty for the *-any kinds.
	value: string;
}

// Field names that are reserved for the Tag concept in the parser. A plain
// `tag` (no depth, no `.fm`) is the only Tag form the builder supports.
const TAG_FIELD = "tag";

// A simple field name is a frontmatter key the parser accepts as `fm` —
// i.e. it is NOT `tag` / `tagN` / `tag.x` / `folder` / `path`, and matches the
// parser's identifier rule.
const FM_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function isReservedNonSimpleField(field: string): boolean {
	// tagN: (depth) and tag.fm: are valid syntax but NOT builder-simple.
	if (/^tag([1-9]\d*)$/.test(field)) return true;
	if (/^tag\.[A-Za-z_][A-Za-z0-9_-]*$/.test(field)) return true;
	if (field === "folder" || field === "path") return true;
	return false;
}

// Parse ONE saved row string into a SimpleCondition, or null when the row is
// not a single simple atom the builder can represent. Pure — no DOM, no app.
//
// Rules for "simple":
//   • exactly one atom (no spaces ⇒ no AND/OR, no parens)
//   • an optional single leading '-' (NOT) directly attached to the atom
//   • field is either `tag` (exactly) or a plain frontmatter identifier
//   • value is a non-empty literal, or `?` / `*` (the partition wildcard)
export function parseSimpleRow(raw: string): SimpleCondition | null {
	const text = raw.trim();
	if (text === "") return null;
	// Reject anything that could be a compound expression or grouping: any
	// whitespace or paren means it is not a single atom.
	if (/[\s()]/.test(text)) return null;

	let negated = false;
	let body = text;
	if (body.startsWith("-")) {
		negated = true;
		body = body.slice(1);
	}
	// A bare leading '-' with nothing after, or a second '-', is not simple.
	if (body === "" || body.startsWith("-")) return null;

	const colon = body.indexOf(":");
	if (colon < 0) return null;
	const field = body.slice(0, colon);
	const rawValue = body.slice(colon + 1);
	if (field === "" || rawValue === "") return null;

	// Tag form: only the plain `tag` field (no depth, no .fm) is builder-simple.
	if (field === TAG_FIELD) {
		if (rawValue === "?" || rawValue === "*") {
			// `-tag:?` (NOT any) is not a builder concept → treat as non-simple.
			if (negated) return null;
			return { kind: "tag-any", field: TAG_FIELD, value: "" };
		}
		const value = rawValue.startsWith("#") ? rawValue.slice(1) : rawValue;
		if (value === "") return null;
		return { kind: negated ? "tag-not" : "tag-has", field: TAG_FIELD, value };
	}

	// Reserved-but-not-simple tag variants and unsupported folder/path.
	if (isReservedNonSimpleField(field)) return null;

	// Frontmatter form.
	if (!FM_FIELD_RE.test(field)) return null;
	if (rawValue === "?" || rawValue === "*") {
		if (negated) return null;
		return { kind: "fm-any", field, value: "" };
	}
	return { kind: negated ? "fm-not" : "fm-eq", field, value: rawValue };
}

// Serialize a SimpleCondition back to the canonical saved-row string. The
// round-trip parseSimpleRow(stringifySimpleCondition(c)) yields an equal
// condition; for tag values the '#' is added canonically.
export function stringifySimpleCondition(c: SimpleCondition): string {
	switch (c.kind) {
		case "tag-has":
			return `tag:#${stripHash(c.value)}`;
		case "tag-not":
			return `-tag:#${stripHash(c.value)}`;
		case "tag-any":
			return "tag:?";
		case "fm-eq":
			return `${c.field}:${c.value}`;
		case "fm-not":
			return `-${c.field}:${c.value}`;
		case "fm-any":
			return `${c.field}:?`;
	}
}

function stripHash(t: string): string {
	return t.startsWith("#") ? t.slice(1) : t;
}

// ────────────────────────────────────────────────────────────────────────────
// Candidate collection for the value dropdowns.
// ────────────────────────────────────────────────────────────────────────────

// All distinct field names available in the builder, split into the fixed Tag
// entry plus every real frontmatter key (reused from the suggest collector).
// Property keys that are reserved/unsupported by the parser are filtered out so
// they can't produce non-evaluable rows.
export interface BuilderSources {
	tags: string[]; // tag values without '#'
	fields: string[]; // simple frontmatter keys
}

export function buildBuilderSources(sources: SuggestSources): BuilderSources {
	const fields = sources.fields.filter(
		(f) => f !== TAG_FIELD && !isReservedNonSimpleField(f) && FM_FIELD_RE.test(f),
	);
	return { tags: [...sources.tags], fields };
}

// Distinct real values of one frontmatter property across the vault, for the
// Property → Equals value dropdown. Scalars and array members are flattened to
// strings; empty/objects are skipped. Sorted, deduped. Empty array ⇒ caller
// should fall back to a free-text value input.
export function collectPropertyValues(app: App, field: string): string[] {
	if (!field) return [];
	const out = new Set<string>();
	for (const f of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(f as TFile);
		const fm = cache?.frontmatter;
		if (!fm || typeof fm !== "object") continue;
		const v = (fm as Record<string, unknown>)[field];
		if (v == null) continue;
		if (Array.isArray(v)) {
			for (const item of v) addScalar(out, item);
		} else {
			addScalar(out, v);
		}
	}
	return [...out].sort();
}

function addScalar(set: Set<string>, v: unknown): void {
	if (v == null) return;
	if (typeof v === "object") return; // nested objects aren't simple values
	const s = String(v).trim();
	if (s.length > 0) set.add(s);
}

// Convenience: gather everything the builder UI needs from the live app in one
// call. Thin wrapper so the renderer stays declarative.
export function collectBuilderSources(app: App): BuilderSources {
	return buildBuilderSources(collectSuggestSources(app));
}

// ────────────────────────────────────────────────────────────────────────────
// Minimal tag-picker classification (for the beginner WHERE / GROUP_BY UI).
//
// The beginner UI shows ONE tag input + a list of the saved rows. Each saved
// row is classified here into how it should appear in that list:
//   • "tag"  — a plain `tag:#x` "Has this tag" row → shown as a tag chip with
//              the bare tag name, removable with ×.
//   • "raw"  — anything else (NOT / property / wildcard / AND-OR / parens /
//              tagN / …) → shown verbatim as read-only text, removable with ×.
//              These are created/edited via the Advanced (text) disclosure; the
//              beginner list never rewrites them, so no data is ever lost.
// Pure — no DOM, no app.
// ────────────────────────────────────────────────────────────────────────────

export interface TagPickerRow {
	// Index into the underlying rows[] array (the saved string array).
	index: number;
	// Original saved string (never mutated by the picker).
	raw: string;
	// "tag" ⇒ a plain positive tag chip; "raw" ⇒ verbatim advanced text.
	kind: "tag" | "raw";
	// For kind === "tag": the bare tag name (no '#'). Empty otherwise.
	tag: string;
}

export function classifyTagPickerRow(raw: string, index: number): TagPickerRow {
	const cond = parseSimpleRow(raw);
	if (cond && cond.kind === "tag-has") {
		return { index, raw, kind: "tag", tag: cond.value };
	}
	return { index, raw, kind: "raw", tag: "" };
}

export function classifyTagPickerRows(rows: string[]): TagPickerRow[] {
	return rows
		.map((raw, index) => classifyTagPickerRow(raw, index))
		// Blank rows aren't real conditions — never list them.
		.filter((r) => r.raw.trim() !== "");
}

// The canonical saved-row string for a beginner-picked tag. Mirrors the
// "tag-has" branch of stringifySimpleCondition so the round-trip is identical
// to a hand-typed `tag:#x` and the existing parser handles it unchanged.
export function tagRowString(tag: string): string {
	return stringifySimpleCondition({ kind: "tag-has", field: "tag", value: stripHash(tag.trim()) });
}
