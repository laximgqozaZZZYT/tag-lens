import { approx, ok } from "./assert";
import { layoutDroste, assertCellsSquare, assertTurnsFilled } from "../src/droste-layout";
import type { GraphData } from "../src/types";

// Fixture: n0,n1 in A; n1 also in B; n2 in B; n3 in C.
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

const q = (lvl: number) => meta.slices[0].filter((e) => e.level === lvl);

// TRUE self-similarity: exactly ONE slice (the renderer repeats it ×k as slices[m mod 1]).
ok(meta.slices.length === 1, "exactly one slice (self-similar; no per-turn re-root)");

const s = meta.slices[0];
// Band order preserved: ① → ② → ③ → ④ (level non-decreasing along v).
const sorted = [...s].sort((a, b) => a.v0 - b.v0);
ok(sorted.every((e, i) => i === 0 || e.level >= sorted[i - 1].level), "bands in role order ①②③④");

// ① focus N is the first cell ⇒ v=0; notes only.
ok(sorted[0].id === "n0" && sorted[0].level === 1, "first cell = focus N (level 1)");
approx(sorted[0].v0, 0, 1e-9, "N at v=0");
ok(q(1).every((e) => e.kind === "node"), "① = notes only");

// ② = N's cluster A (readable label); ③ = the OTHER clusters (B and C, no re-root).
ok(q(2).some((e) => e.id === "A" && e.label === "Alpha"), "② = N's cluster A (Alpha)");
ok(q(3).some((e) => e.id === "B") && q(3).some((e) => e.id === "C"), "③ = other clusters B and C");
ok(q(3).every((e) => e.id !== "A"), "③ excludes N's own cluster");

// ④ = a single self-referential bridge back to N (not a different next focus).
ok(q(4).length === 1 && q(4)[0].label.includes("n0"), "④ = ↻ N self-reference");

// Square cells + gap-free fill of the ring (so each ×k nested copy is the whole).
const sq = assertCellsSquare(meta);
approx(sq.maxAspectGap, 0, 1e-12, "all cells square in ζ (Δu = Δv)");
ok(sq.allWithinPeriod, "all cells within [0,2π)");
approx(assertTurnsFilled(meta).maxGap, 0, 1e-9, "slice fills [0,2π) contiguously");

// Re-rooting is a rebuild with a new focusId → a NEW single self-similar slice.
const meta2 = layoutDroste(data, { focusId: "n2", labels, cols: 8 });
ok(meta2.slices.length === 1, "re-root → still one slice");
ok(meta2.slices[0].sort((a, b) => a.v0 - b.v0)[0].id === "n2", "re-rooted N = n2 at v=0");

// Empty vault → no slices, no crash.
ok(layoutDroste({ nodes: [], edges: [] }).slices.length === 0, "empty vault → 0 slices");

// ③ overflow folds into "+N" so the outer turn isn't dominated by all clusters.
{
	const many: GraphData = {
		nodes: [
			{ id: "f", label: "f", memberships: ["F"] },
			...Array.from({ length: 30 }, (_, i) => ({ id: "t" + i, label: "t" + i, memberships: ["T" + i] })),
		],
		edges: [],
	};
	const m3 = layoutDroste(many, { focusId: "f", cols: 8 });
	ok(m3.slices[0].filter((e) => e.level === 3).length <= 8, "③ capped at cols (not all clusters)");
	ok(m3.slices[0].some((e) => e.label.startsWith("+")), "③ overflow folded into +N");
}
