// Navigator note projection: turn the laid-out GraphNodes into searchable
// NoteRefs, reading tags/frontmatter from Obsidian's metadataCache. Extracted
// from view.ts (DI pattern) — note-menu.ts itself stays pure/DOM-less; this is
// the one place Obsidian metadata is read for the navigator. Behaviour-preserving.
import { App, TFile } from "obsidian";
import type { GraphNode } from "../types";
import { stripTabPrefix } from "../interaction/note-menu";


// Concrete projected note shape (matches view's `menuNotes` field).
export interface MenuNote {
	id: string;
	label: string;
	memberships: string[];
	path: string;
	tags: string[];
	frontmatter: Record<string, string[]>;
}

// Collect a note's searchable tags + frontmatter from Obsidian's metadataCache
// for the advanced navigator search. Robust to a missing file/cache (returns
// empty tags + frontmatter).
//   • tags        — combined from (a) the note's GROUP_BY `memberships` (decoded;
//                   only the tag-derived ones), (b) frontmatter `tags`, and
//                   (c) inline cache.tags. Leading '#' stripped, hierarchy kept, deduped.
//   • frontmatter — every frontmatter key (except the internal `position`)
//                   flattened to an array of string values.
export function noteSearchMeta(
	app: App,
	path: string,
	memberships: string[],
): { tags: string[]; frontmatter: Record<string, string[]> } {
	const tagSet = new Set<string>();
	const stripHash = (t: string): string => (t.startsWith("#") ? t.slice(1) : t);
	// (a) memberships → decode "key=value" group keys; keep the value as a tag.
	for (const m of memberships) {
		if (m.length === 0) continue;
		// Group keys look like "tag=value" / "key=value" (value URI-encoded) or a
		// bare bucket name ("all", "(none)"). Take the value half if a '=' is present.
		const eq = m.indexOf("=");
		let raw = eq >= 0 ? m.slice(eq + 1) : m;
		try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
		raw = stripHash(raw);
		if (raw.length > 0) tagSet.add(raw);
	}
	const frontmatter: Record<string, string[]> = {};
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		const cache = app.metadataCache.getFileCache(file);
		// (b) frontmatter `tags` + (c) inline cache.tags.
		if (cache?.tags) for (const t of cache.tags) tagSet.add(stripHash(t.tag));
		const fm = cache?.frontmatter as Record<string, unknown> | undefined;
		const fmTags = fm?.tags;
		if (Array.isArray(fmTags)) for (const t of fmTags) tagSet.add(stripHash(String(t)));
		else if (typeof fmTags === "string") tagSet.add(stripHash(fmTags));
		// Flatten every frontmatter key (skip the internal `position` key).
		if (fm) {
			for (const key of Object.keys(fm)) {
				if (key === "position") continue;
				const v = fm[key];
				if (v === null || v === undefined) { frontmatter[key] = []; continue; }
				frontmatter[key] = Array.isArray(v) ? v.map((x) => String(x)) : [String(v)];
			}
		}
	}
	return { tags: [...tagSet], frontmatter };
}


// Project navigator GraphNodes to MenuNotes, backfilling search metadata
// (tags/frontmatter) from Obsidian's metadataCache.
export function projectMenuNotes(nodes: GraphNode[], app: App): MenuNote[] {
	return nodes.map((n) => {
		const memberships = n.memberships ?? [];
		const path = stripTabPrefix(n.id);
		const { tags, frontmatter } = noteSearchMeta(app, path, memberships);
		return { id: n.id, label: n.label, memberships, path, tags, frontmatter };
	});
}
