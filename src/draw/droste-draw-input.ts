import type { DrawDrosteOpts } from "./draw-droste";
import type { DrosteGallery } from "../layout/droste-layout";
import type { MiniSettings } from "../types";

// Pure inputs the droste (Icon Gallery) renderer reads off the view. Extracted
// verbatim from MiniGraphView.draw() so the per-mode option assembly lives in one
// testable place (same pattern as computeLatticeDrawInput / buildModeLegendInput).
// `hitRegions` is the ONE thing the wrapper keeps: the draw path fills it in
// place, and the view must hold the same reference for later hit-testing — so the
// view does `this.drosteHit = []` and passes that live array in here. Everything
// else is a pure pass-through of per-frame state + settings.
export interface DrosteDrawInputDeps {
	settings: MiniSettings;
	canvas: HTMLCanvasElement;
	dpr: number;
	gallery: DrosteGallery;
	cellSize: number;
	zoom: number;
	panX: number;
	panY: number;
	hoverId: string | null;
	// The live hit-region array the view holds onto (assigned in the wrapper).
	hitRegions: { id: string; x0: number; y0: number; x1: number; y1: number }[];
}

export function computeDrosteDrawInput(deps: DrosteDrawInputDeps): DrawDrosteOpts {
	return {
		canvas: deps.canvas,
		dpr: deps.dpr,
		gallery: deps.gallery,
		cellSize: deps.cellSize,
		zoom: deps.zoom,
		panX: deps.panX,
		panY: deps.panY,
		hoverId: deps.hoverId,
		focusId: deps.settings.drosteFocus,
		hitRegions: deps.hitRegions,
		// Live hidden set so the draw path skips unchecked cells immediately on
		// requestDraw() — no rebuild required (matches the skipNode path used by
		// all other view modes).
		hiddenSet: new Set(deps.settings.hiddenNodes),
	};
}
