// setLayerDeps — the pure deps-builder extracted from view.ts resolveSetLayer.
// Locks: single-tag cluster keys become the set-layer's supersets; `full` drops
// the layer's OWN override so it resolves purely via inheritFrom→superset→global;
// non-`full` keeps its own overrides; and the input deps are never mutated.
import { ok } from "./assert";
import {
	setLayerDeps,
	resolveFromCluster,
	INTERSECTION_LAYER_KEY,
	type NodeDisplayDeps,
} from "../src/visual/node-display";

const K = INTERSECTION_LAYER_KEY;

function baseDeps(): NodeDisplayDeps {
	return {
		overrides: {
			[K]: { nodeRows: 3, nodeCols: 3 }, // the set-layer's OWN override
			"#a": { nodeCols: 5 }, // a real single-tag cluster (superset)
		},
		inheritFrom: {},
		supersetsOf: new Map([["#other", ["#pre-existing"]]]),
		defaults: { nodeRows: 1, nodeCols: 1 },
	};
}

{
	// The cluster keys are attached as the set-layer's supersets, alongside the
	// pre-existing entries (which must be preserved).
	const out = setLayerDeps(baseDeps(), K, ["#a", "#b"], false);
	ok(out.supersetsOf.get(K)?.join(",") === "#a,#b", "cluster keys become setKey's supersets");
	ok(out.supersetsOf.get("#other")?.join(",") === "#pre-existing", "pre-existing supersets preserved");
}

{
	// Non-full: the layer keeps its OWN override, so resolution reads 3×3.
	const partial = setLayerDeps(baseDeps(), K, ["#a"], false);
	const d = resolveFromCluster(K, partial);
	ok(d.nodeRows === 3 && d.nodeCols === 3, "non-full keeps the layer's own override");
}

{
	// Full: the layer's own override is dropped, so resolution cascades to the
	// superset cluster (#a: nodeCols 5) for cols and to the global default for rows.
	const full = setLayerDeps(baseDeps(), K, ["#a"], true);
	ok(full.overrides[K] === undefined, "full drops the layer's own override");
	ok(full.overrides["#a"]?.nodeCols === 5, "other overrides survive the full drop");
	const d = resolveFromCluster(K, full);
	ok(d.nodeCols === 5, "full cascades cols to the superset cluster override");
	ok(d.nodeRows === 1, "full cascades rows to the global default");
}

{
	// Non-mutation: the input deps' maps/records are untouched.
	const base = baseDeps();
	setLayerDeps(base, K, ["#a", "#b"], true);
	ok(!base.supersetsOf.has(K), "input supersetsOf map not mutated");
	ok(base.overrides[K]?.nodeRows === 3, "input overrides record not mutated");
}
