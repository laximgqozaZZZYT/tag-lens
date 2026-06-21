import type { App, CachedMetadata, TFile } from "obsidian";
import { GraphData, GraphEdge, GraphNode, NONE_BUCKET } from "../types";
import { suggestMaturity, effectiveMaturity } from "./tag-classification";
import { evalQuery, isMatched, parseQuery, type FileFacts, type QueryAst } from "./query";

export interface BuildResult {
	data: GraphData;
	clusterLabels: Map<string, string>;
}

export interface BuildErrors {
	where?: string;
	groupBy?: string;
}

// Combine multiple expression rows into one AST by AND-ing them. Empty rows
// are skipped. Returns null when nothing to parse.
function combineRows(rows: string[]): { ast: QueryAst | null; text: string } {
	const trimmed = rows.map((r) => r.trim()).filter((r) => r.length > 0);
	if (trimmed.length === 0) return { ast: null, text: "" };
	const text =
		trimmed.length === 1 ? trimmed[0] : trimmed.map((r) => `(${r})`).join(" AND ");
	return { ast: parseQuery(text), text };
}

// Result shape for Dataview's public `api.query()` — a Result<QueryResult,string>.
// We only rely on `.successful` + `.value` (deep-scanned) + `.error`; the exact
// internal QueryResult shape (which differs per TABLE/LIST/TASK/CALENDAR) is NOT
// assumed.
interface DataviewQueryResult {
	successful: boolean;
	value?: unknown;
	error?: string;
}

interface DataviewApiLike {
	pages: (source?: string) => unknown;
	// Public DQL evaluator: parses + fully evaluates a DQL query (FROM/WHERE/SORT/
	// GROUP BY/FLATTEN) using Dataview's own engine. Optional — older builds may
	// lack it; existence is duck-typed before use.
	query?: (
		source: string,
		originFile?: string,
		settings?: unknown,
	) => Promise<DataviewQueryResult>;
}

function getDataviewApi(app: App): DataviewApiLike | null {
	const pluginsHost = (app as App & { plugins?: { plugins?: Record<string, unknown> } }).plugins;
	const dvPlugin = pluginsHost?.plugins?.["dataview"] as { api?: unknown } | undefined;
	const api = dvPlugin?.api as DataviewApiLike | undefined;
	if (!api || typeof api.pages !== "function") return null;
	return api;
}

function looksLikeDataviewSource(text: string): boolean {
	const t = text.trim();
	if (!t) return false;
	if (/^(TABLE|LIST|TASK|CALENDAR)\b/i.test(t)) return true;
	if (/\bFROM\b/i.test(t)) return true;
	if (/\breturn\b/i.test(t)) return false;
	if (/\bdv\./i.test(t)) return false;
	if (/[{};]/.test(t)) return false;
	return true;
}

function toItems(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (value && typeof value === "object") {
		const maybeArray = value as { array?: () => unknown };
		if (typeof maybeArray.array === "function") {
			const arr = maybeArray.array();
			if (Array.isArray(arr)) return arr;
		}
	}
	return [value];
}

function itemToPath(item: unknown): string | null {
	if (typeof item === "string") return item;
	if (!item || typeof item !== "object") return null;
	const page = item as { path?: unknown; file?: { path?: unknown } };
	if (typeof page.path === "string") return page.path;
	if (page.file && typeof page.file.path === "string") return page.file.path;
	return null;
}

// Resolve a raw vault-path string to a path that exists in `allPaths`, following
// Obsidian linkpath resolution for shorthand names. Returns null when nothing
// resolves into the known vault.
function resolveToVaultPath(app: App, rawPath: string, allPaths: Set<string>): string | null {
	if (allPaths.has(rawPath)) return rawPath;
	const dest = app.metadataCache.getFirstLinkpathDest(rawPath, "");
	if (dest && allPaths.has(dest.path)) return dest.path;
	return null;
}

// Recursively walk an arbitrary Dataview query result value, collecting every
// vault path it can find. Dataview's QueryResult shape differs per query kind
// (TABLE/LIST/TASK/CALENDAR) and across versions, so instead of assuming a shape
// we deep-scan for anything that ducks like a page (`.path` string or
// `.file.path`) — the same heuristic `itemToPath` uses. Safety: `depthLimit`
// caps recursion depth, and a `seen` set breaks reference cycles so a circular
// graph can't loop forever. 0 matches is fine (no throw).
export function collectPathsDeep(
	value: unknown,
	allPaths: Set<string>,
	app: App,
	depthLimit = 6,
	out: Set<string> = new Set(),
	seen: WeakSet<object> = new WeakSet(),
): Set<string> {
	if (depthLimit < 0 || value == null) return out;

	// Direct page / path match (string or {path}/{file.path}).
	const direct = itemToPath(value);
	if (direct) {
		const resolved = resolveToVaultPath(app, direct, allPaths);
		if (resolved) out.add(resolved);
		// A matched page object can still contain nested page references
		// (e.g. links), so we fall through to recurse rather than return early.
	}

	if (typeof value !== "object") return out;

	// Cycle guard.
	if (seen.has(value as object)) return out;
	seen.add(value as object);

	// Unwrap Dataview DataArray-like wrappers into a plain array first.
	const items = toItems(value);
	// toItems returns `[value]` for a bare object; avoid re-visiting the same
	// object via that wrapper (which would just re-add it to `seen` harmlessly,
	// but recursing its own entries is what we want).
	if (Array.isArray(items) && !(items.length === 1 && items[0] === value)) {
		for (const item of items) {
			collectPathsDeep(item, allPaths, app, depthLimit - 1, out, seen);
		}
		return out;
	}

	// Plain object (or single-wrapped): recurse into own enumerable values.
	for (const key of Object.keys(value as Record<string, unknown>)) {
		collectPathsDeep(
			(value as Record<string, unknown>)[key],
			allPaths,
			app,
			depthLimit - 1,
			out,
			seen,
		);
	}
	return out;
}

// DQL-only resolver. When the script is a DQL query (TABLE/LIST/... or contains
// FROM and isn't JS), this delegates the FULL query to Dataview's public
// `api.query()` so WHERE/SORT/GROUP BY/FLATTEN are all honoured, then deep-scans
// the result for vault paths. Returns `matchedPaths: null` when the script is
// NOT DQL (caller should fall back to the synchronous JS path) or when the
// DataviewJS engine has no usable `query()` method (treated as unavailable so
// the caller's fallback fires). Runs BEFORE buildGraph() so buildGraph stays
// synchronous (mirrors the Bases `await buildBaseIndex(...)` pattern).
export async function runDvjsDqlFilter(
	app: App,
	dvjsFilter: string,
	allPaths: Set<string>,
): Promise<{ matchedPaths: Set<string> | null; error?: string }> {
	const script = dvjsFilter.trim();
	if (!script) return { matchedPaths: null };
	// Not DQL → let buildGraph's synchronous JS path handle it.
	if (!looksLikeDataviewSource(script)) return { matchedPaths: null };

	const dv = getDataviewApi(app);
	if (!dv) return { matchedPaths: null, error: "Dataview plugin is not available." };
	if (typeof dv.query !== "function") {
		// No public DQL evaluator — fall back so we don't silently mis-evaluate.
		return { matchedPaths: null, error: "Dataview plugin is not available." };
	}

	let res: DataviewQueryResult;
	try {
		res = await dv.query(script);
	} catch (e) {
		return {
			matchedPaths: new Set(),
			error: e instanceof Error ? `Dataviewjs error: ${e.message}` : `Dataviewjs error: ${String(e)}`,
		};
	}

	if (!res || !res.successful) {
		const detail = res && typeof res.error === "string" ? res.error : "query failed";
		return { matchedPaths: new Set(), error: `Dataviewjs error: ${detail}` };
	}

	const matchedPaths = collectPathsDeep(res.value, allPaths, app);
	return { matchedPaths };
}

// Synchronous JS-only filter: runs the user's `new Function(...)` script and
// collects the returned paths/pages. DQL queries are handled out-of-band by
// runDvjsDqlFilter (async) before buildGraph runs, so this path only ever sees
// JS. Unchanged behaviour from the original JS branch.
function runDvjsFilter(
	app: App,
	dvjsFilter: string,
	allPaths: Set<string>,
): { matchedPaths: Set<string>; error?: string } {
	const script = dvjsFilter.trim();
	if (!script) return { matchedPaths: new Set(), error: "Dataviewjs query is empty." };
	const dv = getDataviewApi(app);
	if (!dv) return { matchedPaths: new Set(), error: "Dataview plugin is not available." };

	let raw: unknown;
	try {
		const fn = new Function("dv", "app", `"use strict";\n${script}`) as (dv: DataviewApiLike, app: App) => unknown;
		raw = fn(dv, app);
	} catch (e) {
		return {
			matchedPaths: new Set(),
			error: e instanceof Error ? `Dataviewjs error: ${e.message}` : `Dataviewjs error: ${String(e)}`,
		};
	}

	if (raw && typeof raw === "object" && "then" in raw && typeof (raw as { then?: unknown }).then === "function") {
		return {
			matchedPaths: new Set(),
			error: "Async Dataviewjs is not supported. Return paths/pages synchronously.",
		};
	}

	const matchedPaths = new Set<string>();
	for (const item of toItems(raw)) {
		const rawPath = itemToPath(item);
		if (!rawPath) continue;
		const resolved = resolveToVaultPath(app, rawPath, allPaths);
		if (resolved) matchedPaths.add(resolved);
	}
	return { matchedPaths };
}

export function buildGraph(
	app: App,
	whereRows: string[],
	groupByRows: string[],
	filterMode: "sql" | "dvjs" = "sql",
	dvjsFilter: string = "",
	focusNodeIds?: string[],
	expandNeighborhood: boolean = false,
	// Pre-resolved DQL evaluation (from runDvjsDqlFilter, awaited in view.ts
	// before this synchronous builder runs). When `matchedPaths` is a Set it is
	// used directly (DQL was evaluated by Dataview's engine). When `null`, the
	// script is JS (or DQL was unavailable) and buildGraph runs the synchronous
	// JS path via runDvjsFilter. An `error` present alongside `null` means DQL was
	// requested but the engine was unavailable → fall back to SQL pipeline.
	dvjsResolved?: { matchedPaths: Set<string> | null; error?: string },
): { result: BuildResult; errors: BuildErrors } {
	const errors: BuildErrors = {};
	let whereAst: QueryAst | null = null;
	let groupByAst: QueryAst | null = null;
	try {
		whereAst = combineRows(whereRows).ast;
	} catch (e) {
		errors.where = e instanceof Error ? e.message : String(e);
	}
	let groupByText = "";
	try {
		const combined = combineRows(groupByRows);
		groupByAst = combined.ast;
		groupByText = combined.text;
	} catch (e) {
		errors.groupBy = e instanceof Error ? e.message : String(e);
	}

	const files = app.vault.getMarkdownFiles();
	const allPaths = new Set(files.map((f) => f.path));
	const allTags = new Set<string>();
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		for (const t of collectTags(cache)) allTags.add(t);
	}

	// Pre-compute backlinks for maturity suggestions
	const backlinkCounts = new Map<string, number>();
	const resolvedLinks = app.metadataCache.resolvedLinks;
	for (const sourcePath in resolvedLinks) {
		for (const targetPath in resolvedLinks[sourcePath]) {
			backlinkCounts.set(targetPath, (backlinkCounts.get(targetPath) || 0) + 1);
		}
	}

	const tagProperties: Record<string, Record<string, unknown>> = {};
	for (const t of allTags) {
		const dest = app.metadataCache.getFirstLinkpathDest(t, "");
		if (dest) {
			const c = app.metadataCache.getFileCache(dest);
			if (c && c.frontmatter) {
				tagProperties[t] = c.frontmatter as Record<string, unknown>;
			}
		}
	}

	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	const idSet = new Set<string>();
	const clusterLabels = new Map<string, string>();

	let matchedPaths: Set<string> | null = null;
	let useDvjsPaths = filterMode === "dvjs";
	if (filterMode === "dvjs") {
		// DQL was pre-resolved in view.ts (async). If it produced a path set, use
		// it directly. If it returned null WITHOUT an error, the script is JS → run
		// the synchronous JS path here. If it returned null WITH an error (engine
		// unavailable), fall back to the SQL pipeline and surface the error.
		const dqlMatched = dvjsResolved?.matchedPaths;
		if (dqlMatched) {
			matchedPaths = dqlMatched;
		} else if (dvjsResolved?.error) {
			useDvjsPaths = false;
			errors.where = dvjsResolved.error;
		} else {
			// JS path (or no pre-resolution supplied — e.g. direct buildGraph calls
			// in tests). Evaluate synchronously.
			const dv = runDvjsFilter(app, dvjsFilter, allPaths);
			const fallbackToSql =
				dv.error === "Dataviewjs query is empty." ||
				dv.error === "Dataview plugin is not available.";
			if (fallbackToSql) {
				useDvjsPaths = false;
			} else {
				matchedPaths = dv.matchedPaths;
			}
			if (dv.error) errors.where = dv.error;
		}
	}

	const focusSet = focusNodeIds ? new Set(focusNodeIds) : null;

	const coreIds = new Set<string>();
	const peripheralIds = new Set<string>();
	const factsCache = new Map<string, FileFacts>();

	// Pass 1: Find all Core files that pass the filters
	for (const f of files) {
		if (focusSet && !focusSet.has(f.path)) continue;

		const cache = app.metadataCache.getFileCache(f);
		const facts = makeFacts(f, cache, tagProperties);

		let isCore = false;
		if (focusSet) {
			isCore = true;
		} else if (filterMode === "dvjs" && useDvjsPaths) {
			isCore = !!(matchedPaths && matchedPaths.has(f.path));
		} else {
			isCore = !!(!whereAst || isMatched(evalQuery(whereAst, facts)));
		}

		if (isCore) {
			coreIds.add(f.path);
			factsCache.set(f.path, facts);
		}
	}

	// Pass 1b: If neighborhood expansion is enabled, find 1-hop links/backlinks
	if (expandNeighborhood) {
		const resolved = app.metadataCache.resolvedLinks;
		for (const [src, targets] of Object.entries(resolved)) {
			const srcIsCore = coreIds.has(src);
			for (const tgt of Object.keys(targets)) {
				const tgtIsCore = coreIds.has(tgt);
				if (srcIsCore && !tgtIsCore) peripheralIds.add(tgt);
				if (tgtIsCore && !srcIsCore) peripheralIds.add(src);
			}
		}
	}

	// Pass 2: Process Core and Peripheral files
	for (const f of files) {
		const isCore = coreIds.has(f.path);
		const isPeripheral = peripheralIds.has(f.path);
		if (!isCore && !isPeripheral) continue;

		const cache = app.metadataCache.getFileCache(f);
		const facts = factsCache.get(f.path) || makeFacts(f, cache, tagProperties);

		const memberships: string[] = [];
		const seen = new Set<string>();

		if (groupByAst) {
			const result = evalQuery(groupByAst, facts);
			for (const instance of result.instances) {
				const { key, label } = instanceCluster(instance, groupByText);
				if (!seen.has(key)) {
					seen.add(key);
					memberships.push(key);
					if (!clusterLabels.has(key)) clusterLabels.set(key, label);
				}
			}
			if (memberships.length === 0) {
				memberships.push(NONE_BUCKET);
				if (!clusterLabels.has(NONE_BUCKET)) clusterLabels.set(NONE_BUCKET, NONE_BUCKET);
			}
		} else {
			memberships.push("all");
			if (!clusterLabels.has("all")) clusterLabels.set("all", "all");
		}



		// Maturity: always compute the heuristic suggestion, then let a VALID
		// frontmatter `maturity` override win. effectiveMaturity falls back to the
		// suggestion for an absent or unrecognised override value.
		const ageDays = (Date.now() - f.stat.ctime) / 86400000;
		const wordCount = Math.max(1, Math.floor(f.stat.size / 5)); // rough estimate
		const linkCount = (cache?.links?.length ?? 0) + (cache?.frontmatterLinks?.length ?? 0);
		const backlinkCount = backlinkCounts.get(f.path) || 0;
		const fmTags: unknown = cache?.frontmatter?.tags;
		const hasSourceTag = (cache?.tags ?? []).some(t => t.tag.toLowerCase().startsWith("#source/")) ||
			(fmTags && (
				(Array.isArray(fmTags) && fmTags.some((t: unknown) => typeof t === "string" && t.toLowerCase().startsWith("source/"))) ||
				(typeof fmTags === "string" && fmTags.toLowerCase().startsWith("source/"))
			));
		const maturitySuggestion = suggestMaturity({ wordCount, linkCount, backlinkCount, ageDays, hasSourceTag: !!hasSourceTag });
		const rawMaturity: unknown = cache?.frontmatter?.["maturity"];
		const fmMaturity = effectiveMaturity(
			typeof rawMaturity === "string" ? rawMaturity.trim().toLowerCase() : undefined,
			maturitySuggestion,
		);

		nodes.push({ 
			id: f.path, 
			label: f.basename, 
			memberships, 
			mtime: f.stat.mtime, 
			fmMaturity, 
			ageDays,
			isPeripheral: isCore ? undefined : true
		});
		idSet.add(f.path);
	}

	for (const f of files) {
		if (!idSet.has(f.path)) continue;
		const cache = app.metadataCache.getFileCache(f);
		const links = [...(cache?.links ?? []), ...(cache?.frontmatterLinks ?? [])];
		for (const l of links) {
			const dest = app.metadataCache.getFirstLinkpathDest(l.link, f.path);
			if (!dest) continue;
			if (!idSet.has(dest.path)) continue;
			if (dest.path === f.path) continue;
			edges.push({ source: f.path, target: dest.path });
		}
	}

	return { result: { data: { nodes, edges }, clusterLabels }, errors };
}

function instanceCluster(
	bindings: Map<string, string>,
	groupByText: string,
): { key: string; label: string } {
	if (bindings.size === 0) {
		return { key: `expr:${groupByText}`, label: groupByText || "all" };
	}
	const entries = [...bindings.entries()].sort(([a], [b]) => a.localeCompare(b));
	const key = entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
	const label = entries.map(([, v]) => v).join(" / ");
	return { key, label };
}

function makeFacts(
	file: TFile,
	cache: CachedMetadata | null,
	tagProperties: Record<string, Record<string, unknown>>,
): FileFacts {
	return {
		path: file.path,
		tags: collectTags(cache),
		frontmatter: (cache?.frontmatter as Record<string, unknown>) ?? {},
		tagProperties,
	};
}

function collectTags(cache: CachedMetadata | null): string[] {
	if (!cache) return [];
	const out: string[] = [];
	if (cache.tags) for (const t of cache.tags) out.push(stripHash(t.tag));
	const fm = cache.frontmatter?.tags as unknown;
	if (Array.isArray(fm)) for (const t of fm) out.push(stripHash(String(t)));
	else if (typeof fm === "string") out.push(stripHash(fm));
	return out;
}

function stripHash(t: string): string {
	return t.startsWith("#") ? t.slice(1) : t;
}
