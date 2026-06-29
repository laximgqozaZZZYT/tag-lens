// Scatter layout (F2). One card per displayed note on a flat grid — NO
// clusters, NO enclosures, NO edges. This is the "raw" placement: quantitative
// axis placement (`applyAxisLayout`, F2.4) overrides each node's x/y in scatter
// mode, so the grid here only needs to be a deterministic, non-overlapping
// fallback for notes before / without axis bindings.
//
// Unlike the Euler/BubbleSets card path, scatter keeps ONE positioned node per
// note (id = note id, no per-tag duplication) and carries the node's full
// membership list through so colour / status encoding still resolves.
import type { GraphData } from "../types";
import type {
	LaidOut,
	LayoutOptions,
	PositionedNode,
	SizedNode,
} from "./layout";
import { computeChannelDims, minFontScale } from "./card-sizing";

export function layoutScatter(
	data: GraphData,
	sized: SizedNode[],
	opts: LayoutOptions,
): LaidOut {
	const sizedById = new Map<string, SizedNode>();
	for (const s of sized) sizedById.set(s.id, s);
	const cardW = opts.cellW > 0 ? opts.cellW : sized[0]?.width ?? 80;
	const cardH = opts.cellH > 0 ? opts.cellH : sized[0]?.height ?? 24;
	const { channelW, channelH } = computeChannelDims(
		opts.nodeSpacing,
		minFontScale(opts.minFontPx ?? 0),
	);
	const slotW = cardW + channelW;
	const slotH = cardH + channelH;

	// Square-ish row-major grid on the slot pitch — deterministic and
	// overlap-free until axis placement repositions everything.
	const cols = Math.max(1, Math.ceil(Math.sqrt(data.nodes.length)));
	const nodes: PositionedNode[] = data.nodes.map((n, i) => {
		const sz = sizedById.get(n.id);
		return {
			id: n.id,
			label: n.label,
			memberships: n.memberships,
			x: (i % cols) * slotW,
			y: Math.floor(i / cols) * slotH,
			width: sz?.width ?? cardW,
			height: sz?.height ?? cardH,
			mtime: n.mtime,
			fmMaturity: n.fmMaturity,
			ageDays: n.ageDays,
			isPeripheral: n.isPeripheral,
		};
	});

	return {
		nodes,
		edges: [],
		clusters: [],
		trunks: [],
		slotW,
		slotH,
		channelW,
		channelH,
	};
}
