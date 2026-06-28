import type { DrawLatticeOpts } from "./draw-lattice";
import type { MiniSettings } from "../types";

// Pure inputs the lattice renderer reads off the view. Extracted verbatim from
// MiniGraphView.draw() so the per-mode option assembly lives in one testable
// place (same pattern as mode-legend-input); the view keeps a thin wrapper that
// forwards `this` state plus the one behavioural callback it needs.
// `nameOf` is the view's only callback — it resolves an id → file basename via
// the live vault, which the renderer has no access to.
export interface LatticeDrawInputDeps {
	settings: MiniSettings;
	canvas: HTMLCanvasElement;
	dpr: number;
	zoom: number;
	panX: number;
	panY: number;
	selectedKey: string | null;
	hoverKey: string | null;
	namedKeys: Set<string>;
	nameOf: (id: string) => string;
}

export function computeLatticeDrawInput(deps: LatticeDrawInputDeps): DrawLatticeOpts {
	return {
		zoom: deps.zoom,
		panX: deps.panX,
		panY: deps.panY,
		canvas: deps.canvas,
		dpr: deps.dpr,
		minFontPx: deps.settings.minFontPx,
		settings: {
			// LOD is always "auto" here — the view never overrides it; the
			// renderer picks overview/density/individual from the node count.
			latticeNodeLOD: "auto",
			latticeIndividualMax: deps.settings.latticeIndividualMax,
			latticeDensityMax: deps.settings.latticeDensityMax,
			latticeDensityCells: deps.settings.latticeDensityCells,
			latticeShowSubsetLinks: deps.settings.latticeShowSubsetLinks,
		},
		selectedKey: deps.selectedKey,
		hoverKey: deps.hoverKey,
		namedKeys: deps.namedKeys,
		namedMax: deps.settings.latticeNamedMax,
		nameOf: deps.nameOf,
	};
}
