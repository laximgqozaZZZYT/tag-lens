// pluralize(count, singular) — the regular-`s` count-noun label shared by the
// Data ▸ JSON tab (view.ts) and the mode-legend suffix (mode-legend-input.ts).
import { ok } from "./assert";
import { pluralize } from "../src/util/pluralize";

// Exactly one → no trailing `s`; everything else → plural.
{
	ok(pluralize(1, "node") === "1 node", "1 is singular");
	ok(pluralize(0, "node") === "0 nodes", "0 is plural");
	ok(pluralize(2, "node") === "2 nodes", "2 is plural");
	ok(pluralize(42, "preset") === "42 presets", "large count plural");
}

// The multi-word noun used by the bundled-import message pluralizes on the tail.
{
	ok(pluralize(1, "bundled preset") === "1 bundled preset", "multi-word singular");
	ok(pluralize(3, "bundled preset") === "3 bundled presets", "multi-word plural");
}
