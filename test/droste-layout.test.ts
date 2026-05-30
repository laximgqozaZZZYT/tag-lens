import { approx, ok } from "./assert";
import { layoutDroste, assertCellsSquare } from "../src/droste-layout";
import type { GraphData } from "../src/types";

// Fixture: n0,n1 in cluster A; n2,n3 in B; B also co-occurs nothing else.
const data: GraphData = {
	nodes: [
		{ id: "n0", label: "n0", memberships: ["A"] },
		{ id: "n1", label: "n1", memberships: ["A"] },
		{ id: "n2", label: "n2", memberships: ["B"] },
		{ id: "n3", label: "n3", memberships: ["B"] },
	],
	edges: [],
};
const labels = new Map([["A", "Alpha"], ["B", "Beta"]]);
const meta = layoutDroste(data, { focusId: "n0", labels, cols: 8, depth: 2 });

const QUAD = Math.PI / 2;
const uBase = meta.cell;
// A "ring" = all cells sharing a u0 (one hierarchy slice).
const ring = (s: number) => meta.elements.filter((e) => Math.abs(e.u0 - (uBase + s * meta.cell)) < 1e-9);
const q = (els: typeof meta.elements, lvl: number) => els.filter((e) => e.level === lvl);

// Ring 0: node focus N. ① notes (N at v=0), ② N's cluster A, ③ other clusters.
const r0 = ring(0);
const r0focus = q(r0, 1).find((e) => e.id === "n0");
ok(!!r0focus, "ring0 ① contains focus node n0");
approx(r0focus!.v0, 0, 1e-9, "focus N at v=0 (bottom-left)");
ok(q(r0, 1).every((e) => e.kind === "node" && e.v1 <= QUAD + 1e-9), "ring0 ① = notes in [0,π/2)");
ok(q(r0, 2).some((e) => e.id === "A" && e.label === "Alpha"), "ring0 ② = N's cluster A (Alpha) in [π/2,π)");
ok(q(r0, 2).every((e) => e.v0 >= QUAD - 1e-9 && e.v1 <= 2 * QUAD + 1e-9), "ring0 ② in [π/2,π)");
ok(q(r0, 3).some((e) => e.id === "B") && q(r0, 3).every((e) => e.v0 >= 2 * QUAD - 1e-9), "ring0 ③ = other clusters in [π,3π/2)");
ok(q(r0, 4).length === 1, "ring0 ④ transition bridge present");

// Ring 1: RE-ROOTED on cluster B (the other cluster from ring0's ③).
const r1 = ring(1);
ok(r1.length > 0, "ring1 exists (recursive descent)");
ok(q(r1, 2).some((e) => e.id === "B" && e.label === "Beta"), "ring1 ② = re-rooted cluster B (Beta)");
ok(
	q(r1, 1).every((e) => e.kind === "node") && q(r1, 1).some((e) => e.id === "n2" || e.id === "n3"),
	"ring1 ① = cluster B's member notes",
);

// Approach B invariant (spec §2.1): all tiles square in ζ-space, within [0,2π).
const sq = assertCellsSquare(meta);
approx(sq.maxAspectGap, 0, 1e-12, "all cells square in ζ (Δu = Δv)");
ok(sq.allWithinPeriod, "all cells within one period");

// Each ring sits at its own radial row (recursion stacked in u).
ok(
	new Set(meta.elements.map((e) => Math.round((e.u0 - uBase) / meta.cell))).size === 2,
	"depth=2 → exactly two radial rings",
);

// Overflow in a quadrant folds into a +N cell (bounded element count).
{
	const big: GraphData = {
		nodes: Array.from({ length: 200 }, (_, i) => ({ id: "x" + i, label: "x" + i, memberships: ["A"] })),
		edges: [],
	};
	const m2 = layoutDroste(big, { focusId: "x0", cols: 8, depth: 1 });
	// Quadrant ① of m2 holds at most `cols` cells (one row) regardless of 200 notes.
	const m2q1 = m2.elements.filter((e) => e.level === 1);
	ok(m2q1.length <= 8, "ring ① capped at cols per quadrant");
	ok(m2.elements.some((e) => e.label.startsWith("+")), "overflow folded into a +N cell");
}
