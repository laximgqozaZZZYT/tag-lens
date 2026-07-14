import type { MiniSettings } from "../types";

// Settings that only affect WHAT is painted, not the placement. Toggling
// these must NOT relayout — the positions stay identical to the all-on
// layout; we just repaint. Kept out of the layout signature so a toggle
// of any of them yields the SAME signature (no rebuild).
export const DISPLAY_ONLY_KEYS: ReadonlySet<string> = new Set([
	"showNodes",
	"showEnclosures",
	"showEdges",
	"showGrid",
	"showBody",
	// Heatmap colour scale (Jaccard vs raw) only changes cell shading.
	"heatmapJaccard",
	// Lattice subset links only affect the back-layer of drawLattice —
	// toggling repaints without re-bucketing intersections.
	"latticeShowSubsetLinks",
]);

// Canonical JSON of the layout-affecting settings only: sort the keys for a
// stable order, drop every DISPLAY_ONLY_KEY, then stringify. Two settings
// objects that differ only in display-only keys produce an identical string,
// so `updateSettings` can skip the relayout. Pure — input is never mutated.
export function layoutSignature(s: MiniSettings): string {
	const out: Record<string, unknown> = {};
	const rec = s as unknown as Record<string, unknown>;
	for (const k of Object.keys(rec).sort()) {
		if (DISPLAY_ONLY_KEYS.has(k)) continue;
		out[k] = rec[k];
	}
	return JSON.stringify(out);
}
