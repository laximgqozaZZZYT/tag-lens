import { ok } from "./assert";
import {
	computeEnclosureDrawInput,
	type EnclosureDrawInputDeps,
} from "../src/draw/enclosure-draw-input";
import { DEFAULT_SETTINGS, type MiniSettings } from "../src/types";

// Characterization tests for the pure enclosure-draw-input builder extracted
// from MiniGraphView.drawBodyTile(). They lock the per-mode option assembly
// (suppress rules, bubblesets-vs-euler dispatch, hovered-node centre) so the
// extraction can't silently drift.

function makeDeps(
	over: {
		settings?: Partial<MiniSettings>;
	} & Partial<Omit<EnclosureDrawInputDeps, "settings">> = {},
): EnclosureDrawInputDeps {
	const { settings: settingsOver, ...rest } = over;
	const settings: MiniSettings = {
		...DEFAULT_SETTINGS,
		showEnclosures: true,
		...settingsOver,
	};
	return {
		settings,
		upset: false,
		clusters: [],
		nodes: [
			{ id: "a", x: 10, y: 20 },
			{ id: "b", x: 30, y: 40 },
		],
		highlightedClusters: new Set<string>(),
		zoom: 1,
		hoveredNodeId: null,
		...rest,
	};
}

// Default (non-bubblesets) mode dispatches to the euler painter.
{
	const out = computeEnclosureDrawInput(makeDeps({ settings: { viewMode: "lattice" } }));
	ok(out !== null, "enclosure input produced when toggle on");
	ok(out?.kind === "euler", "non-bubblesets mode → euler");
}

// BubbleSets mode dispatches to the bubblesets painter.
{
	const out = computeEnclosureDrawInput(makeDeps({ settings: { viewMode: "bubblesets" } }));
	ok(out?.kind === "bubblesets", "bubblesets mode → bubblesets");
}

// Enclosures suppressed when the toggle is off.
{
	const out = computeEnclosureDrawInput(makeDeps({ settings: { showEnclosures: false } }));
	ok(out === null, "showEnclosures off → null");
}

// Enclosures suppressed in UpSet mode (no body tile).
{
	const out = computeEnclosureDrawInput(makeDeps({ upset: true }));
	ok(out === null, "upset → null");
}

// The hovered node's centre is resolved to a hoverPos.
{
	const out = computeEnclosureDrawInput(makeDeps({ hoveredNodeId: "b" }));
	ok(out?.hoverPos?.x === 30 && out?.hoverPos?.y === 40, "hovered node centre resolved");
}

// No hover → null hoverPos; an unknown id also yields null.
{
	ok(computeEnclosureDrawInput(makeDeps())?.hoverPos === null, "no hover → null hoverPos");
	ok(
		computeEnclosureDrawInput(makeDeps({ hoveredNodeId: "zzz" }))?.hoverPos === null,
		"unknown hovered id → null hoverPos",
	);
}

// warningClusters is always undefined (parity with the old call sites).
{
	const out = computeEnclosureDrawInput(makeDeps());
	ok(out?.warningClusters === undefined, "warningClusters undefined");
}
