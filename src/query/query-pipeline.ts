import { App, TFile } from "obsidian";
import type { GraphNode, MiniSettings } from "../types";
import { NONE_BUCKET } from "../types";
import { type LimitRule, parseLimitRow } from "./limit";
import { parseHaving } from "./query-filters";

// Parse the LIMIT setting's manual rows plus auto-injected defaults.
// Returns the resolved tier list AND any parse error messages so the
// caller can surface them in the panel.
export function parseLimitRules(settings: MiniSettings): {
	tiers: LimitRule[];
	errors: string[];
} {
	const errors: string[] = [];
	const parse = (s: string): LimitRule | null => {
		try {
			return parseLimitRow(s);
		} catch (e) {
			errors.push(e instanceof Error ? e.message : String(e));
			return null;
		}
	};
	const manualRows = settings.limit
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	const manual: LimitRule[] = [];
	for (const r of manualRows) {
		const p = parse(r);
		// Skip non-positive tiers (= "limit 0" / "brief 0"). Those resolve
		// to "show zero items" which would otherwise wipe the canvas.
		// Treat them as no-op so the user can disable a rule by setting it
		// to 0 without losing the whole view.
		if (p && p.n > 0) manual.push(p);
	}
	if (settings.limitAuto) {
		const hasLimit = manual.some((r) => r.kind === "limit");
		const hasBrief = manual.some((r) => r.kind === "brief");
		if (!hasLimit) manual.push({ kind: "limit", n: 15 });
		if (!hasBrief) manual.push({ kind: "brief", n: 30 });
	}
	return { tiers: manual, errors };
}

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

// Parse + evaluate HAVING. Counts come from `nodes` BEFORE any cluster
// drop so the test runs against the input partitioning. Returns the set
// of cluster keys that fail the HAVING conditions plus any HAVING parse
// errors. With `havingAuto`, the top-K cap and NONE_BUCKET suppression
// are layered on top of the manual rules.
export function computeDroppedClusters(
	nodes: GraphNode[],
	rawRows: string[],
	havingAuto: boolean,
	context: { _noteCount: number },
): { dropped: Map<string, number>; errors: string[] } {
	const errors: string[] = [];
	const dropped = new Map<string, number>();
	const counts = new Map<string, number>();
	for (const n of nodes) {
		for (const m of n.memberships) {
			counts.set(m, (counts.get(m) ?? 0) + 1);
		}
	}

	// AUTO: top-K cap — keep only the K largest clusters. This trims a
	// noisy long tail of mid-sized clusters that count thresholds alone
	// don't catch.
	if (havingAuto) {
		const TOP_K = 20;
		const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
		for (let i = TOP_K; i < sorted.length; i++) {
			dropped.set(sorted[i][0], sorted[i][1]);
		}
		// NONE_BUCKET is always suppressed when auto is on (its members
		// would otherwise have been removed by SQL HAVING anyway).
		dropped.set(NONE_BUCKET, counts.get(NONE_BUCKET) ?? 0);
	}

	const rows = rawRows.map((s) => s.trim()).filter((s) => s.length > 0);
	if (rows.length > 0) {
		const tests: ((count: number) => boolean)[] = [];
		for (const r of rows) {
			try {
				tests.push(parseHaving(r, context));
			} catch (e) {
				errors.push(e instanceof Error ? e.message : String(e));
			}
		}
		for (const [key, count] of counts) {
			if (dropped.has(key)) continue;
			for (const t of tests) {
				if (!t(count)) {
					dropped.set(key, count);
					break;
				}
			}
		}
	}
	return { dropped, errors };
}
