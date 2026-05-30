import { approx, ok } from "./assert";
import { layoutDroste, assertLayoutSeam } from "../src/droste-layout";
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

// Focus node placed at v=0 (bottom-left corner).
const focus = meta.elements.find((e) => e.id === "n0");
ok(!!focus, "focus element exists");
approx(focus!.v0, 0, 1e-9, "focus starts at v=0");

// All elements live within one period [0, 2π).
for (const e of meta.elements) {
	ok(e.v0 >= 0 && e.v1 <= 2 * Math.PI + 1e-9, `element ${e.id} within [0,2π]`);
}

// Seam continuity: centreline + width match to C0 and C1 at v=0 ≡ 2π.
const seam = assertLayoutSeam(meta);
approx(seam.c0CentreGap, 0, 1e-6, "seam C0 centreline gap");
approx(seam.c0WidthGap, 0, 1e-6, "seam C0 width gap");
approx(seam.c1CentreGap, 0, 1e-4, "seam C1 tangent gap");
