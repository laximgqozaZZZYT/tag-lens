// Bases standalone toggle rows (extracted from settings-tabs.ts
// renderBasesDisplaySection). Locks the key↔label mapping + order so the rendered
// toggles and the settings keys they bind stay in lockstep.
import { ok } from "./assert";
import { basesToggleRows } from "../src/panel/bases-toggle-rows";
import { DEFAULT_SETTINGS } from "../src/types";

{
	const rows = basesToggleRows();
	ok(rows.length === 2, "two toggle rows");

	const keys = rows.map((r) => r.key);
	ok(
		keys.join(",") === "basesClusterByView,basesShowPrefix",
		`keys in rendered order (${keys.join(",")})`,
	);

	const labels = rows.map((r) => r.label);
	ok(
		labels.join("|") ===
			"Always cluster by view (even single-view bases)|Show base file name prefix in labels",
		`labels in rendered order (${labels.join("|")})`,
	);

	// Every key is a real boolean settings field (binds to DEFAULT_SETTINGS).
	for (const { key } of rows) {
		ok(typeof DEFAULT_SETTINGS[key] === "boolean", `${key} is a boolean settings field`);
	}
}
