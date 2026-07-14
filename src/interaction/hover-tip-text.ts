// Pure text builders for the canvas hover tooltip (`view.ts`'s `showHover`).
// Each pure-data hover kind derives a `{ title, sub }` pair from plain values;
// extracting them keeps the tooltip wording (Jaccard formatting, shared-tag
// truncation, count nouns) unit-testable in isolation. No `obsidian`/DOM
// dependency. The `node` kind stays in the view — it needs a vault lookup.

import { jaccardFromCounts } from "../util/jaccard";

export interface TipText {
	title: string;
	sub: string;
}

// Heatmap cell: diagonal (i === j) shows the tag's own size; an off-diagonal
// cell shows the raw intersection count plus the Jaccard ratio, so both the
// absolute and the normalised strength read independently of the colour scale.
export function heatmapCellTipText(
	a: { label: string; size: number },
	b: { label: string; size: number },
	count: number,
	isDiagonal: boolean,
): TipText {
	if (isDiagonal) {
		return { title: a.label, sub: `${a.size} notes` };
	}
	const jac = jaccardFromCounts(a.size, b.size, count).toFixed(2);
	return { title: `${a.label} * ${b.label}`, sub: `${count} notes (Jaccard ${jac})` };
}

// Ghost (suggested-link) edge: up to `cap` shared tags as `#tag`, with a
// `(+N)` overflow marker, plus the bridge's Jaccard score.
export function ghostEdgeTipText(
	bridge: { sharedTags: string[]; jaccard: number },
	cap = 3,
): TipText {
	const tagsStr = bridge.sharedTags.slice(0, cap).map((t) => `#${t}`).join(" ");
	const more = bridge.sharedTags.length > cap ? ` (+${bridge.sharedTags.length - cap})` : "";
	return {
		title: "Suggested link",
		sub: `shared tags: ${tagsStr}${more} (Jaccard ${bridge.jaccard.toFixed(2)})`,
	};
}

// Cluster enclosure: label + member count.
export function clusterTipText(label: string, memberCount: number): TipText {
	return { title: label, sub: `${memberCount} items` };
}

// Aggregation group: the title is the tail of a `prefix:value` group key.
export function aggregationGroupTipText(groupKey: string, noteCount: number): TipText {
	return { title: groupKey.split(":")[1], sub: `${noteCount} notes` };
}
