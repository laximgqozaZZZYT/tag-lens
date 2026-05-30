import { approx, ok } from "./assert";
import { layoutDroste, assertCellsSquare } from "../src/droste-layout";
import type { GraphData } from "../src/types";

// Fixture: n0,n1 in A; n1 also in B (so A and B co-occur → siblings); n2 in B.
const data: GraphData = {
	nodes: [
		{ id: "n0", label: "n0", memberships: ["A"] },
		{ id: "n1", label: "n1", memberships: ["A", "B"] },
		{ id: "n2", label: "n2", memberships: ["B"] },
		{ id: "n3", label: "n3", memberships: ["C"] },
	],
	edges: [],
};
const labels = new Map([["A", "Alpha"], ["B", "Beta"], ["C", "Gamma"]]);
const meta = layoutDroste(data, { focusId: "n0", labels, cols: 8 });

const QUAD = Math.PI / 2;
const q = (els: typeof meta.slices[number], lvl: number) => els.filter((e) => e.level === lvl);

// Recursion lives in the TURNS: slices[0] = node N, slices[1+] = cluster re-roots.
ok(meta.slices.length >= 2, "≥2 hierarchy slices (focus chain descends)");

// Turn 0 (slice 0): node focus N. ① notes (N at v=0), ② A, ③ siblings of A.
const s0 = meta.slices[0];
const s0focus = q(s0, 1).find((e) => e.id === "n0");
ok(!!s0focus, "turn0 ① contains focus node n0");
approx(s0focus!.v0, 0, 1e-9, "N at v=0 (bottom-left)");
ok(q(s0, 1).every((e) => e.kind === "node" && e.v1 <= QUAD + 1e-9), "turn0 ① = notes in [0,π/2)");
ok(q(s0, 2).some((e) => e.id === "A" && e.label === "Alpha"), "turn0 ② = N's cluster A (Alpha)");
// ③ shows SIBLING clusters (B co-occurs with A via n1) — NOT every cluster (C is absent).
ok(q(s0, 3).some((e) => e.id === "B"), "turn0 ③ includes co-occurring sibling B");
ok(q(s0, 3).every((e) => e.id !== "C"), "turn0 ③ excludes non-co-occurring C (no all-clusters dump)");

// Turn 1 (slice 1): RE-ROOTED on sibling cluster B.
const s1 = meta.slices[1];
ok(q(s1, 2).some((e) => e.id === "B" && e.label === "Beta"), "turn1 ② = re-rooted cluster B");
ok(q(s1, 1).some((e) => e.id === "n1" || e.id === "n2"), "turn1 ① = B's member notes");

// (4) Each turn has exactly one ④ bridge; the LAST turn's bridge wraps to N
// (self-referential loop, termination (b)).
ok(meta.slices.every((s) => q(s, 4).length === 1), "each turn has one ④ bridge");
const last = meta.slices[meta.slices.length - 1];
ok(q(last, 4)[0].label.includes("n0"), "last turn's ④ wraps back to focus N");

// Approach B invariant: all tiles square in ζ-space (Δu = Δv), within [0,2π).
const sq = assertCellsSquare(meta);
approx(sq.maxAspectGap, 0, 1e-12, "all cells square in ζ (Δu = Δv)");
ok(sq.allWithinPeriod, "all cells within one period");

// Empty vault → no slices, no crash.
ok(layoutDroste({ nodes: [], edges: [] }).slices.length === 0, "empty vault → 0 slices (no crash)");

// Overflow folds into a +N cell so each quadrant stays bounded.
{
	const big: GraphData = {
		nodes: Array.from({ length: 200 }, (_, i) => ({ id: "x" + i, label: "x" + i, memberships: ["A"] })),
		edges: [],
	};
	const m2 = layoutDroste(big, { focusId: "x0", cols: 8 });
	ok(q(m2.slices[0], 1).length <= 8, "turn0 ① capped at cols per quadrant");
	ok(m2.slices[0].some((e) => e.label.startsWith("+")), "overflow folded into a +N cell");
}
