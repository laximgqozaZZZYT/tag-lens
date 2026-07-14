// "Graph display" checklist descriptors (extracted from settings-tabs.ts
// renderSettingsDisplayTab). Locks the key↔label mapping + order so the rendered
// checklist and the settings keys it binds stay in lockstep.
import { ok } from "./assert";
import { graphDisplayToggles } from "../src/panel/graph-display-toggles";
import { DEFAULT_SETTINGS } from "../src/types";

{
	const toggles = graphDisplayToggles();
	ok(toggles.length === 4, "four graph-display toggles");

	const keys = toggles.map((t) => t.key);
	ok(
		keys.join(",") === "showNodes,showEnclosures,showEdges,showGrid",
		`keys in rendered order (${keys.join(",")})`,
	);

	const labels = toggles.map((t) => t.label);
	ok(
		labels.join("|") === "Show nodes|Show enclosures|Show edges|Show grid",
		`labels in rendered order (${labels.join("|")})`,
	);

	// Every key is a real boolean settings field (binds to DEFAULT_SETTINGS).
	for (const { key } of toggles) {
		ok(typeof DEFAULT_SETTINGS[key] === "boolean", `${key} is a boolean settings field`);
	}
}
