import { approx, ok } from "./assert";
import { layoutDroste, assertCellsSquare, assertTurnsFilled } from "../src/droste-layout";
import type { GraphData } from "../src/types";

// Fixture: n0,n1 in A; n1 also in B (A,B co-occur via n1); n2 in B; n3 in C (isolated).
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

const TWO_PI = 2 * Math.PI;

// Recursion in TURNS: slices[0] = node N, slices[1+] = cluster re-roots.
ok(meta.slices.length >= 2, "≥2 hierarchy slices (focus chain descends)");

// (B) Within turn 0, the band ORDER is preserved: level non-decreasing along v.
const s0 = [...meta.slices[0]].sort((a, b) => a.v0 - b.v0);
ok(s0.every((e, i) => i === 0 || e.level >= s0[i - 1].level), "turn0 bands in role order ①②③④");

// Focus N is the FIRST cell ⇒ v=0 (bottom-left), kind node, level 1.
ok(s0[0].id === "n0" && s0[0].level === 1, "first cell is focus N (level 1)");
approx(s0[0].v0, 0, 1e-9, "N at v=0");

// Roles present in order: ② = A (Alpha), ③ co-occurring sibling B before isolated C.
ok(s0.some((e) => e.level === 2 && e.id === "A" && e.label === "Alpha"), "② = N's cluster A (Alpha)");
const threes = s0.filter((e) => e.level === 3);
ok(threes.some((e) => e.id === "B"), "③ includes co-occurring sibling B");
ok(threes.findIndex((e) => e.id === "B") <= threes.findIndex((e) => e.id === "C") || !threes.some((e) => e.id === "C"),
	"(A) co-occurring siblings ordered before fallback others");

// Turn 1 re-roots on sibling cluster B.
const s1 = meta.slices[1];
ok(s1.some((e) => e.level === 2 && e.id === "B"), "turn1 ② = re-rooted cluster B");
ok(s1.some((e) => e.level === 1 && (e.id === "n1" || e.id === "n2")), "turn1 ① = B's member notes");

// ④ bridge present per turn; last turn wraps back to N.
ok(meta.slices.every((s) => s.filter((e) => e.level === 4).length === 1), "one ④ bridge per turn");
const last = meta.slices[meta.slices.length - 1];
ok(last.find((e) => e.level === 4)!.label.includes("n0"), "last turn's ④ wraps to N");

// (B) Square cells AND contiguous fill of the full ring (no gaps).
const sq = assertCellsSquare(meta);
approx(sq.maxAspectGap, 0, 1e-12, "all cells square in ζ (Δu = Δv = Δ_m)");
ok(sq.allWithinPeriod, "all cells within [0,2π)");
const fill = assertTurnsFilled(meta);
approx(fill.maxGap, 0, 1e-9, "each turn fills [0,2π) contiguously (no empty arc)");

// Empty vault → no slices, no crash.
ok(layoutDroste({ nodes: [], edges: [] }).slices.length === 0, "empty vault → 0 slices");

// (A) fallback: a focus whose cluster has NO co-occurring sibling still gets ③
// (other clusters) so the chain doesn't dead-end at length 1.
{
	const iso: GraphData = {
		nodes: [
			{ id: "a", label: "a", memberships: ["X"] },
			{ id: "b", label: "b", memberships: ["Y"] },
		],
		edges: [],
	};
	const m2 = layoutDroste(iso, { focusId: "a" });
	ok(m2.slices.length >= 2, "(A) fallback: chain descends past length 1 even with no co-occurrence");
	ok(m2.slices[0].some((e) => e.level === 3 && e.id === "Y"), "(A) ③ falls back to other cluster Y");
}
