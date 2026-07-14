// Bases "Show Edges" checklist descriptors (extracted from settings-tabs.ts
// renderBasesDisplaySection). Locks the key↔label mapping + order so the rendered
// checklist and the settings keys it binds stay in lockstep.
import { ok } from "./assert";
import { basesEdgeKinds, basesEnabledEdgeKinds } from "../src/panel/bases-edge-kinds";
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

	const edges = kinds.map((k) => k.edge);
	ok(
		edges.join(",") === "link,shared-tag,shared-property",
		`projection edge kinds in rendered order (${edges.join(",")})`,
	);

	// Every key is a real boolean settings field (binds to DEFAULT_SETTINGS).
	for (const { key } of kinds) {
		ok(typeof DEFAULT_SETTINGS[key] === "boolean", `${key} is a boolean settings field`);
	}
}

// basesEnabledEdgeKinds: derives the projection Set<BaseEdgeKind> from the same
// descriptor list — one entry per enabled boolean, none for disabled ones.
{
	const none = basesEnabledEdgeKinds({
		basesLinkEdges: false,
		basesSharedTagEdges: false,
		basesSharedPropEdges: false,
	});
	ok(none.size === 0, "all-off → empty set");

	const all = basesEnabledEdgeKinds({
		basesLinkEdges: true,
		basesSharedTagEdges: true,
		basesSharedPropEdges: true,
	});
	ok(
		all.has("link") && all.has("shared-tag") && all.has("shared-property") && all.size === 3,
		"all-on → all three projection kinds",
	);

	const some = basesEnabledEdgeKinds({
		basesLinkEdges: true,
		basesSharedTagEdges: false,
		basesSharedPropEdges: true,
	});
	ok(
		some.has("link") && !some.has("shared-tag") && some.has("shared-property") && some.size === 2,
		"per-key gating (link + shared-property only)",
	);
}
