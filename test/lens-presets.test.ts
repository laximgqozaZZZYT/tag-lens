import { ok } from "./assert";
import { captureLens, applyLens, upsertPreset, removePreset, validatePresetName } from "../src/interaction/lens-presets";
import { DEFAULT_SETTINGS, MiniSettings } from "../src/types";

// captureLens copies arrays deeply
{
	const s: MiniSettings = {
		...DEFAULT_SETTINGS,
		filterMode: "sql",
		where: ["a", "b"],
		limit: ["limit 10"]
	};
	const q = captureLens(s);
	
	ok(q.filterMode === "sql", "Primitive copied");
	ok(q.where.length === 2, "Array length correct");
	ok(q.where !== s.where, "Array is a new reference");
	
	s.where.push("c");
	ok(q.where.length === 2, "Captured array unaffected by original modification");
}

// applyLens overwrites and deep copies
{
	const presetQuery = captureLens(DEFAULT_SETTINGS);
	presetQuery.where = ["x", "y"];
	presetQuery.viewMode = "lattice";

	const s: MiniSettings = { ...DEFAULT_SETTINGS, viewMode: "heatmap" };
	applyLens(s, { name: "test", query: presetQuery });

	ok(s.viewMode === "lattice", "Primitive overwritten");
	ok(s.where.length === 2 && s.where[0] === "x", "Array applied");
	ok(s.where !== presetQuery.where, "Array is a new reference");

	presetQuery.where.push("z");
	ok(s.where.length === 2, "Applied settings unaffected by preset modification");
}

// upsertPreset replaces or adds
{
	const query1 = captureLens(DEFAULT_SETTINGS);
	const presets = upsertPreset([], "Test", query1);
	
	ok(presets.length === 1, "Added preset");
	ok(presets[0].name === "Test", "Name is correct");

	const query2 = captureLens(DEFAULT_SETTINGS);
	query2.filterMode = "dvjs";
	const updated = upsertPreset(presets, "Test", query2);
	
	ok(updated.length === 1, "Replaced preset");
	ok(updated[0].query.filterMode === "dvjs", "Updated content");

	const added = upsertPreset(updated, "Another", query1);
	ok(added.length === 2, "Added another");
}

// removePreset deletes by name
{
	const q = captureLens(DEFAULT_SETTINGS);
	let p = upsertPreset([], "A", q);
	p = upsertPreset(p, "B", q);
	
	ok(p.length === 2, "Initial length 2");
	
	const removed = removePreset(p, "A");
	ok(removed.length === 1, "Removed to length 1");
	ok(removed[0].name === "B", "Correct item remains");
}

// validatePresetName blocks empty strings
{
	ok(validatePresetName("", []) !== null, "Empty is invalid");
	ok(validatePresetName("   ", []) !== null, "Whitespace is invalid");
	ok(validatePresetName("Valid", []) === null, "Normal is valid");
}
