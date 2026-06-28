import { ok } from "./assert";
import { computeUpsetDrawInput } from "../src/draw/upset-draw-input";
import { DEFAULT_SETTINGS, type MiniSettings } from "../src/types";

// Characterization tests for the pure upset-draw-input builder extracted from
// MiniGraphView.draw(). They lock the option-assembly behaviour so the (verbatim)
// extraction can't silently drift.

function makeDeps(over: { settings?: Partial<MiniSettings> } = {}) {
	const settings: MiniSettings = { ...DEFAULT_SETTINGS, ...over.settings };
	// Canvas geometry is read off clientWidth/clientHeight, not the backing-store
	// width/height — the footer is screen-fixed.
	const canvas = { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement;
	return {
		settings,
		canvas,
		dpr: 2,
		zoom: 1.5,
		panX: 10,
		panY: 20,
		selectedSignatureKey: "a|b" as string | null,
	};
}

// Canvas geometry comes from clientWidth/clientHeight; per-frame state passes through.
{
	const deps = makeDeps();
	const out = computeUpsetDrawInput(deps);
	ok(out.canvasW === 800 && out.canvasH === 600, "canvas geometry from clientWidth/clientHeight");
	ok(out.dpr === 2, "dpr forwarded");
	ok(out.zoom === 1.5 && out.panX === 10 && out.panY === 20, "zoom/pan forwarded");
	ok(out.selectedSignatureKey === "a|b", "selectedSignatureKey forwarded");
}

// minFontPx is pulled from settings.
{
	const out = computeUpsetDrawInput(makeDeps({ settings: { minFontPx: 9 } }));
	ok(out.minFontPx === 9, "minFontPx pulled from settings");
}

// A null selection survives the pass-through (no signature highlighted).
{
	const deps = makeDeps();
	deps.selectedSignatureKey = null;
	const out = computeUpsetDrawInput(deps);
	ok(out.selectedSignatureKey === null, "null selection forwarded");
}
