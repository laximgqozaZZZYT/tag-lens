import { ok } from "./assert";
import { computeModeLegendInput } from "../src/draw/mode-legend-input";
import type { LaidOut, PositionedNode } from "../src/layout/layout";
import { DEFAULT_SETTINGS, type MiniSettings } from "../src/types";

// Characterization tests for the pure legend-input builder extracted from
// MiniGraphView.buildModeLegendInput. They lock the data-shaping behaviour so
// the (verbatim) extraction can't silently drift.

// Minimal positioned node — the builder only reads `memberships` and `count`,
// but the type needs the geometry fields, so fill them with placeholders.
function pnode(id: string, memberships: string[], count: number): PositionedNode {
	return { id, label: id, x: 0, y: 0, width: 10, height: 10, memberships, count } as unknown as PositionedNode;
}

function makeDeps(over: {
	settings?: Partial<MiniSettings>;
	laid?: Partial<LaidOut>;
	rows?: number;
	cols?: number;
}) {
	const settings: MiniSettings = { ...DEFAULT_SETTINGS, ...over.settings };
	const laid = { nodes: [], ...over.laid } as unknown as LaidOut;
	return {
		settings,
		laid,
		encLegends: [],
		clusterLabels: new Map<string, string>([
			["greek", "greek"],
			["norse", "norse"],
		]),
		zoom: 1,
		resolveLayerDisplay: () => ({ nodeRows: over.rows ?? 2, nodeCols: over.cols ?? 3 }),
	};
}

// upset mode: single-tag tags carry the panel-style suffix; overlapping
// memberships derive ∪/∩ pairwise set-layers.
{
	const nodes = [
		pnode("a", ["greek"], 1),
		pnode("b", ["greek", "norse"], 2),
		pnode("c", ["norse"], 3),
	];
	const out = computeModeLegendInput(
		makeDeps({ settings: { viewMode: "upset" }, laid: { nodes } }),
	);

	ok(out.tags.length === 2, "one legend tag per distinct first membership");
	const greek = out.tags.find((t) => t.key === "greek");
	ok(!!greek && greek.label === "greek — Size 2×3 · 2 nodes", "tag suffix mirrors panel: Size R×C · N nodes");

	ok(!!out.setLayers && out.setLayers.length === 2, "∪ and ∩ rows for the single overlapping pair");
	const union = out.setLayers!.find((s) => s.key.startsWith("__union__"));
	const inter = out.setLayers!.find((s) => s.key.startsWith("__inter__"));
	ok(!!union && union.label.includes("greek ∪ norse"), "union row labels the tag pair");
	ok(!!inter && inter.label.includes("greek ∩ norse"), "intersection row labels the tag pair");
	// interN = the 1 node carrying both tags (singular 'node').
	ok(inter!.label.includes("1 node"), "intersection count = nodes with 2+ tags (singular 'node')");

	ok(!!out.counts && out.counts.min === 1 && out.counts.max === 3, "counts come from node.count min/max");
}

// singular vs plural 'node' in the suffix.
{
	const out = computeModeLegendInput(
		makeDeps({ settings: { viewMode: "upset" }, laid: { nodes: [pnode("x", ["greek"], 1)] } }),
	);
	const greek = out.tags.find((t) => t.key === "greek");
	ok(!!greek && (greek.label ?? "").endsWith("· 1 node"), "count 1 uses singular 'node'");
}

// empty graph: no tags, no set-layers, counts fall back to 1×1.
{
	const out = computeModeLegendInput(makeDeps({ settings: { viewMode: "upset" }, laid: { nodes: [] } }));
	ok(out.tags.length === 0, "no tags for an empty layout");
	ok(!out.setLayers, "no set-layers when there are no nodes");
	ok(!!out.counts && out.counts.min === 1 && out.counts.max === 1, "empty counts clamp to 1..1");
}

// heatmap block is populated from laid.heatmap.
{
	const out = computeModeLegendInput(
		makeDeps({
			settings: { viewMode: "heatmap", heatmapJaccard: true },
			laid: {
				nodes: [],
				heatmap: {
					tags: [
						{ key: "greek", label: "greek", size: 2 },
						{ key: "norse", label: "norse", size: 9 },
					],
					p95: 7,
					maxOff: 5,
				},
			} as unknown as Partial<LaidOut>,
		}),
	);
	ok(!!out.heatmap && out.heatmap.jaccard === true, "jaccard flag forwarded");
	ok(out.heatmap!.tagMin === 2 && out.heatmap!.tagMax === 9, "tag min/max from heatmap tags");
	ok(out.heatmap!.coMax === 7, "coMax uses p95 when present");
}
