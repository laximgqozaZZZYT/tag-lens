import { App, TFile } from "obsidian";
import type { GraphNode, MiniSettings } from "../types";


// Inputs the sort-key resolver needs from the surrounding view.
export interface SortKeyDeps {
	app: App;
	degreeMap: Map<string, number>;
	membershipsOf: (id: string) => string[] | undefined;
}

// Resolve a sort-key value for a node id. Supports built-in file fields
// (name / path / mtime / ctime / size / extension), graph-derived fields
// (degree, memberships), random shuffling, and any frontmatter field by
// name (default fallback).
export function getSortKey(
	id: string,
	field: string,
	deps: SortKeyDeps,
): string | number {
	const f = deps.app.vault.getAbstractFileByPath(id);
	if (!(f instanceof TFile)) return "";
	switch (field) {
		case "name":
			return f.basename;
		case "path":
			return f.path;
		case "extension":
			return f.extension;
		case "mtime":
			return f.stat.mtime;
		case "ctime":
			return f.stat.ctime;
		case "size":
			return f.stat.size;
		case "degree":
			return deps.degreeMap.get(id) ?? 0;
		case "memberships":
			return deps.membershipsOf(id)?.length ?? 0;
		case "random":
			return Math.random();
		case "title": {
			const cache = deps.app.metadataCache.getFileCache(f);
			const v = cache?.frontmatter?.title as unknown;
			return v != null ? String(v) : f.basename;
		}
		default: {
			const cache = deps.app.metadataCache.getFileCache(f);
			const v = cache?.frontmatter?.[field] as unknown;
			if (v == null) return "";
			return Array.isArray(v) ? String(v[0]) : String(v);
		}
	}
}


