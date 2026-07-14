// clampUpsetPanX(panX, contentW, canvasW, leftBandPx) — the UpSet horizontal
// pan clamp (user spec 2026-05-26): cards start at the right edge of the
// row-label band and never reveal empty canvas past their edges.
import { ok } from "./assert";
import { clampUpsetPanX } from "../src/interaction/upset-pan";

const BAND = 120;
const CANVAS = 800;

// Content narrower than the area right of the band → pin to maxPanX (=band),
// regardless of the requested pan.
ok(clampUpsetPanX(0, 300, CANVAS, BAND) === BAND, "fits → pin to leftBandPx");
ok(clampUpsetPanX(9999, 300, CANVAS, BAND) === BAND, "fits → ignores requested pan");
ok(clampUpsetPanX(-9999, CANVAS - BAND, CANVAS, BAND) === BAND, "exactly fills available → still pins");

// Content wider than available → clamp into [minPanX, maxPanX].
// contentW=1000, canvasW=800 → minPanX = 800-1000 = -200, maxPanX = 120.
ok(clampUpsetPanX(0, 1000, CANVAS, BAND) === 0, "in-range pan passes through");
ok(clampUpsetPanX(500, 1000, CANVAS, BAND) === BAND, "past left edge → maxPanX");
ok(clampUpsetPanX(-500, 1000, CANVAS, BAND) === -200, "past right edge → minPanX");

// Equivalence with the old inline spelling at every representative pan.
for (const panX of [-999, -200, -50, 0, 100, 120, 500]) {
	const contentW = 1000;
	const availableW = CANVAS - BAND;
	const maxPanX = BAND;
	const inline =
		contentW <= availableW ? maxPanX : Math.max(CANVAS - contentW, Math.min(maxPanX, panX));
	ok(clampUpsetPanX(panX, contentW, CANVAS, BAND) === inline, `matches inline for panX=${panX}`);
}
