import type { DrawHeatmapOpts } from "./draw-heatmap";
import type { MiniSettings } from "../types";
import type { TagGap } from "../query/gap-finder";

// Pure inputs the co-occurrence heatmap renderer reads off the view. Extracted
// verbatim from MiniGraphView.draw() so the per-mode option assembly lives in one
// testable place (same pattern as computeLatticeDrawInput / computeDrosteDrawInput).
// Everything here is a plain pass-through of per-frame state + settings — the
// heatmap renderer holds no live view references of its own.
export interface HeatmapDrawInputDeps {
	settings: MiniSettings;
	canvas: HTMLCanvasElement;
	dpr: number;
	zoom: number;
	panX: number;
	panY: number;
	// findGaps output for the dashed "missing intersection" overlay; empty when
	// the gapFinder toggle is off (rebuild() only populates it when on).
	gaps: TagGap[];
	selected: { i: number; j: number } | null;
	hoverRow: number;
	hoverCol: number;
}

export function computeHeatmapDrawInput(deps: HeatmapDrawInputDeps): DrawHeatmapOpts {
	return {
		zoom: deps.zoom,
		panX: deps.panX,
		panY: deps.panY,
		canvas: deps.canvas,
		dpr: deps.dpr,
		minFontPx: deps.settings.minFontPx,
		jaccard: deps.settings.heatmapJaccard,
		gapFinder: deps.settings.gapFinder,
		gaps: deps.gaps,
		selected: deps.selected,
		hoverRow: deps.hoverRow,
		hoverCol: deps.hoverCol,
	};
}
