// Shared, pure tag collector for the Bases pipeline (build-index + fallback).
// Type-only Obsidian import (erased at build), so it stays unit-testable without
// an Obsidian runtime.
//
// Mirrors the main pipeline's authoritative behaviour (src/insight/compute.ts):
// inline `cache.tags`, plus frontmatter `tags` as EITHER a YAML list OR a
// comma-separated string — the string form is split on `,` and each piece
// trimmed. A single un-split string would produce a bogus tag like
// "書籍, 小説", dropping those notes out of tag-filtered `.base` graphs.

import type { CachedMetadata } from "obsidian";

export function collectTags(cache: CachedMetadata | null): string[] {
	if (!cache) return [];
	const out: string[] = [];
	if (cache.tags) for (const t of cache.tags) push(out, t.tag);
	const fm = cache.frontmatter?.tags as unknown;
	if (Array.isArray(fm)) {
		for (const t of fm) push(out, String(t));
	} else if (typeof fm === "string") {
		for (const t of fm.split(",")) push(out, t);
	}
	return out;
}

// Normalise one raw tag token: strip a leading '#', trim, and drop if empty.
function push(out: string[], raw: string): void {
	const t = stripHash(raw).trim();
	if (t) out.push(t);
}

function stripHash(t: string): string {
	return t.startsWith("#") ? t.slice(1) : t;
}
