import { ok } from "./assert";
import { figureIsEmpty } from "../src/draw/figure-empty";
import type { LaidOut } from "../src/layout/layout";

// Characterization tests for the pure empty-figure predicate extracted from
// MiniGraphView.draw()'s "No nodes match current filters" gate. They lock the
// "empty iff every mode's content slot is empty" rule so the extraction can't
// silently drift.

function laid(over: Partial<LaidOut>): LaidOut {
	return { nodes: [], ...over } as unknown as LaidOut;
}

// The all-empty base case → the hint fires.
ok(figureIsEmpty(laid({})), "no content anywhere → empty");

// Any single populated slot suppresses the hint.
ok(
	!figureIsEmpty(laid({ nodes: [{ id: "a" } as never] })),
	"world-positioned cards → not empty",
);
ok(
	!figureIsEmpty(laid({ upset: { columns: [{}] } as never })),
	"UpSet columns → not empty (nodes stays empty by design)",
);
ok(!figureIsEmpty(laid({ heatmap: { n: 3 } as never })), "heatmap cells → not empty");
ok(
	!figureIsEmpty(laid({ lattice: { nodes: [{}] } as never })),
	"lattice nodes → not empty",
);

// Degenerate slots (present but empty) count as empty.
ok(
	figureIsEmpty(laid({ upset: { columns: [] } as never, heatmap: { n: 0 } as never })),
	"empty upset columns + zero heatmap cells → still empty",
);
ok(
	figureIsEmpty(laid({ lattice: { nodes: [] } as never })),
	"empty lattice nodes → still empty",
);
