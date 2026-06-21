// Stage 2: project a BaseIndex onto the existing GraphData shape so the regular
// rebuild pipeline (degree / HAVING / LIMIT / layout / draw) can consume base
// elements as ordinary graph nodes. Pure / Obsidian-free: the caller injects a
// `labelOf(notePath)` so this module never touches the vault.
//
// Aggregation contract:
//   - One GraphNode PER NOTE PATH. A note that appears in several bases/views
//     collapses to a single node whose `memberships[]` lists every cluster it
//     belongs to (= euler overlap, the same mechanism GROUP_BY `tag:*` uses).
//   - One GraphEdge per (kind ∈ edgeKinds) relation, undirected-deduped, with
//     self-loops dropped. `node.id` stays the note path so cards / hit-testing /
//     menus keep working untouched.

import type { GraphData, GraphNode } from "../types";
import type { BaseIndex, BaseRelation, BaseTable } from "./types";

export type BaseEdgeKind = "link" | "shared-tag" | "shared-property";

// Single source of truth for the rebuild() SCOPE gate: the base projection
// REPLACES the WHERE/GROUP_BY graph ONLY when the Logic source is "bases" AND at
// least one `.base` file is selected. In sql/dvjs mode (or with no selection)
// the classic pipeline result stands — even if selectedBases still holds values.
export function shouldScopeToBases(
	filterMode: "sql" | "dvjs" | "bases",
	selectedBases: readonly string[] | undefined,
): boolean {
	return filterMode === "bases" && (selectedBases?.length ?? 0) > 0;
}

export interface ProjectOpts {
	// Global "always cluster by view" override. When true, EVERY base clusters per
	// (base, view) regardless of how many views it has. When false (default) the
	// granularity is decided PER TABLE: a `.base` with >1 view auto-clusters by
	// view (so in-file grouping is reflected in the figure), while a single-view
	// `.base` clusters per file. See `effectiveClusterByView`.
	clusterByView: boolean;
	// Which relation kinds become edges.
	edgeKinds: Set<BaseEdgeKind>;
	// notePath → display label (basename). Injected so this stays Obsidian-free.
	labelOf: (notePath: string) => string;
	// notePath → file modified time (epoch ms), optional. Injected like labelOf
	// so freshness/maturity-aware modes get real mtime where available.
	mtimeOf?: (notePath: string) => number | undefined;
	// Whether to show the base file name as a prefix in cluster labels.
	showPrefix: boolean;
	// When true, multi-view bases will inject an extra "wrapper" membership for the entire base file.
	injectBaseEnclosures?: boolean;
}

export interface ProjectResult {
	data: GraphData;
	// cluster key → display label (base name, or "base / view").
	clusterLabels: Map<string, string>;
}

// Build the cluster key + label for one base element. file-granularity uses the
// base NAME (nicer than the raw path); view-granularity appends the view name.
function clusterKeyFor(
	tableName: string,
	viewName: string,
	clusterByView: boolean,
	showPrefix: boolean,
): { key: string; label: string } {
	if (clusterByView) {
		return { key: `base=${tableName}::${viewName}`, label: showPrefix ? `${tableName} / ${viewName}` : viewName };
	}
	return { key: `base=${tableName}`, label: tableName };
}

// Effective per-table granularity: the global `clusterByView` flag FORCES view
// granularity for every table, but even with it off a table that carries more
// than one view auto-clusters by view so that in-file grouping (multiple views
// in one `.base`) is reflected in the figure. Single-view tables stay file-unit
// (the two keys coincide anyway, so forcing view granularity there is harmless).
function effectiveClusterByView(clusterByView: boolean, table: BaseTable | undefined): boolean {
	return clusterByView || (table?.views.length ?? 0) > 1;
}

export function projectBaseIndexToGraph(index: BaseIndex, opts: ProjectOpts): ProjectResult {
	const { clusterByView, edgeKinds, labelOf, mtimeOf } = opts;

	// tablePath → human base name (for nice cluster labels). Falls back to path.
	const baseNameByPath = new Map<string, string>();
	// tablePath → BaseTable so per-element granularity can read views.length.
	const tableByPath = new Map<string, BaseTable>();
	for (const t of index.tables) {
		baseNameByPath.set(t.filePath, t.name || t.filePath);
		tableByPath.set(t.filePath, t);
	}

	const clusterLabels = new Map<string, string>();

	// notePath → membership-key set (deduped) so a repeated base/view membership
	// doesn't appear twice on one node.
	const membershipsByNote = new Map<string, Set<string>>();

	for (const el of index.elements.values()) {
		const tableName = baseNameByPath.get(el.tablePath) ?? el.tablePath;
		// Decide granularity per ELEMENT by looking up its own table: a mix of
		// single-view and multi-view bases in one index each get their correct
		// granularity independently.
		const byView = effectiveClusterByView(clusterByView, tableByPath.get(el.tablePath));
		const { key, label } = clusterKeyFor(tableName, el.viewName, byView, opts.showPrefix);
		clusterLabels.set(key, label);
		let set = membershipsByNote.get(el.notePath);
		if (!set) {
			set = new Set<string>();
			membershipsByNote.set(el.notePath, set);
		}
		set.add(key);

		if (opts.injectBaseEnclosures && byView) {
			const baseKey = `base=${tableName}`;
			clusterLabels.set(baseKey, tableName);
			set.add(baseKey);
		}
	}

	// One node per note path.
	const nodes: GraphNode[] = [];
	for (const [notePath, memberSet] of membershipsByNote) {
		const node: GraphNode = {
			id: notePath,
			label: labelOf(notePath),
			memberships: [...memberSet],
		};
		const mtime = mtimeOf?.(notePath);
		if (mtime !== undefined) node.mtime = mtime;
		nodes.push(node);
	}

	// Edges from selected relation kinds. Self-loops dropped; (source,target)
	// undirected-deduped (a note may share several relations of mixed kinds).
	const edges: GraphData["edges"] = [];
	const seenEdge = new Set<string>();
	for (const rel of index.relations) {
		if (!edgeKinds.has(rel.kind as BaseEdgeKind)) continue;
		const a = rel.aNote;
		const b = rel.bNote;
		if (!a || !b || a === b) continue;
		const [lo, hi] = a <= b ? [a, b] : [b, a];
		const dedupe = `${lo}|${hi}`;
		if (seenEdge.has(dedupe)) continue;
		seenEdge.add(dedupe);
		edges.push({ source: a, target: b });
	}

	return { data: { nodes, edges }, clusterLabels };
}

// Re-export the relation kind for callers building the edgeKinds set without
// importing the relation type directly.
export type { BaseRelation };
