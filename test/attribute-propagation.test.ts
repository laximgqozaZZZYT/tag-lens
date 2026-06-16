// R6' — attribute-propagation invariant. AGENTS gotcha #5: every laid note node
// must carry mtime / fmMaturity / ageDays (the parser computes them; dropping one
// in a per-mode layout silently disables status/freshness/maturity/encoding).
// This is the SELECTION-INDEPENDENT half of the contract: it asserts only that
// the nodes that ARE laid out keep their attributes — it never asserts WHICH/HOW
// MANY nodes appear, so the closeup `focusNodeIds` filter (a query-layer concern
// in parser.ts, never touched here) is fully respected.
//
// Pure: drives the layout() entry directly. Card-producing modes only — matrix /
// heatmap / lattice / droste render cells/galleries with no per-note nodes, and
// stream/upset's note attribution is covered by the E2E (e2e-display).
import { ok } from "./assert";
import { layout, type SizedNode, type LayoutOptions } from "../src/layout/layout";
import { stripTabPrefix } from "../src/interaction/note-menu";
import type { GraphData, GraphNode, ViewMode } from "../src/types";

function makeData(): GraphData {
	const n = (id: string, tags: string[], mtime: number, mat: string, age: number): GraphNode =>
		({ id, label: id, memberships: tags, mtime, fmMaturity: mat, ageDays: age });
	return {
		nodes: [
			n("a", ["x"], 100, "seedling", 1),
			n("b", ["y"], 200, "budding", 5),
			n("c", ["x", "y"], 300, "evergreen", 9),
		],
		edges: [{ source: "a", target: "b" }],
	};
}
const sizedFrom = (d: GraphData): SizedNode[] => d.nodes.map((n) => ({ ...n, width: 40, height: 24 }));
function opts(viewMode: ViewMode): LayoutOptions {
	return {
		clusterSpacing: 80,
		nodeSpacing: 16,
		cellW: 40,
		cellH: 24,
		minFontPx: 8,
		clusterLabels: new Map<string, string>(),
		anchorPlacement: "concentric",
		viewMode,
		bipartiteMaxTags: 80,
		bipartiteLayout: "concentric",
	} as LayoutOptions;
}

// Modes whose layout() produces per-note PositionedNodes.
const CARD_MODES: ViewMode[] = ["euler", "euler-true", "euler-venn", "bubblesets", "bipartite"];

for (const mode of CARD_MODES) {
	const d = makeData();
	const want = new Map(d.nodes.map((n) => [n.id, n]));
	const r = layout(d, sizedFrom(d), opts(mode));
	// Euler-family copies a multi-tag note once PER tag with id "<tag>\t<path>";
	// stripTabPrefix maps back to the source id. Bipartite SET nodes are NUL-
	// prefixed (no tab) so they strip to a non-note id and are excluded.
	const notes = r.nodes.filter((p) => want.has(stripTabPrefix(p.id)));
	ok(notes.length > 0, `[${mode}] lays out at least one note node`);
	for (const p of notes) {
		const src = want.get(stripTabPrefix(p.id))!;
		ok(p.mtime === src.mtime, `[${mode}] ${p.id} preserves mtime (got ${p.mtime}, want ${src.mtime})`);
		ok(p.fmMaturity === src.fmMaturity, `[${mode}] ${p.id} preserves fmMaturity (got ${p.fmMaturity}, want ${src.fmMaturity})`);
		ok(p.ageDays === src.ageDays, `[${mode}] ${p.id} preserves ageDays (got ${p.ageDays}, want ${src.ageDays})`);
	}
}
