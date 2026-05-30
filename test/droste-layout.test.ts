import { approx, ok } from "./assert";
import { layoutDroste, assertCellsSquare } from "../src/droste-layout";
import type { GraphData } from "../src/types";

// Fixture: n0,n1 share cluster A; n2 in B. Explicit cols/rows for determinism.
const data: GraphData = {
	nodes: [
		{ id: "n0", label: "n0", memberships: ["A"] },
		{ id: "n1", label: "n1", memberships: ["A"] },
		{ id: "n2", label: "n2", memberships: ["B"] },
	],
	edges: [],
};
const labels = new Map([["A", "Alpha"], ["B", "Beta"]]);
const meta = layoutDroste(data, { focusId: "n0", labels, cols: 8, rows: 3 });

const QUAD = Math.PI / 2;
const byLevel = (L: number) => meta.elements.filter((e) => e.level === L);

// (1)/(3) Focus N is cell 0 of quadrant 1 → bottom-left corner (v=0).
const focus = meta.elements.find((e) => e.id === "n0");
ok(!!focus && focus.level === 1, "focus is a level-1 node element");
approx(focus!.v0, 0, 1e-9, "focus starts at v=0");
approx(focus!.u0, meta.cell, 1e-9, "focus on the first radial row (uBase = cell)");

// (2)/(3) Quadrant assignment: ① notes [0,π/2), ② N's cluster [π/2,π),
// ③ other clusters [π,3π/2), ④ transition [3π/2,2π).
ok(byLevel(1).every((e) => e.kind === "node" && e.v0 >= 0 && e.v1 <= QUAD + 1e-9), "① notes in [0,π/2)");
ok(byLevel(2).every((e) => e.kind === "cluster" && e.v0 >= QUAD - 1e-9 && e.v1 <= 2 * QUAD + 1e-9), "② N-cluster in [π/2,π)");
ok(byLevel(3).every((e) => e.v0 >= 2 * QUAD - 1e-9 && e.v1 <= 3 * QUAD + 1e-9), "③ other clusters in [π,3π/2)");

// ② is N's own cluster "A" (readable label via clusterLabels), ③ contains "B".
ok(byLevel(2).some((e) => e.id === "A" && e.label === "Alpha"), "② = N's cluster A, labelled Alpha");
ok(byLevel(3).some((e) => e.id === "B" && e.label === "Beta"), "③ contains other cluster B (Beta)");

// (4) ④ transition: a single bridge cell echoing N in [3π/2,2π).
const loop = byLevel(4);
ok(loop.length === 1, "④ has one transition bridge cell");
ok(loop[0].v0 >= 3 * QUAD - 1e-9 && loop[0].v1 <= 4 * QUAD + 1e-9, "④ in [3π/2,2π)");
ok(loop[0].label.includes("n0"), "④ bridge echoes the focus N");

// Approach B invariant (spec §2.1): every tile is a SQUARE in ζ-space.
const sq = assertCellsSquare(meta);
approx(sq.maxAspectGap, 0, 1e-12, "all cells square in ζ (Δu = Δv)");
ok(sq.allWithinPeriod, "all cells within one period");

// Overflow folds into a +N cell so element count stays bounded (cols*rows cap).
{
	const big: GraphData = {
		nodes: Array.from({ length: 500 }, (_, i) => ({ id: "x" + i, label: "x" + i, memberships: ["A"] })),
		edges: [],
	};
	const m2 = layoutDroste(big, { focusId: "x0", cols: 8, rows: 3 });
	ok(m2.elements.filter((e) => e.level === 1).length <= 8 * 3, "level 1 capped at cols*rows");
	ok(m2.elements.some((e) => e.label.startsWith("+")), "overflow folded into a +N cell");
}
