import type { App } from "obsidian";
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
		const cache = app.metadataCache.getFileCache(f);
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

// Gather the distinct values of EVERY builder-simple frontmatter field, capped
// per field, so the picker can offer "field: value" candidates without a second
// vault pass per keystroke. Returns a field → values[] map (values pre-capped).
// Reuses collectPropertyValues (one pass per field); the field set is small
// (frontmatter keys), so this stays cheap and is gathered once per render.
export function collectPropertyValueMap(
	app: App,
	fields: string[],
	cap = PROPERTY_VALUE_CANDIDATE_CAP,
): Record<string, string[]> {
	const map: Record<string, string[]> = {};
	for (const field of fields) {
		map[field] = collectPropertyValues(app, field).slice(0, cap);
	}
	return map;
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

// Human-readable label for a saved row in the picker's selected-row list. A row
// that parses to one of the SIX simple conditions gets a friendly label (so
// property and auto-split rows no longer fall through to raw monospace text);
// anything else is returned verbatim so its exact text is shown unchanged.
//
// Returns BOTH the display text and whether it is a "simple" (recognised) row.
// The renderer styles raw rows differently (monospace, muted) and shows them as
// non-editable advanced conditions, exactly as before.
export interface TagPickerRowLabel {
	text: string;
	// true ⇒ one of the six simple conditions (friendly label); false ⇒ raw
	// advanced text shown verbatim.
	simple: boolean;
}

export function tagPickerRowLabel(raw: string): TagPickerRowLabel {
	const c = parseSimpleRow(raw);
	if (!c) return { text: raw.trim(), simple: false };
	switch (c.kind) {
		case "tag-has":
			return { text: `#${c.value}`, simple: true };
		case "tag-not":
			return { text: `not #${c.value}`, simple: true };
		case "tag-any":
			return { text: "One group per tag (auto-split)", simple: true };
		case "fm-eq":
			return { text: `${c.field}: ${c.value}`, simple: true };
		case "fm-not":
			return { text: `${c.field} not ${c.value}`, simple: true };
		case "fm-any":
			return { text: `One group per ${c.field} value (auto-split)`, simple: true };
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Mixed candidate generation for the beginner picker's ONE input.
//
// The picker keeps its single text input + suggestion popover + chip list. What
// changes is ONLY the CONTENT of the popover: instead of tag names alone, it now
// offers four candidate kinds, all of which insert a SIMPLE saved-row string the
// existing parser already understands. No new input widget, no new save format.
//
//   kind "tag"        → `tag:#<name>`     pick a tag value
//   kind "property"   → `<field>:<value>` pick a property = value pair
//   kind "tag-split"  → `tag:?`           one group per tag (auto-split)
//   kind "field-split"→ `<field>:?`       one group per property value
//
// All candidates carry the exact `insert` string written into rows[] on pick,
// plus a primary label + a muted type hint for the popover. Pure — no DOM/app.
// ────────────────────────────────────────────────────────────────────────────

export type PickerCandidateKind = "tag" | "property" | "tag-split" | "field-split";

export interface PickerCandidate {
	kind: PickerCandidateKind;
	// Primary popover label.
	label: string;
	// Muted secondary hint shown after the label ("tag", "property", "split").
	hint: string;
	// The canonical saved-row string appended to rows[] when this is picked.
	insert: string;
}

// Per-property cap on how many distinct values become "property = value"
// candidates. A property with hundreds of distinct values (e.g. a free-text
// title) would otherwise flood the popover and bury the tag candidates; 10 keeps
// the common enum-like properties (status, priority, type, stage) fully usable
// while bounding the candidate count. Values beyond the cap are reachable via
// the Advanced (text) editor, and the "auto-split" candidate covers "all values".
export const PROPERTY_VALUE_CANDIDATE_CAP = 10;

// Overall popover cap (mirrors the tag-only suggester's previous slice(0, 20)).
export const PICKER_CANDIDATE_CAP = 20;

// Build the full, UNFILTERED candidate pool from vault sources + the per-field
// value map. Ordering inside the pool is: auto-split-all-tags, then tag values,
// then per property [its auto-split, then its capped values]. The query filter
// (computePickerCandidates) re-ranks/limits this pool; this function only shapes
// it so the pure value collection is testable in isolation.
//
// `propertyValues` maps a (builder-simple) field name → its distinct vault
// values (already collected via collectPropertyValues, capped by the caller or
// here). Fields absent from the map contribute only an auto-split candidate.
export function buildPickerCandidates(
	sources: BuilderSources,
	propertyValues: Record<string, string[]>,
	valueCap = PROPERTY_VALUE_CANDIDATE_CAP,
): PickerCandidate[] {
	const out: PickerCandidate[] = [];

	// 1. Auto-split-all-tags — the headline "tag:?" capability. Always first so a
	//    user who just focuses the empty input sees it at the top.
	out.push({
		kind: "tag-split",
		label: "Show one group per tag (auto-split)",
		hint: "split",
		insert: "tag:?",
	});

	// 2. Tag values.
	for (const t of sources.tags) {
		out.push({ kind: "tag", label: `#${t}`, hint: "tag", insert: tagRowString(t) });
	}

	// 3. Per property: its auto-split, then its capped distinct values.
	for (const field of sources.fields) {
		out.push({
			kind: "field-split",
			label: `Show one group per ${field} value (auto-split)`,
			hint: "split",
			insert: stringifySimpleCondition({ kind: "fm-any", field, value: "" }),
		});
		const values = propertyValues[field] ?? [];
		for (const v of values.slice(0, valueCap)) {
			out.push({
				kind: "property",
				label: `${field}: ${v}`,
				hint: "property",
				insert: stringifySimpleCondition({ kind: "fm-eq", field, value: v }),
			});
		}
	}

	return out;
}

// Filter + rank + cap the candidate pool against the typed query. Matching is a
// case-insensitive substring over the label (so "status: dr" and "dr" both find
// "status: draft", and "char" finds the #character tag). Empty query ⇒ the pool
// head (auto-split + first tags …) up to the cap, so focusing the empty input
// surfaces the auto-split capability immediately. Already-present inserts are
// excluded so the user can't add a duplicate row. Pure — no DOM/app.
export function computePickerCandidates(
	pool: PickerCandidate[],
	query: string,
	existingRows: string[],
	limit = PICKER_CANDIDATE_CAP,
): PickerCandidate[] {
	const q = query.trim().toLowerCase();
	const present = new Set(existingRows.map((r) => r.trim()));
	const eligible = pool.filter((c) => !present.has(c.insert.trim()));
	const filtered =
		q === "" ? eligible : eligible.filter((c) => c.label.toLowerCase().includes(q));
	if (q === "") return filtered.slice(0, limit);
	// Prefix matches (on the label) rank before mere substring matches.
	filtered.sort((a, b) => {
		const ap = a.label.toLowerCase().startsWith(q) ? 0 : 1;
		const bp = b.label.toLowerCase().startsWith(q) ? 0 : 1;
		if (ap !== bp) return ap - bp;
		return 0;
	});
	return filtered.slice(0, limit);
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
