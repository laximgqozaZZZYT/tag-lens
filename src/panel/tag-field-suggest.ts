
// Beginner-friendly typeahead for the SQL-like WHERE / GROUP_BY text inputs.
// It is a BEST-EFFORT input aid layered on top of the existing free-text box:
// selecting a suggestion only rewrites the editing token, it never changes the
// parser, the saved value semantics, or the row-edit pipeline.
//
// The hard parts (full query parsing) are deliberately avoided. We look only at
// the token the cursor is sitting in and offer:
//   • field-name candidates ("tag" + every frontmatter key) when the token has
//     no colon yet, and
//   • value candidates (real tag values) when the token starts with "tag:".

export interface SuggestItem {
	// Text shown as the primary label in the popover.
	display: string;
	// Secondary muted text (e.g. "tag" / "property" / "tag value"). Optional.
	hint?: string;
	// Full token text to substitute in place of the current editing token.
	insert: string;
}

// Collected, deduped candidate sources for the vault.
export interface SuggestSources {
	// Tag values WITHOUT the leading '#', e.g. "wip", "project/alpha".
	tags: string[];
	// Frontmatter property keys, e.g. "status", "priority".
	fields: string[];
}

// ── Pure token extraction ──────────────────────────────────────────────────
// Split the input around the caret into the token currently being edited plus
// the text before/after it. A "token" is the run of non-space, non-paren chars
// ending at the caret. This keeps boolean operators (AND/OR/NOT) and grouping
// parens as their own tokens, so completing inside `(tag:wi` only rewrites
// `tag:wi`.
export interface EditingToken {
	before: string; // text kept verbatim before the token
	token: string; // the token under the caret
	after: string; // text kept verbatim after the caret
}

const TOKEN_BOUNDARY = /[\s()]/;

export function extractEditingToken(value: string, caret: number): EditingToken {
	const pos = Math.max(0, Math.min(caret, value.length));
	let start = pos;
	while (start > 0 && !TOKEN_BOUNDARY.test(value[start - 1])) start--;
	const before = value.slice(0, start);
	const token = value.slice(start, pos);
	const after = value.slice(pos);
	return { before, token, after };
}

// ── Pure candidate filtering ────────────────────────────────────────────────
// Given the editing token and the vault sources, produce ranked suggestions.
// Behaviour:
//   • token contains ':' → complete the VALUE part. Only tag values are offered
//     when the field is "tag" (or "tagN"); for other fields we don't guess
//     arbitrary frontmatter values (too noisy), so we return [].
//   • token has no ':' → complete a FIELD NAME: "tag" plus every frontmatter
//     key whose name contains the typed prefix (case-insensitive substring).
// `limit` caps the popover size. Matching is a case-insensitive substring with
// prefix matches ranked first, then alphabetical.
export function computeSuggestions(
	token: string,
	sources: SuggestSources,
	limit = 20,
): SuggestItem[] {
	const colon = token.indexOf(":");
	if (colon >= 0) {
		const field = token.slice(0, colon);
		const rawValue = token.slice(colon + 1);
		// Only complete values for tag / tagN fields; leading '#' is optional.
		if (!/^tag\d*$/i.test(field)) return [];
		const stripped = rawValue.startsWith("#") ? rawValue.slice(1) : rawValue;
		const q = stripped.toLowerCase();
		const matches = rankMatches(sources.tags, q, limit);
		return matches.map((t) => ({
			display: t,
			hint: "tag value",
			insert: `${field}:${rawValue.startsWith("#") ? "#" : ""}${t}`,
		}));
	}

	// Field-name completion. "tag" is always offered, then frontmatter keys.
	const q = token.toLowerCase();
	const fieldNames = ["tag", ...sources.fields];
	const matches = rankMatches(dedupe(fieldNames), q, limit);
	return matches.map((name) => ({
		display: name,
		hint: name === "tag" ? "tag" : "property",
		insert: `${name}:`,
	}));
}

// Case-insensitive substring rank: prefix matches first, then alphabetical.
function rankMatches(pool: string[], q: string, limit: number): string[] {
	const filtered =
		q === ""
			? [...pool]
			: pool.filter((s) => s.toLowerCase().includes(q));
	filtered.sort((a, b) => {
		if (q !== "") {
			const ap = a.toLowerCase().startsWith(q) ? 0 : 1;
			const bp = b.toLowerCase().startsWith(q) ? 0 : 1;
			if (ap !== bp) return ap - bp;
		}
		return a.localeCompare(b);
	});
	return filtered.slice(0, limit);
}

function dedupe(arr: string[]): string[] {
	return [...new Set(arr)];
}
