import type { DrawUpsetOpts } from "./draw-upset";
import type { MiniSettings } from "../types";

// Pure inputs the UpSet footer renderer reads off the view. Extracted verbatim
// from MiniGraphView.draw() so the per-mode option assembly lives in one testable
// place (same pattern as computeLatticeDrawInput / computeDrosteDrawInput /
// computeHeatmapDrawInput). Canvas geometry is read from the live canvas; the rest
// is a plain pass-through of per-frame state + settings.
export interface UpsetDrawInputDeps {
	settings: MiniSettings;
	canvas: HTMLCanvasElement;
	dpr: number;
	zoom: number;
	panX: number;
	panY: number;
	selectedSignatureKey: string | null;
}

export function computeUpsetDrawInput(deps: UpsetDrawInputDeps): DrawUpsetOpts {
	return {
		canvasW: deps.canvas.clientWidth,
		canvasH: deps.canvas.clientHeight,
		dpr: deps.dpr,
		zoom: deps.zoom,
		panX: deps.panX,
		panY: deps.panY,
		selectedSignatureKey: deps.selectedSignatureKey,
		minFontPx: deps.settings.minFontPx,
	};
}
