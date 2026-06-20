// Stage 2: projectBaseIndexToGraph tests. Pure over a BaseIndex; we hand-build
// minimal indexes (only the fields the projector reads: tables, elements,
// relations) and inject a trivial labelOf.
import { ok } from "./assert";
import { projectBaseIndexToGraph, type BaseEdgeKind } from "../src/bases/project";
import type { BaseElement, BaseIndex, BaseRelation, BaseTable } from "../src/bases/types";

function table(filePath: string, name: string, viewNames: string[] = []): BaseTable {
	return {
		filePath,
		name,
		views: viewNames.map((n) => ({ name: n, type: "table", filter: null, columns: [] })),
		formulas: {},
	};
}

function el(
	tablePath: string,
	notePath: string,
	viewName = "v1",
	tags: string[] = [],
	fields: Record<string, unknown> = {},
	links: string[] = [],
): BaseElement {
	return {
		key: `${tablePath}::${viewName}::${notePath}`,
		notePath,
		tablePath,
		viewName,
		fields,
		tags,
		links,
	};
}

function rel(
	kind: BaseRelation["kind"],
	aNote: string,
	bNote: string,
	via = "x",
): BaseRelation {
	return {
		kind,
		aKey: `k::${aNote}`,
		bKey: `k::${bNote}`,
		aNote,
		bNote,
		via,
		crossBase: false,
	};
}

function index(
	tables: BaseTable[],
	elements: BaseElement[],
	relations: BaseRelation[] = [],
): BaseIndex {
	const map = new Map<string, BaseElement>();
	for (const e of elements) map.set(e.key, e);
	return {
		tables,
		elements: map,
		byTable: new Map(),
		relations,
		adjacency: new Map(),
		errors: [],
	};
}

const labelOf = (p: string): string => {
	const base = p.split("/").pop() ?? p;
	return base.endsWith(".md") ? base.slice(0, -3) : base;
};

const allKinds = new Set<BaseEdgeKind>(["link", "shared-tag", "shared-property"]);

// --- notePath aggregation: same note in 2 views/bases ⇒ ONE node, multi-member ---
{
	const idx = index(
		[table("A.base", "Alpha"), table("B.base", "Beta")],
		[
			el("A.base", "n1.md", "v1"),
			el("A.base", "n1.md", "v2"), // same note, second view of same base
			el("B.base", "n1.md", "v1"), // same note, different base
			el("A.base", "n2.md", "v1"),
		],
	);
	// file granularity: A.base + B.base ⇒ two cluster keys for n1.
	const { data, clusterLabels } = projectBaseIndexToGraph(idx, {
		clusterByView: false,
		edgeKinds: allKinds,
		labelOf,
	});
	ok(data.nodes.length === 2, "n1 + n2 collapse to exactly two nodes");
	const n1 = data.nodes.find((n) => n.id === "n1.md")!;
	ok(n1.label === "n1", "label = basename via labelOf");
	const m = [...n1.memberships].sort();
	ok(
		JSON.stringify(m) === JSON.stringify(["base=Alpha", "base=Beta"]),
		`n1 belongs to both base clusters (file granularity), got ${JSON.stringify(m)}`,
	);
	ok(clusterLabels.get("base=Alpha") === "Alpha", "cluster label uses base name");
	ok(clusterLabels.get("base=Beta") === "Beta", "second base cluster labelled");
	const n2 = data.nodes.find((n) => n.id === "n2.md")!;
	ok(JSON.stringify(n2.memberships) === JSON.stringify(["base=Alpha"]), "n2 single membership");
}

// --- view granularity: cluster key = base::view ---
{
	const idx = index(
		[table("A.base", "Alpha")],
		[el("A.base", "n1.md", "Open"), el("A.base", "n1.md", "Done")],
	);
	const { data, clusterLabels } = projectBaseIndexToGraph(idx, {
		clusterByView: true,
		edgeKinds: allKinds,
		labelOf,
	});
	const n1 = data.nodes.find((n) => n.id === "n1.md")!;
	const m = [...n1.memberships].sort();
	ok(
		JSON.stringify(m) === JSON.stringify(["base=Alpha::Done", "base=Alpha::Open"]),
		`view granularity yields per-view cluster keys, got ${JSON.stringify(m)}`,
	);
	ok(clusterLabels.get("base=Alpha::Open") === "Alpha / Open", "view cluster label = base / view");
}

// --- edgeKinds filter: only selected kinds become edges ---
{
	const idx = index(
		[table("A.base", "Alpha")],
		[el("A.base", "a.md"), el("A.base", "b.md"), el("A.base", "c.md")],
		[
			rel("link", "a.md", "b.md"),
			rel("shared-tag", "b.md", "c.md", "topic"),
			rel("shared-property", "a.md", "c.md", "status=open"),
		],
	);
	// Only links.
	const onlyLink = projectBaseIndexToGraph(idx, {
		clusterByView: false,
		edgeKinds: new Set<BaseEdgeKind>(["link"]),
		labelOf,
	});
	ok(onlyLink.data.edges.length === 1, "edgeKinds={link} keeps only the link edge");
	ok(
		onlyLink.data.edges[0].source === "a.md" && onlyLink.data.edges[0].target === "b.md",
		"the surviving edge is the a→b link",
	);
	// Link + shared-tag.
	const two = projectBaseIndexToGraph(idx, {
		clusterByView: false,
		edgeKinds: new Set<BaseEdgeKind>(["link", "shared-tag"]),
		labelOf,
	});
	ok(two.data.edges.length === 2, "two enabled kinds ⇒ two edges");
	// None.
	const none = projectBaseIndexToGraph(idx, {
		clusterByView: false,
		edgeKinds: new Set<BaseEdgeKind>(),
		labelOf,
	});
	ok(none.data.edges.length === 0, "empty edgeKinds ⇒ no edges");
}

// --- self-loop drop + undirected dedupe ---
{
	const idx = index(
		[table("A.base", "Alpha")],
		[el("A.base", "a.md"), el("A.base", "b.md")],
		[
			rel("link", "a.md", "a.md"), // self-loop — dropped
			rel("link", "a.md", "b.md"), // a–b
			rel("shared-tag", "b.md", "a.md", "topic"), // same undirected pair, diff kind — deduped
		],
	);
	const { data } = projectBaseIndexToGraph(idx, {
		clusterByView: false,
		edgeKinds: allKinds,
		labelOf,
	});
	ok(data.edges.length === 1, "self-loop dropped and undirected duplicate deduped → one edge");
	const e = data.edges[0];
	ok(
		(e.source === "a.md" && e.target === "b.md") || (e.source === "b.md" && e.target === "a.md"),
		"the surviving edge is the a–b pair",
	);
}

// --- mtimeOf injection ---
{
	const idx = index([table("A.base", "Alpha")], [el("A.base", "a.md")]);
	const { data } = projectBaseIndexToGraph(idx, {
		clusterByView: false,
		edgeKinds: allKinds,
		labelOf,
		mtimeOf: (p) => (p === "a.md" ? 12345 : undefined),
	});
	ok(data.nodes[0].mtime === 12345, "mtimeOf is applied to the node");
}

// --- per-table auto granularity: single-view table ⇒ file-unit (global off) ---
{
	const idx = index(
		[table("A.base", "Alpha", ["Open"])], // exactly ONE view
		[el("A.base", "n1.md", "Open")],
	);
	const { data, clusterLabels } = projectBaseIndexToGraph(idx, {
		clusterByView: false,
		edgeKinds: allKinds,
		labelOf,
	});
	const n1 = data.nodes.find((n) => n.id === "n1.md")!;
	ok(
		JSON.stringify(n1.memberships) === JSON.stringify(["base=Alpha"]),
		`single-view table stays file-unit when global flag off, got ${JSON.stringify(n1.memberships)}`,
	);
	ok(clusterLabels.get("base=Alpha") === "Alpha", "single-view file-unit label = base name");
}

// --- per-table auto granularity: multi-view table ⇒ AUTO view-unit (global off) ---
{
	const idx = index(
		[table("A.base", "Alpha", ["Open", "Done"])], // TWO views ⇒ grouped
		[el("A.base", "n1.md", "Open"), el("A.base", "n1.md", "Done")],
	);
	const { data, clusterLabels } = projectBaseIndexToGraph(idx, {
		clusterByView: false, // global default OFF — auto-detect still kicks in
		edgeKinds: allKinds,
		labelOf,
	});
	const n1 = data.nodes.find((n) => n.id === "n1.md")!;
	const m = [...n1.memberships].sort();
	ok(
		JSON.stringify(m) === JSON.stringify(["base=Alpha::Done", "base=Alpha::Open"]),
		`multi-view table auto-clusters by view even with global flag off, got ${JSON.stringify(m)}`,
	);
	ok(clusterLabels.get("base=Alpha::Open") === "Alpha / Open", "auto view-unit label = base / view");
}

// --- global override: single-view table ⇒ view-unit when flag ON ---
{
	const idx = index(
		[table("A.base", "Alpha", ["Open"])], // ONE view
		[el("A.base", "n1.md", "Open")],
	);
	const { data } = projectBaseIndexToGraph(idx, {
		clusterByView: true, // global "always cluster by view" forces it
		edgeKinds: allKinds,
		labelOf,
	});
	const n1 = data.nodes.find((n) => n.id === "n1.md")!;
	ok(
		JSON.stringify(n1.memberships) === JSON.stringify(["base=Alpha::Open"]),
		`global flag ON forces single-view table to view-unit, got ${JSON.stringify(n1.memberships)}`,
	);
}

// --- MIXED: single-view base + multi-view base in one index, independent granularity ---
{
	const idx = index(
		[
			table("S.base", "Single", ["Only"]), // 1 view ⇒ file-unit
			table("M.base", "Multi", ["Open", "Done"]), // 2 views ⇒ view-unit
		],
		[
			el("S.base", "n1.md", "Only"),
			el("M.base", "n1.md", "Open"),
			el("M.base", "n1.md", "Done"),
		],
	);
	const { data, clusterLabels } = projectBaseIndexToGraph(idx, {
		clusterByView: false, // global default OFF — each table decided independently
		edgeKinds: allKinds,
		labelOf,
	});
	const n1 = data.nodes.find((n) => n.id === "n1.md")!;
	const m = [...n1.memberships].sort();
	ok(
		JSON.stringify(m) ===
			JSON.stringify(["base=Multi::Done", "base=Multi::Open", "base=Single"]),
		`mixed index: Single stays file-unit, Multi splits per view, got ${JSON.stringify(m)}`,
	);
	ok(clusterLabels.get("base=Single") === "Single", "single-view base file-unit label");
	ok(clusterLabels.get("base=Multi::Open") === "Multi / Open", "multi-view base view-unit label");
}

console.log("bases-project tests passed");
