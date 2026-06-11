// Tag co-occurrence heatmap layout. Rows AND columns are the same seriated
// list of membership tags (symmetric), so cell (i,j) = |Ti ∩ Tj| and the
// diagonal (i,i) = |Ti|. Pairwise only (2 tags) — 3-way+ intersections are the
// matrix / UpSet job. Reuses the matrix Jaccard barycenter for the tag order
// and the matrix min-size filter pattern for axis culling.
import { GraphData } from "./types";
import type { LaidOut, LayoutOptions, HeatmapMeta } from "./layout";
import { barycenter } from "./matrix-layout";
import { computeChannelDims, minFontScale } from "./card-sizing";

const CELL = 18; // world units per square cell (px at zoom 1)

export function layoutHeatmap(data: GraphData, opts: LayoutOptions): LaidOut {
	const labels = opts.clusterLabels ?? new Map<string, string>();
	const minSize = Math.max(1, opts.heatmapMinTagSize ?? 2);
	const { channelW, channelH } = computeChannelDims(
		opts.nodeSpacing,
		minFontScale(opts.minFontPx ?? 0),
	);
	const slotW = (opts.cellW > 0 ? opts.cellW : 80) + channelW;
	const slotH = (opts.cellH > 0 ? opts.cellH : 24) + channelH;

	// Axis tags: membership values with size ≥ minSize, size-desc (alpha tiebreak).
	const tagCount = new Map<string, number>();
	for (const n of data.nodes)
		for (const m of n.memberships) tagCount.set(m, (tagCount.get(m) ?? 0) + 1);
	const tagKeys = [...tagCount.keys()]
		.filter((k) => (tagCount.get(k) ?? 0) >= minSize)
		.sort((a, b) => tagCount.get(b)! - tagCount.get(a)! || (a < b ? -1 : 1));
	const tagIndex = new Map<string, number>();
	tagKeys.forEach((k, i) => tagIndex.set(k, i));
	const nTags = tagKeys.length;

	// tag → note indices (barycenter rows), note → tag indices (barycenter cols),
	// tag → node ids (intersected on cell click).
	const tagNotes: number[][] = tagKeys.map(() => []);
	const noteTags: number[][] = data.nodes.map(() => []);
	const tagNodeIds: string[][] = tagKeys.map(() => []);
	data.nodes.forEach((n, r) => {
		for (const m of n.memberships) {
			const t = tagIndex.get(m);
			if (t === undefined) continue;
			tagNotes[t].push(r);
			noteTags[r].push(t);
			tagNodeIds[t].push(n.id);
		}
	});

	// Seriation: one order applied to BOTH axes (symmetry guarantee). Tags are
	// the barycenter rows → rowOrder is the tag order by note-profile similarity.
	let order = tagKeys.map((_, i) => i);
	if (opts.heatmapCriterion !== "size" && nTags > 1 && data.nodes.length > 1) {
		order = barycenter(tagNotes, noteTags, nTags, data.nodes.length).rowOrder;
	}
	if ((opts.heatmapSortDir ?? "desc") === "asc") order = order.slice().reverse();

	const tags = order.map((t) => ({
		key: tagKeys[t],
		label: labels.get(tagKeys[t]) ?? tagKeys[t],
		size: tagCount.get(tagKeys[t])!,
	}));
	const nodeIds = order.map((t) => tagNodeIds[t]);

	// Symmetric n×n intersection counts in DISPLAY order. Diagonal accumulates
	// to |Ti| (each note having tag i bumps [i,i] once); off-diagonal pairs are
	// bumped symmetrically.
	const n = nTags;
	const disp = new Array<number>(n);
	order.forEach((t, pos) => (disp[t] = pos));
	const counts = new Uint32Array(n * n);
	for (let r = 0; r < data.nodes.length; r++) {
		const ts = noteTags[r];
		for (let a = 0; a < ts.length; a++) {
			const ia = disp[ts[a]];
			counts[ia * n + ia] += 1;
			for (let b = a + 1; b < ts.length; b++) {
				const ib = disp[ts[b]];
				counts[ia * n + ib] += 1;
				counts[ib * n + ia] += 1;
			}
		}
	}

	// Colour-scale references: max off-diagonal + 95th-percentile of off-diagonal
	// nonzero counts (so a couple of giant tag pairs can't wash everything out in
	// raw-count mode — see draw-heatmap log+clamp).
	const offVals: number[] = [];
	let maxOff = 0;
	for (let i = 0; i < n; i++)
		for (let j = i + 1; j < n; j++) {
			const v = counts[i * n + j];
			if (v > 0) {
				offVals.push(v);
				if (v > maxOff) maxOff = v;
			}
		}
	offVals.sort((a, b) => a - b);
	const p95 = offVals.length
		? offVals[Math.min(offVals.length - 1, Math.floor(offVals.length * 0.95))]
		: 1;

	const heatmap: HeatmapMeta = { tags, counts, n, nodeIds, maxOff, p95, cell: CELL, totalNotes: data.nodes.length };
	return { nodes: [], edges: [], clusters: [], trunks: [], slotW, slotH, channelW, channelH, heatmap };
}
