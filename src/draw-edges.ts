import type { LaidOut } from "./layout";
import { theme, colorAlpha } from "./theme";

// Colour palette for hover / accent rendering. Centralised here so the
// "warm = outgoing, cool = incoming" convention is enforced by the
// renderer instead of being duplicated as magic strings. Functions (not
// consts) so each call re-reads the current theme — the warm/cool accents
// follow Obsidian's accent/warning colours, and the faint base lines flip
// with the base colour via overlay/colorAlpha.
const edgeDim = () => theme().overlay(0.1);
const edgeLine = () => colorAlpha(theme().textMuted, 0.55);
const edgeAccentOut = () => theme().warn;
const edgeGlowOut = () => colorAlpha(theme().warn, 0.35);
const edgeAccentIn = () => theme().accent;
const edgeGlowIn = () => colorAlpha(theme().accent, 0.35);

// Predicate that decides whether a node is currently invisible (= hidden
// via layer panel checkbox, or fully aggregated into a stack). Edges
// whose source OR target satisfies this predicate must be skipped — the
// orphan end would otherwise dangle to a card that isn't drawn.
export type SkipNodeFn = (id: string) => boolean;

// Layer 1: base edges. ALL surviving edges drawn at uniform thin line
// width. When `hasHighlight` is set, edges that ARE in the highlight set
// are skipped here (Layer 3 paints them with the accent palette).
export function drawBaseEdges(
	ctx: CanvasRenderingContext2D,
	laid: LaidOut,
	zoom: number,
	highlightedEdgeIdx: Set<number>,
	skipNode: SkipNodeFn,
): void {
	const hasHighlight = highlightedEdgeIdx.size > 0;
	ctx.lineWidth = 0.7 / zoom;
	laid.edges.forEach((e, i) => {
		if (hasHighlight && highlightedEdgeIdx.has(i)) return;
		// Secondary (non-main) edges — e.g. bipartite "clustered" sub-memberships
		// — are hidden in the base layer; they only light up on hover (accent).
		// No-op for modes that never set the flag.
		if (e.secondary) return;
		if (skipNode(e.source) || skipNode(e.target)) return;
		const path = e.path;
		if (!path || path.length < 2) return;
		ctx.strokeStyle = hasHighlight ? edgeDim() : edgeLine();
		ctx.beginPath();
		ctx.moveTo(path[0].x, path[0].y);
		for (let i2 = 1; i2 < path.length; i2++) {
			ctx.lineTo(path[i2].x, path[i2].y);
		}
		ctx.stroke();
	});
}

// Layer 3: accent edges. Drawn AFTER base cards so they overlay the
// stub segments at each card centre. Direction-aware colouring: when
// `hoveredNodeId` is non-null, edges whose source IS the hovered node
// are "outgoing" (warm); edges whose target IS the hovered node are
// "incoming backlinks" (cool). Cluster hover (hoveredNodeId === null)
// falls back to the outgoing palette so the whole cluster reads as one
// emitter.
export function drawAccentEdges(
	ctx: CanvasRenderingContext2D,
	laid: LaidOut,
	zoom: number,
	highlightedEdgeIdx: Set<number>,
	hoveredNodeId: string | null,
	skipNode: SkipNodeFn,
): void {
	const accentSolidW = 1.8 / zoom;
	const accentGlowW = 5 / zoom;
	laid.edges.forEach((e, i) => {
		if (!highlightedEdgeIdx.has(i)) return;
		if (skipNode(e.source) || skipNode(e.target)) return;
		const path = e.path;
		if (!path || path.length < 2) return;
		const isOutgoing =
			hoveredNodeId !== null ? e.source === hoveredNodeId : true;
		const accent = isOutgoing ? edgeAccentOut() : edgeAccentIn();
		const glow = isOutgoing ? edgeGlowOut() : edgeGlowIn();
		// Glow first (wide, translucent), accent second (narrow, opaque)
		// so the inner solid line sits centred inside its halo.
		ctx.strokeStyle = glow;
		ctx.lineWidth = accentGlowW;
		ctx.beginPath();
		ctx.moveTo(path[0].x, path[0].y);
		for (let i2 = 1; i2 < path.length; i2++) {
			ctx.lineTo(path[i2].x, path[i2].y);
		}
		ctx.stroke();
		ctx.strokeStyle = accent;
		ctx.lineWidth = accentSolidW;
		ctx.beginPath();
		ctx.moveTo(path[0].x, path[0].y);
		for (let i2 = 1; i2 < path.length; i2++) {
			ctx.lineTo(path[i2].x, path[i2].y);
		}
		ctx.stroke();
	});
}
