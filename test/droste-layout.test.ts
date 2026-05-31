import { approx, ok } from "./assert";
import { layoutDroste, drosteRoles, drosteUV, drosteInvSource } from "../src/droste-layout";
import type { GraphData } from "../src/types";

// Fixture for the T-based containment order. N = n0 with tags {A,B} ⇒ T={A,B}.
//   exact-T (==T): n0, n1            ② (n2 has only {A} ⇒ partial, excluded)
//   proper subsets of T present: {A} (n2,n4), {B} (n3)   ④, ordered |sig| desc then count
const data: GraphData = {
	nodes: [
		{ id: "n0", label: "n0", memberships: ["A", "B"] },
		{ id: "n1", label: "n1", memberships: ["A", "B"] },
		{ id: "n2", label: "n2", memberships: ["A"] },
		{ id: "n3", label: "n3", memberships: ["B"] },
		{ id: "n4", label: "n4", memberships: ["A"] },
		{ id: "z", label: "z", memberships: ["A", "B", "C"] }, // superset of T → NOT subset, excluded from ④
	],
	edges: [],
};
const labels = new Map([["A", "Alpha"], ["B", "Beta"], ["C", "Gamma"]]);
const meta = layoutDroste(data, { focusId: "n0", labels, cols: 8 });
const roles = drosteRoles(meta);
const r = (n: number) => roles.find((x) => x.role === n)!;

// ① N alone, and it is the first shape (v=0 end of the source plane).
ok(r(1).ids.length === 1 && r(1).ids[0] === "n0", "① = focus N (n0)");
ok(meta.shapes[0].id === "n0" && meta.shapes[0].x0 === 0, "N is the first source cell (x=0 ⇒ v=0)");

// ② exact-T nodes only: n1 (n0 is ①). n2/n3 (partial) and z (superset) excluded.
ok(r(2).ids.includes("n1"), "② includes exact-T node n1");
ok(!r(2).ids.includes("n2") && !r(2).ids.includes("n3"), "② excludes partial-match n2/n3");
ok(!r(2).ids.includes("z"), "② excludes superset z");

// ③ the single T-enclosure frame, labelled with T's tags.
ok(r(3).ids.length === 1 && r(3).ids[0] === "__T", "③ = one T-enclosure frame");
ok(r(3).labels[0] === "Alpha ∩ Beta", "③ frame labelled with T's tags");

// ④ proper-subset signatures present in data: {A} and {B} (both size 1 here),
// ordered |sig| desc then count desc → {A}(count 2) before {B}(count 1). z excluded.
ok(r(4).ids.includes("__sub_A") && r(4).ids.includes("__sub_B"), "④ = subset enclosures {A},{B}");
ok(r(4).ids.indexOf("__sub_A") < r(4).ids.indexOf("__sub_B"), "④ {A}(count2) before {B}(count1)");
ok(!r(4).ids.some((id) => id.includes("C")), "④ excludes superset {A,B,C}");

// Unrelated notes (z={A,B,C} ⊋ T={A,B}) are NOT drawn — only ①②③④ appear.
ok(!roles.some((r2) => r2.ids.includes("z")), "unrelated superset z is not in any role");

// Wrap round-trip: source(x,y) → (u,v) → source ≈ identity.
{
	const x = 150, y = 12;
	const { u, v } = drosteUV(meta.bbox, x, y);
	const back = drosteInvSource(meta.bbox, u, v);
	approx(back.x, x, 1e-9, "drosteUV/InvSource round-trip x");
	approx(back.y, y, 1e-9, "drosteUV/InvSource round-trip y");
}

// Re-root: clicking a node rebuilds with a new focus ⇒ a new T-plane.
{
	const m2 = layoutDroste(data, { focusId: "n2", labels, cols: 8 }); // T={A}
	ok(m2.shapes[0].id === "n2", "re-root → n2 is the new N at v=0");
	const r2 = drosteRoles(m2);
	// exact-{A}: n2,n4. subset of {A}: none proper (∅ not present) ⇒ ④ may be empty.
	ok(r2.find((x) => x.role === 2)!.ids.includes("n4"), "re-rooted ② = exact-{A} node n4");
}

// Empty vault → empty plane, no crash.
ok(layoutDroste({ nodes: [], edges: [] }).shapes.length === 0, "empty vault → 0 shapes");
