import { ok } from "./assert";
import { computeLatticeDrawInput } from "../src/draw/lattice-draw-input";
import { DEFAULT_SETTINGS, type MiniSettings } from "../src/types";

// Characterization tests for the pure lattice-draw-input builder extracted from
// MiniGraphView.draw(). They lock the option-assembly behaviour so the
// (verbatim) extraction can't silently drift.

function makeDeps(over: { settings?: Partial<MiniSettings> } = {}) {
	const settings: MiniSettings = { ...DEFAULT_SETTINGS, ...over.settings };
	const canvas = {} as HTMLCanvasElement;
	return {
		settings,
		canvas,
		dpr: 2,
		zoom: 1.5,
		panX: 10,
		panY: 20,
		selectedKey: "sel" as string | null,
		hoverKey: "hov" as string | null,
		namedKeys: new Set<string>(["a", "b"]),
		nameOf: (id: string) => `name:${id}`,
	};
}

// Per-frame values + live state pass straight through.
{
	const deps = makeDeps();
	const out = computeLatticeDrawInput(deps);
	ok(out.zoom === 1.5 && out.panX === 10 && out.panY === 20, "zoom/pan forwarded");
	ok(out.dpr === 2 && out.canvas === deps.canvas, "dpr/canvas forwarded");
	ok(out.selectedKey === "sel" && out.hoverKey === "hov", "selected/hover keys forwarded");
	ok(out.namedKeys === deps.namedKeys, "namedKeys forwarded by reference");
	ok(out.nameOf === deps.nameOf, "nameOf callback forwarded by reference");
}

// LOD is always "auto"; the remaining lattice settings are remapped 1:1.
{
	const out = computeLatticeDrawInput(
		makeDeps({
			settings: {
				minFontPx: 7,
				latticeIndividualMax: 11,
				latticeDensityMax: 22,
				latticeDensityCells: 33,
				latticeShowSubsetLinks: true,
				latticeNamedMax: 4,
			},
		}),
	);
	ok(out.minFontPx === 7, "minFontPx pulled from settings");
	ok(out.namedMax === 4, "namedMax pulled from settings.latticeNamedMax");
	ok(out.settings.latticeNodeLOD === "auto", "LOD is always auto");
	ok(out.settings.latticeIndividualMax === 11, "latticeIndividualMax remapped");
	ok(out.settings.latticeDensityMax === 22, "latticeDensityMax remapped");
	ok(out.settings.latticeDensityCells === 33, "latticeDensityCells remapped");
	ok(out.settings.latticeShowSubsetLinks === true, "latticeShowSubsetLinks remapped");
}
