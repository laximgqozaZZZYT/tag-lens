import { ok } from "./assert";
import { computeHeatmapDrawInput } from "../src/draw/heatmap-draw-input";
import { DEFAULT_SETTINGS, type MiniSettings } from "../src/types";
import type { TagGap } from "../src/query/gap-finder";

// Characterization tests for the pure heatmap-draw-input builder extracted from
// MiniGraphView.draw(). They lock the option-assembly behaviour so the (verbatim)
// extraction can't silently drift.

function makeDeps(over: { settings?: Partial<MiniSettings> } = {}) {
	const settings: MiniSettings = { ...DEFAULT_SETTINGS, ...over.settings };
	const canvas = {} as HTMLCanvasElement;
	const gaps: TagGap[] = [];
	return {
		settings,
		canvas,
		gaps,
		dpr: 2,
		zoom: 1.5,
		panX: 10,
		panY: 20,
		selected: { i: 3, j: 4 } as { i: number; j: number } | null,
		hoverRow: 5,
		hoverCol: 6,
	};
}

// Per-frame values + live refs pass straight through by reference.
{
	const deps = makeDeps();
	const out = computeHeatmapDrawInput(deps);
	ok(out.zoom === 1.5 && out.panX === 10 && out.panY === 20, "zoom/pan forwarded");
	ok(out.dpr === 2 && out.canvas === deps.canvas, "dpr/canvas forwarded");
	ok(out.gaps === deps.gaps, "gaps array forwarded by reference");
	ok(out.selected === deps.selected, "selected forwarded by reference");
	ok(out.hoverRow === 5 && out.hoverCol === 6, "hover row/col forwarded");
}

// minFontPx / jaccard / gapFinder are pulled from settings.
{
	const out = computeHeatmapDrawInput(
		makeDeps({ settings: { minFontPx: 9, heatmapJaccard: true, gapFinder: true } }),
	);
	ok(out.minFontPx === 9, "minFontPx pulled from settings");
	ok(out.jaccard === true, "jaccard pulled from settings.heatmapJaccard");
	ok(out.gapFinder === true, "gapFinder pulled from settings.gapFinder");
}
