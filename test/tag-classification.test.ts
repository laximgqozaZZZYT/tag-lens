// Spec for the Suggested-Classification dropdown's initial value:
// a persisted (applied) classification must win over the heuristic suggestion,
// while absent/garbage persisted values fall back to the suggestion.
import { ok } from "./assert";
import { effectiveClassification, isGolderType } from "../src/query/tag-classification";

// persisted choice wins over the suggestion (the core bug being fixed)
ok(
	effectiveClassification("task_org", "self_ref") === "task_org",
	"effectiveClassification: a valid persisted value overrides the suggestion",
);

// no persisted value -> fall back to the heuristic suggestion
ok(
	effectiveClassification(undefined, "qualities") === "qualities",
	"effectiveClassification: undefined persisted falls back to suggestion",
);
ok(
	effectiveClassification(null, "what_it_is") === "what_it_is",
	"effectiveClassification: null persisted falls back to suggestion",
);

// unrecognised persisted value must NOT be selected (would pick a phantom option)
ok(
	effectiveClassification("bogus_type", "refined_category") === "refined_category",
	"effectiveClassification: invalid persisted falls back to suggestion",
);
ok(
	effectiveClassification("", "self_ref") === "self_ref",
	"effectiveClassification: empty-string persisted falls back to suggestion",
);

// type guard covers every canonical key and rejects others
ok(isGolderType("who_owns_it"), "isGolderType accepts a canonical key");
ok(!isGolderType("WHO_OWNS_IT"), "isGolderType is case-sensitive");
ok(!isGolderType(42), "isGolderType rejects non-strings");
