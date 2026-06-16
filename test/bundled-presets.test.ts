// F1-3 — bundled starter presets: shape validity, clean round-trip, safe merge.
import { ok } from "./assert";
import { BUNDLED_PRESETS, mergeBundled } from "../src/interaction/bundled-presets";
import { serializePresets, parsePresets } from "../src/interaction/preset-io";
import type { LensPreset } from "../src/types";

// Every bundled preset is well-formed and survives serialize→parse with no errors.
{
	ok(BUNDLED_PRESETS.length >= 3, "ships at least a few presets");
	for (const p of BUNDLED_PRESETS) {
		ok(typeof p.name === "string" && p.name.trim().length > 0, `name set: ${p.name}`);
		ok(typeof p.query.viewMode === "string", `${p.name}: viewMode set`);
		ok(Array.isArray(p.query.where), `${p.name}: where is array`);
		ok(p.encoding === undefined, `${p.name}: no encoding (legacy shape, won't wipe user encoding)`);
	}
	const { presets, errors } = parsePresets(serializePresets(BUNDLED_PRESETS));
	ok(errors.length === 0, "bundled presets round-trip with no errors (" + JSON.stringify(errors) + ")");
	ok(presets.length === BUNDLED_PRESETS.length, "all bundled presets recovered");
}

// Names are unique within the bundle.
{
	const names = new Set(BUNDLED_PRESETS.map((p) => p.name));
	ok(names.size === BUNDLED_PRESETS.length, "bundled names are unique");
}

// mergeBundled appends only missing presets onto an empty list.
{
	const merged = mergeBundled([]);
	ok(merged.length === BUNDLED_PRESETS.length, "empty + bundled = all bundled");
}

// mergeBundled never overwrites a user preset with the same name, never duplicates.
{
	const mine: LensPreset[] = [{ name: "Icon Gallery", query: { ...BUNDLED_PRESETS[0].query, viewMode: "matrix" } }];
	const merged = mergeBundled(mine);
	const icon = merged.filter((p) => p.name === "Icon Gallery");
	ok(icon.length === 1, "no duplicate name");
	ok(icon[0].query.viewMode === "matrix", "user's preset preserved (not overwritten)");
	ok(merged.length === 1 + (BUNDLED_PRESETS.length - 1), "only the missing bundled presets added");
}
