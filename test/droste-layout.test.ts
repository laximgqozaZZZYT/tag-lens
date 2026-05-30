import { approx, ok } from "./assert";
import { layoutDroste, assertCellsSquare } from "../src/droste-layout";
import type { GraphData } from "../src/types";

// Minimal fixture: node n0 in cluster A; n1 in A; cluster B separate.
const data: GraphData = {
	nodes: [
		{ id: "n0", label: "n0", memberships: ["A"] },
		{ id: "n1", label: "n1", memberships: ["A"] },
		{ id: "n2", label: "n2", memberships: ["B"] },
	],
	edges: [],
};

const meta = layoutDroste(data, { focusId: "n0" });

// Focus node placed at the bottom-left corner: first cell of quadrant 1.
const focus = meta.elements.find((e) => e.id === "n0");
ok(!!focus, "focus element exists");
approx(focus!.v0, 0, 1e-9, "focus starts at v=0");
approx(focus!.u0, meta.cell, 1e-9, "focus on the first radial row (uBase = cell)");

// All elements live within one period [0, 2π).
for (const e of meta.elements) {
	ok(e.v0 >= 0 && e.v1 <= 2 * Math.PI + 1e-9, `element ${e.id} within [0,2π]`);
}

// Approach B invariant (spec §2.1): every tile is a SQUARE in ζ-space (Δu = Δv).
const sq = assertCellsSquare(meta);
approx(sq.maxAspectGap, 0, 1e-12, "all cells square in ζ (Δu = Δv)");
ok(sq.allWithinPeriod, "all cells within one period");

// Δ = (π/2)/cols for the default cols=6, and each cell extends by exactly Δ.
approx(meta.cell, Math.PI / 2 / 6, 1e-12, "Δ = (π/2)/cols");
approx(focus!.u1 - focus!.u0, meta.cell, 1e-12, "cell radial extent = Δ");
approx(focus!.v1 - focus!.v0, meta.cell, 1e-12, "cell angular extent = Δ");

// Overflow folds into a single "+N" cell so element count stays bounded
// regardless of vault size (cols*rows per level cap).
{
	const big: GraphData = {
		nodes: Array.from({ length: 500 }, (_, i) => ({
			id: "x" + i,
			label: "x" + i,
			memberships: ["A"],
		})),
		edges: [],
	};
	const m2 = layoutDroste(big, { focusId: "x0" });
	const lvl1Count = m2.elements.filter((e) => e.level === 1).length;
	ok(lvl1Count <= 6 * 5, `level 1 capped at cols*rows (got ${lvl1Count})`);
	ok(
		m2.elements.some((e) => e.label.startsWith("+")),
		"overflow folded into a +N cell",
	);
}
