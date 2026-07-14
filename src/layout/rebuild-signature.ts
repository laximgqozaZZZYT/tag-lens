import type { GraphData, MiniSettings } from "../types";
import { layoutSignature } from "./layout-signature";

// Canonical JSON of the graph INPUTS that a relayout/redraw/menu-rebuild
// depends on: node identity/label/memberships, edge endpoints, the cluster
// label map, and the layout-affecting settings (via `layoutSignature`, so a
// display-only toggle keeps the same string). `buildGraph` compares this to the
// last build and early-outs when byte-for-byte identical. Pure — inputs are
// never mutated; the projections are fresh arrays.
export function rebuildSignature(
	data: GraphData,
	clusterLabels: Map<string, string>,
	settings: MiniSettings,
): string {
	return JSON.stringify({
		n: data.nodes.map((n) => [n.id, n.label, n.memberships ?? []]),
		e: data.edges.map((e) => [e.source, e.target]),
		c: [...clusterLabels.entries()],
		s: layoutSignature(settings),
	});
}
