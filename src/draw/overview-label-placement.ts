// Pure (canvas-free) placement logic for drawOverviewLabels' giant
// per-cluster watermark text. Extracted from draw-helpers.ts so the
// collision-avoidance search can be unit-tested without a CanvasRenderingContext2D,
// and so the caller can seed it with ALREADY-PLACED label chips
// (laid.labelCells, drawn by drawClusterLabels) as occupied space — the
// giant text's own greedy search previously only avoided OTHER giant
// texts, never the small chips, letting the same tag's name render twice
// in the same spot (illegible).
export interface OverviewLabelInput {
	groupKey: string;
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface OverviewLabelPlacement {
	groupKey: string;
	text: string;
	cx: number;
	cy: number;
	font: number;
}

export interface MeasuredText {
	width: number;
	ascent: number;
	descent: number;
}

interface Box {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

// Greedy, largest-cluster-first. Each label tries: centred full size, then
// progressively smaller, then nudged up/down — taking the first spot that
// doesn't collide with an already-placed label OR a pre-occupied box
// (typically the small label chips). Labels that can't find a clear spot
// are skipped (something else already covers that area).
const CANDIDATES: Array<[number, number]> = [
	[0.5, 1.0],
	[0.5, 0.72],
	[0.5, 0.52],
	[0.3, 0.52],
	[0.7, 0.52],
	[0.5, 0.38],
	[0.3, 0.38],
	[0.7, 0.38],
];

function intersects(a: Box, b: Box): boolean {
	return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

export function placeOverviewLabels(
	clusters: OverviewLabelInput[],
	measureAt100px: (text: string) => MeasuredText,
	occupied: Box[] = [],
): OverviewLabelPlacement[] {
	const ordered = [...clusters].sort((a, b) => b.width * b.height - a.width * a.height);
	const placed: Box[] = [...occupied];
	const result: OverviewLabelPlacement[] = [];
	for (const c of ordered) {
		if (!c.text) continue;
		const cx = c.x + c.width / 2;
		const m = measureAt100px(c.text);
		const w100 = m.width || 1;
		const h100 = (m.ascent || 74) + (m.descent || 20);
		const baseFont = Math.min((c.width * 0.88 * 100) / w100, (c.height * 0.6 * 100) / h100);
		if (!(baseFont > 0)) continue;
		let chosen: { font: number; cy: number } | null = null;
		for (const [af, sc] of CANDIDATES) {
			const font = baseFont * sc;
			const tw = (w100 / 100) * font;
			const th = font;
			const cy = c.y + c.height * af;
			const pad = font * 0.12;
			const box: Box = {
				x1: cx - tw / 2 - pad,
				y1: cy - th / 2 - pad,
				x2: cx + tw / 2 + pad,
				y2: cy + th / 2 + pad,
			};
			if (!placed.some((p) => intersects(box, p))) {
				chosen = { font, cy };
				placed.push(box);
				break;
			}
		}
		if (!chosen) continue;
		result.push({ groupKey: c.groupKey, text: c.text, cx, cy: chosen.cy, font: chosen.font });
	}
	return result;
}
