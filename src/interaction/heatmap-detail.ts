// Pure helper for the tag×tag co-occurrence heatmap's cell-click detail.
// Extracted from `view.ts`'s `openHeatmapDetail` so the diagonal-vs-intersection
// rule is unit-testable in isolation. No `obsidian`/DOM dependency.

// Given the heatmap's per-index note-id lists (`HeatmapMeta.nodeIds`, where
// `nodeIds[k]` holds the notes carrying tag `k`) and a clicked cell `(i, j)`,
// return the notes that cell represents, de-duplicated in first-seen order:
//   - diagonal (i === j): every note carrying tag `i`.
//   - off-diagonal:       the intersection — notes carrying BOTH tag `i` and `j`.
// Out-of-range indices resolve to an empty list (missing row → no notes).
export function heatmapCellNoteIds(nodeIds: string[][], i: number, j: number): string[] {
	const a = nodeIds[i] ?? [];
	if (i === j) return [...new Set(a)];
	const setB = new Set(nodeIds[j] ?? []);
	return [...new Set(a.filter((id) => setB.has(id)))];
}
