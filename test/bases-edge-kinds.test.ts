// Bases "Show Edges" checklist descriptors (extracted from settings-tabs.ts
// renderBasesDisplaySection). Locks the key↔label mapping + order so the rendered
// checklist and the settings keys it binds stay in lockstep.
import { ok } from "./assert";
import { basesEdgeKinds } from "../src/panel/bases-edge-kinds";
import { DEFAULT_SETTINGS } from "../src/types";

{
	const kinds = basesEdgeKinds();
	ok(kinds.length === 3, "three edge kinds");

	const keys = kinds.map((k) => k.key);
	ok(
		keys.join(",") === "basesLinkEdges,basesSharedTagEdges,basesSharedPropEdges",
		`keys in rendered order (${keys.join(",")})`,
	);

	const labels = kinds.map((k) => k.label);
	ok(
		labels.join("|") === "Internal links|Shared tags|Shared property",
		`labels in rendered order (${labels.join("|")})`,
	);

	// Every key is a real boolean settings field (binds to DEFAULT_SETTINGS).
	for (const { key } of kinds) {
		ok(typeof DEFAULT_SETTINGS[key] === "boolean", `${key} is a boolean settings field`);
	}
}
