// placeOverviewLabels: pure (canvas-free) placement logic for drawOverviewLabels'
// giant per-cluster watermark text. Extracted so it can take the small label
// chips (laid.labelCells) as pre-occupied space — the bug being fixed: the
// giant text's own collision check previously only avoided OTHER giant
// texts, never the small chips, so a chip and a giant text could render on
// top of each other (same tag name appearing twice, illegible).
import { ok } from "./assert";
import { placeOverviewLabels, type OverviewLabelInput, type MeasuredText } from "../src/draw/overview-label-placement";

// Deterministic stand-in for ctx.measureText at a fixed 100px font.
const measure = (text: string): MeasuredText => ({ width: text.length * 60, ascent: 74, descent: 20 });

// Baseline regression: with NO occupied space, a single qualifying cluster
// still gets placed (refactor must not change existing no-collision behavior).
{
	const clusters: OverviewLabelInput[] = [
		{ groupKey: "drama", text: "drama (36)", x: 0, y: 0, width: 400, height: 300 },
	];
	const placements = placeOverviewLabels(clusters, measure, []);
	ok(placements.length === 1, `expected exactly one placement with no occupied space, got ${placements.length}`);
	ok(placements[0].font > 0, "font size must be positive");
}

// The bug being fixed: a small label chip sitting at the cluster's centred
// candidate position must make the giant text skip THAT candidate, not
// render on top of it. With every candidate position pre-occupied, the
// giant text must be skipped entirely (matching the existing "no clear
// spot -> skip" behavior already used for giant-text-vs-giant-text).
{
	const clusters: OverviewLabelInput[] = [
		{ groupKey: "purgatorio", text: "purgatorio (3)", x: 0, y: 0, width: 200, height: 200 },
	];
	// Cover the full box — every one of the 8 fixed candidate positions
	// (all within the box per drawOverviewLabels' own af/sc table) collides.
	const occupied = [{ x1: -1000, y1: -1000, x2: 1000, y2: 1000 }];
	const placements = placeOverviewLabels(clusters, measure, occupied);
	ok(
		placements.length === 0,
		`expected the giant label to be skipped when a chip occupies its entire box, got ${placements.length} placements`,
	);
}

// A chip occupying only the box's top half must still allow the giant text
// to land in the bottom half (collision avoidance, not blanket suppression).
{
	const clusters: OverviewLabelInput[] = [
		{ groupKey: "inferno", text: "inferno (3)", x: 0, y: 0, width: 300, height: 300 },
	];
	const occupied = [{ x1: -150, y1: -150, x2: 150, y2: 0 }]; // top half only
	const placements = placeOverviewLabels(clusters, measure, occupied);
	ok(placements.length === 1, `expected the giant label to still find a clear spot in the bottom half, got ${placements.length}`);
	ok(placements[0].cy > 0, `expected the chosen candidate to land below the box's vertical centre (away from the occupied top half), got cy=${placements[0].cy}`);
}
