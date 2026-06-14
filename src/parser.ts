import type { App, CachedMetadata, TFile } from "obsidian";
import { GraphData, GraphEdge, GraphNode, NONE_BUCKET } from "./types";
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

export function buildGraph(
	app: App,
	whereRows: string[],
	groupByRows: string[],
	filterMode: "sql" | "dvjs" = "sql",
	dvjsFilter: string = "",
	statusField: string = "",
	focusNodeIds?: string[],
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
	if (filterMode === "dvjs") {
		try {
			const dvPlugin = (app as any).plugins.plugins.dataview;
			if (!dvPlugin || !dvPlugin.api) {
				throw new Error("Dataview plugin is not enabled or available.");
			}
			// Execute DataviewJS snippet. Pass `dv` (the API) and `app`.
			const fn = new Function('dv', 'app', dvjsFilter);
			let dvResult = fn(dvPlugin.api, app);
			if (dvResult && typeof dvResult.array === "function") {
				dvResult = dvResult.array();
			}
			if (Array.isArray(dvResult)) {
				matchedPaths = new Set(dvResult.map(item => {
					if (typeof item === "string") return item;
					if (item && typeof item === "object") {
						if (item.file && typeof item.file.path === "string") return item.file.path;
						if (typeof item.path === "string") return item.path;
					}
					return "";
				}).filter(p => p !== ""));
			} else {
				throw new Error("DataviewJS filter must return an array of paths or pages.");
			}
		} catch (e) {
			errors.where = e instanceof Error ? e.message : String(e);
			matchedPaths = new Set(); // fallback to empty if error
		}
	}

	const focusSet = focusNodeIds ? new Set(focusNodeIds) : null;

	for (const f of files) {
		if (focusSet && !focusSet.has(f.path)) continue;

		const cache = app.metadataCache.getFileCache(f);
		const facts = makeFacts(f, cache, tagProperties);

		if (filterMode === "dvjs") {
			if (!matchedPaths || !matchedPaths.has(f.path)) continue;
		} else {
			if (whereAst && !isMatched(evalQuery(whereAst, facts))) continue;
		}

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

		let fmStatus: string | undefined;
		if (statusField) {
			const raw = cache?.frontmatter?.[statusField];
			if (raw !== undefined && raw !== null) {
				fmStatus = String(raw).trim().toLowerCase();
			}
		}

		// Maturity: always compute the heuristic suggestion, then let a VALID
		// frontmatter `maturity` override win. effectiveMaturity falls back to the
		// suggestion for an absent or unrecognised override value.
		const ageDays = (Date.now() - f.stat.ctime) / 86400000;
		const wordCount = Math.max(1, Math.floor(f.stat.size / 5)); // rough estimate
		const linkCount = (cache?.links?.length ?? 0) + (cache?.frontmatterLinks?.length ?? 0);
		const backlinkCount = backlinkCounts.get(f.path) || 0;
		const hasSourceTag = (cache?.tags ?? []).some(t => t.tag.toLowerCase().startsWith("#source/")) ||
			(cache?.frontmatter?.tags && (
				(Array.isArray(cache.frontmatter.tags) && cache.frontmatter.tags.some((t: string) => t.toLowerCase().startsWith("source/"))) ||
				(typeof cache.frontmatter.tags === "string" && cache.frontmatter.tags.toLowerCase().startsWith("source/"))
			));
		const maturitySuggestion = suggestMaturity({ wordCount, linkCount, backlinkCount, ageDays, hasSourceTag: !!hasSourceTag });
		const rawMaturity = cache?.frontmatter?.["maturity"];
		const fmMaturity = effectiveMaturity(
			typeof rawMaturity === "string" ? rawMaturity.trim().toLowerCase() : undefined,
			maturitySuggestion,
		);

		nodes.push({ id: f.path, label: f.basename, memberships, mtime: f.stat.mtime, fmStatus, fmMaturity, ageDays });
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
