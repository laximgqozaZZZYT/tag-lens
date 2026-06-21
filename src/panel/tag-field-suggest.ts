import { AbstractInputSuggest, type App, type TFile } from "obsidian";

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

// ── Vault source collection ─────────────────────────────────────────────────
// Walks markdown files via the public metadataCache. Mirrors the lightweight
// tag-collection approach already used in src/query/parser.ts (inline tags +
// frontmatter `tags`), and additionally gathers all frontmatter KEYS. Kept here
// (not imported from parser.ts) to avoid pulling the heavy graph-build module
// into the settings panel; this is a small, intentional duplicate.
export function collectSuggestSources(app: App): SuggestSources {
	const tags = new Set<string>();
	const fields = new Set<string>();
	const files = app.vault.getMarkdownFiles();
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f as TFile);
		if (!cache) continue;
		if (cache.tags) {
			for (const t of cache.tags) tags.add(stripHash(t.tag));
		}
		const fm = cache.frontmatter;
		if (fm && typeof fm === "object") {
			for (const key of Object.keys(fm)) {
				if (key === "position") continue; // internal cache artefact
				fields.add(key);
			}
			const fmTags = (fm as Record<string, unknown>).tags;
			if (Array.isArray(fmTags)) {
				for (const t of fmTags) tags.add(stripHash(String(t)));
			} else if (typeof fmTags === "string") {
				tags.add(stripHash(fmTags));
			}
		}
	}
	return {
		tags: [...tags].filter((t) => t.length > 0).sort(),
		fields: [...fields].sort(),
	};
}

function stripHash(t: string): string {
	return t.startsWith("#") ? t.slice(1) : t;
}

// AbstractInputSuggest binding for a WHERE / GROUP_BY <input>. On pick it
// rewrites ONLY the editing token, fires an `input` event so any debounced
// listeners react, keeps the caret just after the inserted text, and re-opens
// the popover so the user can continue (e.g. type a value right after a field).
export class TagFieldSuggest extends AbstractInputSuggest<SuggestItem> {
	constructor(
		app: App,
		private readonly textInput: HTMLInputElement,
		private readonly getSources: () => SuggestSources,
	) {
		super(app, textInput);
	}

	protected getSuggestions(_query: string): SuggestItem[] {
		const caret = this.textInput.selectionStart ?? this.textInput.value.length;
		const { token } = extractEditingToken(this.textInput.value, caret);
		return computeSuggestions(token, this.getSources());
	}

	renderSuggestion(item: SuggestItem, el: HTMLElement): void {
		el.createSpan({ text: item.display });
		if (item.hint) {
			const sub = el.createSpan({ text: `  ${item.hint}` });
			sub.setCssStyles({ fontSize: "10px", color: "var(--text-muted)" });
		}
	}

	selectSuggestion(item: SuggestItem): void {
		const caret = this.textInput.selectionStart ?? this.textInput.value.length;
		const { before, after } = extractEditingToken(this.textInput.value, caret);
		const newValue = before + item.insert + after;
		this.textInput.value = newValue;
		const newCaret = (before + item.insert).length;
		this.textInput.setSelectionRange(newCaret, newCaret);
		this.textInput.focus();
		// Fire `input` so AbstractInputSuggest re-queries (a field pick can flow
		// straight into value completion) and any live listeners update. The
		// existing row `change` handler still commits on blur/Enter exactly as
		// before — selection only edits the in-progress text, never saves.
		this.textInput.dispatchEvent(new Event("input"));
	}
}
