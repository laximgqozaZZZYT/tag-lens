// Navigator note projection: turn the laid-out GraphNodes into searchable
// NoteRefs, reading tags/frontmatter from Obsidian's metadataCache. Extracted
// from view.ts (DI pattern) — note-menu.ts itself stays pure/DOM-less; this is
// the one place Obsidian metadata is read for the navigator. Behaviour-preserving.
import { App, TFile } from "obsidian";
import type { GraphNode, GraphData, MiniSettings } from "../types";
import { stripTabPrefix } from "../note-menu";
import { resolveEffectiveHaving, computeDegreeMaps } from "../rebuild-pipeline";
import { computeDroppedClusters, getSortKey } from "../query-pipeline";
import { applyLimitRules, type LimitRule } from "../limit";
import { filterMemberships } from "../query-filters";

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

// Build the navigator's universal note set MODE-INDEPENDENTLY: re-run the user's
// REAL HAVING + LIMIT (stages 1-2) on the pristine post-buildGraph graph so the
// same vault + settings yield an identical list in every NON-droste mode.
// Returns the surviving (un-projected) GraphNodes so the caller can pick this OR
// the full droste snapshot before the single projection pass.
export function menuLimitedNodes(
	source: GraphData,
	deps: { app: App; settings: MiniSettings; tiers: LimitRule[] },
): GraphNode[] {
	const { app, settings, tiers } = deps;
	// 1. HAVING — using the user's real havingAuto (mode-independent).
	let graph: GraphData = { nodes: source.nodes.slice(), edges: source.edges.slice() };
	const eff = resolveEffectiveHaving(
		settings.having,
		settings.havingAuto,
		graph.nodes.length,
	);
	const { dropped } = computeDroppedClusters(
		graph.nodes,
		eff,
		settings.havingAuto,
	);
	if (settings.havingMode !== "highlight" && dropped.size > 0) {
		const droppedSet = new Set(dropped.keys());
		graph = filterMemberships(graph, droppedSet);
	}

	// 2. LIMIT — same rules as the canvas, ranked by a SELF-CONTAINED degree map
	//    (from this graph's own edges) + this graph's memberships, so the selection
	//    never depends on the mode-specific on-canvas state.
	const degreeMap = computeDegreeMaps(graph.edges).degreeMap;
	const membById = new Map(graph.nodes.map((n) => [n.id, n.memberships]));
	const { visibleNodes } = applyLimitRules(
		graph.nodes,
		tiers,
		settings.orderField,
		settings.orderDir,
		(id, field) =>
			getSortKey(id, field, {
				app,
				degreeMap,
				membershipsOf: (nid) => membById.get(nid),
			}),
	);
	return visibleNodes;
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
