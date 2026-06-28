import { ok } from "./assert";
import { computeDrosteDrawInput } from "../src/draw/droste-draw-input";
import { DEFAULT_SETTINGS, type MiniSettings } from "../src/types";
import type { DrosteGallery } from "../src/layout/droste-layout";

// Characterization tests for the pure droste-draw-input builder extracted from
// MiniGraphView.draw(). They lock the option-assembly behaviour so the (verbatim)
// extraction can't silently drift.

function makeDeps(over: { settings?: Partial<MiniSettings> } = {}) {
	const settings: MiniSettings = { ...DEFAULT_SETTINGS, ...over.settings };
	const canvas = {} as HTMLCanvasElement;
	const gallery = {} as DrosteGallery;
	const hitRegions: { id: string; x0: number; y0: number; x1: number; y1: number }[] = [];
	return {
		settings,
		canvas,
		gallery,
		hitRegions,
		dpr: 2,
		cellSize: 240,
		zoom: 1.5,
		panX: 10,
		panY: 20,
		hoverId: "hov" as string | null,
	};
}

// Per-frame values + live refs pass straight through by reference.
{
	const deps = makeDeps();
	const out = computeDrosteDrawInput(deps);
	ok(out.zoom === 1.5 && out.panX === 10 && out.panY === 20, "zoom/pan forwarded");
	ok(out.dpr === 2 && out.canvas === deps.canvas, "dpr/canvas forwarded");
	ok(out.cellSize === 240, "cellSize forwarded");
	ok(out.gallery === deps.gallery, "gallery forwarded by reference");
	ok(out.hoverId === "hov", "hoverId forwarded");
	ok(out.hitRegions === deps.hitRegions, "live hitRegions array forwarded by reference");
}

// focusId pulled from settings; hiddenSet is a fresh Set of settings.hiddenNodes.
{
	const out = computeDrosteDrawInput(
		makeDeps({ settings: { drosteFocus: "node-7", hiddenNodes: ["a", "b", "a"] } }),
	);
	ok(out.focusId === "node-7", "focusId pulled from settings.drosteFocus");
	ok(out.hiddenSet instanceof Set, "hiddenSet is a Set");
	ok(
		out.hiddenSet?.has("a") === true && out.hiddenSet?.has("b") === true && out.hiddenSet?.size === 2,
		"hiddenSet contains the (deduped) hidden node ids",
	);
}
