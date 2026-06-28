// "Inherit from" <select> option list (extracted from settings-tabs.ts
// renderSetLayerTab / renderLayerTab). Locks the leading "(none)" option, the
// per-cluster options, the single-selection rule, and the self-exclusion that
// distinguishes the per-cluster tab from the set-layer tab.
import { ok } from "./assert";
import { inheritFromOptions } from "../src/panel/inherit-from-options";

const clusters = [
	{ groupKey: "a", label: "Alpha" },
	{ groupKey: "b", label: "Beta" },
	{ groupKey: "c", label: "Gamma" },
];

// Set-layer tab: no exclusion, nothing selected → "(none)" selected.
{
	const opts = inheritFromOptions(clusters, "");
	ok(opts.length === 4, "(none) + 3 clusters");
	ok(opts[0].value === "" && opts[0].text === "(none)", "leading (none) option");
	ok(opts[0].selected, "(none) selected when current empty");
	ok(opts.slice(1).every((o) => !o.selected), "no cluster selected when current empty");
	ok(
		opts.slice(1).map((o) => o.value).join(",") === "a,b,c",
		"cluster options in source order",
	);
	ok(opts.slice(1).map((o) => o.text).join(",") === "Alpha,Beta,Gamma", "labels carried");
}

// A real current value selects exactly that cluster, not "(none)".
{
	const opts = inheritFromOptions(clusters, "b");
	ok(!opts[0].selected, "(none) not selected when a cluster is current");
	const selected = opts.filter((o) => o.selected);
	ok(selected.length === 1 && selected[0].value === "b", "exactly the current cluster selected");
}

// Per-cluster tab: excludeKey drops the cluster itself (a layer can't inherit
// from itself).
{
	const opts = inheritFromOptions(clusters, "", "b");
	ok(opts.length === 3, "(none) + 2 remaining clusters");
	ok(opts.every((o) => o.value !== "b"), "self excluded");
	ok(
		opts.slice(1).map((o) => o.value).join(",") === "a,c",
		"remaining clusters keep order",
	);
}

// excludeKey not present in the list leaves every cluster.
{
	const opts = inheritFromOptions(clusters, "", "missing");
	ok(opts.length === 4, "no-op exclusion keeps all clusters");
}
