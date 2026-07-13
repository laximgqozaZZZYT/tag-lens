// Orchestrates the full Bases index: scan → parse selected `.base` files →
// build every note's FileFacts once → resolve each view's elements → aggregate
// → build relations → adjacency. The Obsidian-specific glue (facts, forward
// links) lives here; the heavy lifting is delegated to the pure modules.

import type { App, TFile } from "obsidian";
import type { FileFacts } from "../query/query";
import { collectTags } from "./collect-tags";
import { buildRelations } from "./relations";
import { resolveElements } from "./resolve";
import { parseBaseFile, scanBaseFiles } from "./parser";
import type { BaseElement, BaseIndex, BaseTable, BuildIndexOpts } from "./types";

export async function buildBaseIndex(
	app: App,
	selectedPaths: string[],
	opts: BuildIndexOpts,
): Promise<BaseIndex> {
	const errors: string[] = [];
	const empty = (): BaseIndex => ({
		tables: [],
		elements: new Map(),
		byTable: new Map(),
		relations: [],
		adjacency: new Map(),
		errors,
	});

	const selected = new Set(selectedPaths);
	if (selected.size === 0) return empty();

	// 1. Parse the selected base files.
	const tables: BaseTable[] = [];
	let baseFiles: TFile[] = [];
	try {
		baseFiles = scanBaseFiles(app).filter((f) => selected.has(f.path));
	} catch (e) {
		errors.push(`scanBaseFiles failed: ${msg(e)}`);
		return empty();
	}
	for (const f of baseFiles) {
		try {
			tables.push(await parseBaseFile(app, f));
		} catch (e) {
			errors.push(`parse ${f.path} failed: ${msg(e)}`);
		}
	}
	if (tables.length === 0) return { ...empty(), tables };

	// 2. Build FileFacts for every note ONCE (avoids re-scanning per base/view).
	let factsByPath: Map<string, FileFacts>;
	let forwardLinks: Map<string, string[]>;
	try {
		factsByPath = buildFacts(app);
		forwardLinks = buildForwardLinks(app, opts.resolvedLinks);
	} catch (e) {
		errors.push(`facts/link build failed: ${msg(e)}`);
		return { ...empty(), tables };
	}

	// 3. Resolve elements per view; aggregate into elements + byTable.
	const elements = new Map<string, BaseElement>();
	const byTable = new Map<string, string[]>();
	for (const table of tables) {
		const keysForTable: string[] = byTable.get(table.filePath) ?? [];
		for (const view of table.views) {
			try {
				const els = resolveElements(table, view, factsByPath, forwardLinks);
				for (const el of els) {
					elements.set(el.key, el);
					keysForTable.push(el.key);
				}
			} catch (e) {
				errors.push(`resolve ${table.filePath}/${view.name} failed: ${msg(e)}`);
			}
		}
		byTable.set(table.filePath, keysForTable);
	}

	// 4. Relations.
	let relations: BaseIndex["relations"] = [];
	let adjacency: BaseIndex["adjacency"] = new Map();
	try {
		const r = buildRelations([...elements.values()], {
			link: opts.link,
			sharedTag: opts.sharedTag,
			sharedProp: opts.sharedProp,
		});
		relations = r.relations;
		adjacency = r.adjacency;
		for (const w of r.warnings) errors.push(w);
	} catch (e) {
		errors.push(`buildRelations failed: ${msg(e)}`);
	}

	return { tables, elements, byTable, relations, adjacency, errors };
}

// --- Obsidian glue (mirrors src/query/query.ts) ---

function buildFacts(app: App): Map<string, FileFacts> {
	const files = app.vault.getMarkdownFiles();

	const allTags = new Set<string>();
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		for (const t of collectTags(cache)) allTags.add(t);
	}

	const tagProperties: Record<string, Record<string, unknown>> = {};
	for (const t of allTags) {
		const dest = app.metadataCache.getFirstLinkpathDest(t, "");
		if (dest) {
			const c = app.metadataCache.getFileCache(dest);
			if (c?.frontmatter) tagProperties[t] = c.frontmatter as Record<string, unknown>;
		}
	}

	const map = new Map<string, FileFacts>();
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		map.set(f.path, {
			path: f.path,
			tags: collectTags(cache),
			frontmatter: (cache?.frontmatter as Record<string, unknown>) ?? {},
			tagProperties,
		});
	}
	return map;
}

// note path → forward-link target paths. Uses an injected resolvedLinks map when
// provided (testability), else reads metadataCache.resolvedLinks.
function buildForwardLinks(
	app: App,
	injected?: Record<string, Record<string, number>>,
): Map<string, string[]> {
	const resolved = injected ?? app.metadataCache.resolvedLinks;
	const map = new Map<string, string[]>();
	for (const src in resolved) {
		map.set(src, Object.keys(resolved[src]));
	}
	return map;
}

function msg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
