// heatmapCellNoteIds(nodeIds, i, j) — the tag×tag heatmap cell-click detail
// rule extracted from view.ts's openHeatmapDetail.
import { ok } from "./assert";
import { heatmapCellNoteIds } from "../src/interaction/heatmap-detail";

const nodeIds = [
	["a", "b", "c"], // tag 0
	["b", "c", "d"], // tag 1
	["e"], // tag 2
];

// Diagonal → every note carrying that tag.
{
	ok(heatmapCellNoteIds(nodeIds, 0, 0).join(",") === "a,b,c", "diagonal is the whole cell");
	ok(heatmapCellNoteIds(nodeIds, 2, 2).join(",") === "e", "singleton diagonal");
}

// Off-diagonal → intersection, in row-i first-seen order.
{
	ok(heatmapCellNoteIds(nodeIds, 0, 1).join(",") === "b,c", "intersection of 0 and 1");
	ok(heatmapCellNoteIds(nodeIds, 1, 0).join(",") === "b,c", "intersection order follows row i");
	ok(heatmapCellNoteIds(nodeIds, 0, 2).length === 0, "disjoint cells → empty");
}

// De-duplication (defensive — the cell lists should already be unique).
{
	ok(heatmapCellNoteIds([["x", "x", "y"]], 0, 0).join(",") === "x,y", "diagonal dedups");
	ok(heatmapCellNoteIds([["x", "x"], ["x"]], 0, 1).join(",") === "x", "intersection dedups");
}

// Out-of-range indices resolve to empty (missing row → no notes, no throw).
{
	ok(heatmapCellNoteIds(nodeIds, 9, 9).length === 0, "missing diagonal row → empty");
	ok(heatmapCellNoteIds(nodeIds, 0, 9).length === 0, "missing off-diagonal col → empty");
}

// Input is never mutated.
{
	const src = [["a", "b"], ["b"]];
	heatmapCellNoteIds(src, 0, 1);
	ok(src[0].join(",") === "a,b" && src[1].join(",") === "b", "input untouched");
}
