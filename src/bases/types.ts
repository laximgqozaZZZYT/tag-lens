// Pure data types for the Bases integration (Stage 1). No Obsidian imports —
// these describe the parsed shape of a `.base` file and the derived graph of
// elements (filter-matched notes) and relations (shared tag / link / property)
// across one or more selected bases.

// A single leaf condition extracted from a `.base` filter string, e.g.
// `file.tags.contains("#tag")` → { lhs: "file.tags", op: "contains", rhs: "#tag" }.
export interface BaseCond {
	lhs: string;
	op: string;
	rhs?: string;
}

// Recursive filter tree. `and`/`or` are the boolean nodes; `cond` is a parsed
// leaf; `raw` preserves any string the parser could not decompose so nothing is
// silently lost (raw conditions are IGNORED at eval time — see evalBaseFilter).
export type BaseFilter =
	| { and: BaseFilter[] }
	| { or: BaseFilter[] }
	| { cond: BaseCond }
	| { raw: string };

export interface BaseSort {
	property: string;
	direction: "ASC" | "DESC";
}

// One view inside a `.base` (table / cards / list …).
export interface BaseView {
	name: string;
	type: string;
	filter: BaseFilter | null;
	// `order[]` column references (file.*/note.*/formula.*).
	columns: string[];
	sort?: BaseSort[];
}

// One parsed `.base` file.
export interface BaseTable {
	filePath: string;
	name: string;
	views: BaseView[];
	formulas: Record<string, string>;
}

// A row: one note that matched a view's filter. `key` is globally unique;
// `notePath` is the note's vault path and is kept identical to GraphNode.id so
// Stage 2 can project elements onto existing graph nodes 1:1.
export interface BaseElement {
	key: string; // `${tablePath}::${viewName}::${notePath}`
	notePath: string;
	tablePath: string;
	viewName: string;
	fields: Record<string, unknown>;
	tags: string[];
	links: string[]; // forward link target paths
}

// A relation between two elements. `via` carries the linking value (tag name,
// property "key=value", or "link"). `crossBase` is true when the two elements
// come from different `.base` files.
export interface BaseRelation {
	kind: "link" | "shared-tag" | "shared-property";
	aKey: string;
	bKey: string;
	aNote: string;
	bNote: string;
	via: string;
	crossBase: boolean;
}

export interface BaseIndex {
	tables: BaseTable[];
	elements: Map<string, BaseElement>; // key → element
	byTable: Map<string, string[]>; // tablePath → element keys
	relations: BaseRelation[];
	adjacency: Map<string, BaseRelation[]>; // element key → its relations
	// Non-fatal problems encountered while building (parse failures etc.). The
	// build never throws; callers can surface these.
	errors: string[];
}

export interface RelationOpts {
	link: boolean;
	sharedTag: boolean;
	sharedProp: boolean;
}

export interface BuildIndexOpts extends RelationOpts {
	// Forward-link lookup: source note path → set of target note paths. Built by
	// the Obsidian wrapper from metadataCache.resolvedLinks; injected here so the
	// pure relation builder stays Obsidian-free.
	resolvedLinks?: Record<string, Record<string, number>>;
}
