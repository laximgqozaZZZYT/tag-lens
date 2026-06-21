// Fallback `.base` auto-generation. When a vault contains NO `.base` file at all,
// Bases mode would have nothing to scope to (blank Bases experience). To make
// every note graph-able out of the box, we synthesise an `_all.base` at the
// vault root.
//
// As of the tag-grouping change, the generated base is NOT a single match-all
// view. Instead we enumerate the vault's real tags and emit ONE view per tag
// (`filters: file.tags.contains("#<tag>")`, `name: "<tag>"`), so the graph is
// grouped by tag rather than collapsed into a single file-per-cluster blob.
//
// Degenerate case — a vault with ZERO tags — preserves the historical behaviour:
// a single no-filter `All notes` view (match-all over every note).
//
// Strict, non-destructive contract (see ensureFallbackBase):
//   - Generate ONLY when `scanBaseFiles` is empty (zero `.base` of any name).
//   - Never overwrite an existing file (idempotent; reuse a prior `_all.base`).
//   - Any failure returns null and is swallowed so rebuild() is never broken.

import type { App, CachedMetadata, TFile } from "obsidian";
import { scanBaseFiles } from "./parser";

// Vault-root path of the auto-generated fallback base.
export const FALLBACK_BASE_PATH = "_all.base";

// Max number of tag-views emitted into the fallback base. A vault can hold
// hundreds/thousands of distinct tags; one view each would bloat the `.base`
// file and the graph legend without adding signal. We keep the most frequent
// tags (by note count) and drop the long tail (recorded as a YAML comment so
// the omission is visible). 50 is a pragmatic ceiling: enough to cover a
// typical vault's meaningful tag taxonomy while staying legible.
export const FALLBACK_MAX_TAG_VIEWS = 50;

// YAML body for the degenerate (zero-tag) fallback: a single table view over
// ALL notes. The ABSENCE of a `filters` key is deliberate — parseBaseFilter(
// undefined) → null → evalBaseFilter(null, facts) === true ⇒ every note matches.
export const FALLBACK_BASE_CONTENT = `views:
  - type: table
    name: All notes
    order:
      - file.name
`;

// Pure predicate so tests can verify the gate without an Obsidian runtime:
// generate ONLY when there is not a single `.base` file in the vault.
export function shouldGenerateFallback(baseFilePaths: readonly string[]): boolean {
	return baseFilePaths.length === 0;
}

// Lightweight tag collector — originally mirrored from the legacy SQL parser,
// now kept local to avoid depending on heavy graph-build modules.
// Reads inline tags (cache.tags) and frontmatter tags, strips a leading '#'.
function collectTags(cache: CachedMetadata | null): string[] {
	if (!cache) return [];
	const out: string[] = [];
	if (cache.tags) for (const t of cache.tags) out.push(stripHash(t.tag));
	const fm = (cache.frontmatter as Record<string, unknown> | undefined)?.tags;
	if (Array.isArray(fm)) for (const t of fm) out.push(stripHash(String(t)));
	else if (typeof fm === "string") out.push(stripHash(fm));
	return out;
}

// Count distinct tags across the vault, deduplicating per note so a note that
// repeats a tag inline + in frontmatter counts once. Returns [tag, noteCount].
export function countVaultTags(app: App): Array<[string, number]> {
	const counts = new Map<string, number>();
	for (const f of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(f);
		const seen = new Set<string>();
		for (const t of collectTags(cache)) {
			if (!t || seen.has(t)) continue;
			seen.add(t);
			counts.set(t, (counts.get(t) ?? 0) + 1);
		}
	}
	return [...counts.entries()];
}

// Pick the top-N tags by note frequency (ties broken alphabetically for a
// stable, deterministic output). Pure so tests can drive it with a synthetic
// frequency map.
export function topTags(
	tagCounts: ReadonlyArray<readonly [string, number]>,
	limit: number = FALLBACK_MAX_TAG_VIEWS,
): string[] {
	return [...tagCounts]
		.sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
		.slice(0, Math.max(0, limit))
		.map(([tag]) => tag);
}

// Escape a tag for safe embedding inside a double-quoted YAML scalar. Tags may
// (rarely) contain characters that would break the quoted string; we escape the
// two that matter for a double-quoted YAML flow scalar.
function yamlQuote(s: string): string {
	return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Build the `_all.base` YAML for a given ordered tag list. One view per tag,
// each filtering `file.tags.contains("#<tag>")`. Empty list → degenerate
// single match-all view (historical behaviour). Pure / runtime-free so tests
// can assert the emitted structure end-to-end through parseBaseStructure.
export function buildFallbackContent(tags: readonly string[]): string {
	if (tags.length === 0) return FALLBACK_BASE_CONTENT;

	const lines: string[] = ["views:"];
	for (const tag of tags) {
		lines.push(`  - type: table`);
		lines.push(`    name: ${yamlQuote(tag)}`);
		lines.push(`    filters: ${yamlQuote(`file.tags.contains("#${tag}")`)}`);
		lines.push(`    order:`);
		lines.push(`      - file.name`);
	}
	return lines.join("\n") + "\n";
}

// Decide the YAML body to write for THIS vault: enumerate real tags, keep the
// top-N by frequency, emit one view per tag. Tag-less notes are intentionally
// NOT grouped — the `.base` grammar can express "has tag X" but not robustly
// "has none of {X…}", so a "(none)" view would be brittle; we simply omit them
// (they still appear once the user creates their own tag-bearing base). When the
// vault has zero tags we fall back to the single match-all `All notes` view.
export function buildFallbackContentForVault(app: App): string {
	const counts = countVaultTags(app);
	const kept = topTags(counts);
	const content = buildFallbackContent(kept);

	const omitted = counts.length - kept.length;
	if (omitted > 0) {
		const header = `# tag-lens: ${kept.length} of ${counts.length} tags shown (top by frequency); ${omitted} omitted.\n`;
		return header + content;
	}
	return content;
}

// Create `_all.base` at the vault root IFF the vault has zero `.base` files.
// Idempotent: with any `.base` present (including a prior `_all.base`) this is a
// no-op. Returns the (possibly pre-existing) fallback TFile, or null on failure
// / when generation is gated off. Never throws.
export async function ensureFallbackBase(app: App): Promise<TFile | null> {
	try {
		const existing = scanBaseFiles(app);
		if (!shouldGenerateFallback(existing.map((f) => f.path))) {
			// A `.base` already exists somewhere — never write into the vault.
			return null;
		}

		// Defensive: if `_all.base` already exists (e.g. a stale non-`.base`
		// extension edge case), reuse it instead of creating a duplicate.
		const prior = app.vault.getAbstractFileByPath(FALLBACK_BASE_PATH);
		if (prior && isTFile(prior)) return prior;

		const content = buildFallbackContentForVault(app);
		const created = await app.vault.create(FALLBACK_BASE_PATH, content);
		return created;
	} catch (e) {
		console.warn("[tag-lens] ensureFallbackBase failed (continuing without fallback):", e);
		return null;
	}
}

function isTFile(f: unknown): f is TFile {
	return typeof f === "object" && f !== null && "extension" in f && "stat" in f;
}

function stripHash(t: string): string {
	return t.startsWith("#") ? t.slice(1) : t;
}
