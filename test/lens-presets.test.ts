import { ok } from "./assert";
import { captureLens, applyLens, upsertPreset, removePreset, validatePresetName, capturePreset } from "../src/interaction/lens-presets";
import { DEFAULT_SETTINGS, MiniSettings } from "../src/types";
import type { EncodingBinding } from "../src/encoding/types";

// captureLens copies arrays deeply
{
	const s: MiniSettings = {
		...DEFAULT_SETTINGS,
		viewMode: "lattice",
		selectedBases: ["a", "b"],
	};
	const q = captureLens(s);
	
	ok(q.viewMode === "lattice", "Primitive copied");
	ok(q.selectedBases.length === 2, "Array length correct");
	ok(q.selectedBases !== s.selectedBases, "Array is a new reference");
	
	s.selectedBases.push("c");
	ok(q.selectedBases.length === 2, "Captured array unaffected by original modification");
}

// applyLens overwrites and deep copies
{
	const presetQuery = captureLens(DEFAULT_SETTINGS);
	presetQuery.selectedBases = ["x", "y"];
	presetQuery.viewMode = "lattice";

	const s: MiniSettings = { ...DEFAULT_SETTINGS, viewMode: "heatmap" };
	applyLens(s, { name: "test", query: presetQuery });

	ok(s.viewMode === "lattice", "Primitive overwritten");
	ok(s.selectedBases.length === 2 && s.selectedBases[0] === "x", "Array applied");
	ok(s.selectedBases !== presetQuery.selectedBases, "Array is a new reference");

	presetQuery.selectedBases.push("z");
	ok(s.selectedBases.length === 2, "Applied settings unaffected by preset modification");
}

// upsertPreset replaces or adds
{
	const query1 = captureLens(DEFAULT_SETTINGS);
	const presets = upsertPreset([], "Test", query1);
	
	ok(presets.length === 1, "Added preset");
	ok(presets[0].name === "Test", "Name is correct");

	const query2 = captureLens(DEFAULT_SETTINGS);
	query2.viewMode = "heatmap";
	const updated = upsertPreset(presets, "Test", query2);
	
	ok(updated.length === 1, "Replaced preset");
	ok(updated[0].query.viewMode === "heatmap", "Updated content");

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

// ── F1-2: encoding capture/apply (backward compatible) ──
const enc = (): EncodingBinding[] => [
	{ channelId: "color", fieldId: "degree", enabled: true, scale: { kind: "quantitative" } as EncodingBinding["scale"] },
];

// capturePreset bundles query + a DEEP-COPIED encoding snapshot.
{
	const s: MiniSettings = { ...DEFAULT_SETTINGS, viewMode: "lattice", encoding: enc() };
	const p = capturePreset(s, "Full");
	ok(p.name === "Full" && p.query.viewMode === "lattice", "query captured");
	ok(Array.isArray(p.encoding) && p.encoding!.length === 1, "encoding captured");
	ok(p.encoding !== s.encoding, "encoding array is a new reference");
	ok(p.encoding![0] !== s.encoding[0], "encoding binding deep-copied");
	s.encoding[0].enabled = false;
	ok(p.encoding![0].enabled === true, "captured encoding unaffected by later mutation");
}

// applyLens APPLIES encoding when the preset carries it.
{
	const s: MiniSettings = { ...DEFAULT_SETTINGS, encoding: [] };
	applyLens(s, { name: "p", query: captureLens(DEFAULT_SETTINGS), encoding: enc() });
	ok(s.encoding.length === 1 && s.encoding[0].channelId === "color", "encoding applied from preset");
}

// applyLens LEAVES encoding untouched for legacy query-only presets.
{
	const existing = enc();
	const s: MiniSettings = { ...DEFAULT_SETTINGS, encoding: existing };
	applyLens(s, { name: "legacy", query: captureLens(DEFAULT_SETTINGS) });
	ok(s.encoding === existing, "no encoding key → current encoding preserved (same reference)");
}

// upsertPreset stores a deep-copied encoding when given one; omits it otherwise.
{
	const withEnc = upsertPreset([], "E", captureLens(DEFAULT_SETTINGS), enc());
	ok(Array.isArray(withEnc[0].encoding) && withEnc[0].encoding!.length === 1, "encoding stored");
	const noEnc = upsertPreset([], "Q", captureLens(DEFAULT_SETTINGS));
	ok(noEnc[0].encoding === undefined, "no encoding key when not provided (legacy shape)");
}
