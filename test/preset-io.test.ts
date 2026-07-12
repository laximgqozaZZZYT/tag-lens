// F1-1 — pure preset (de)serialization. Round-trip fidelity + tolerant parsing.
import { ok } from "./assert";
import { serializePresets, parsePresets, presetFileName, mergePresets, buildViewStateBundle, formatJsonStatusLines, jsonExportLabel, JSON_STATUS_ERROR_CAP, PRESET_SCHEMA, PRESET_SCHEMA_VERSION } from "../src/interaction/preset-io";
import { captureLens } from "../src/interaction/lens-presets";
import { DEFAULT_SETTINGS } from "../src/types";
import type { GraphNode, LensPreset } from "../src/types";

const sample: LensPreset[] = [
	{ name: "Alpha", query: { ...captureLens(DEFAULT_SETTINGS), viewMode: "lattice", selectedBases: ["a"] } },
	{ name: "Beta", query: { ...captureLens(DEFAULT_SETTINGS), viewMode: "heatmap" } },
];

// serialize → parse round-trips losslessly.
{
	const json = serializePresets(sample);
	const obj = JSON.parse(json);
	ok(obj.schema === PRESET_SCHEMA, "schema tag present");
	ok(obj.version === PRESET_SCHEMA_VERSION, "version present");
	const { presets, errors } = parsePresets(json);
	ok(errors.length === 0, "no errors on clean round-trip (got " + JSON.stringify(errors) + ")");
	ok(presets.length === 2, "both presets recovered");
	ok(presets[0].name === "Alpha" && presets[0].query.viewMode === "lattice", "Alpha round-trips");
	ok(presets[1].query.viewMode === "heatmap", "Beta round-trips");
	ok(presets[0].query.selectedBases.length === 1 && presets[0].query.selectedBases[0] === "a", "array field round-trips");
}

// Accepts a bare array (no bundle wrapper).
{
	const { presets, errors } = parsePresets(JSON.stringify(sample));
	ok(errors.length === 0 && presets.length === 2, "bare array accepted");
}

// Never throws on invalid JSON — returns an error instead.
{
	const { presets, errors } = parsePresets("{ not json ]");
	ok(presets.length === 0, "no presets from garbage");
	ok(errors.length === 1 && errors[0].startsWith("Invalid JSON"), "reports invalid JSON");
}

// Skips bad presets, keeps good ones, reports each problem.
{
	const mixed = JSON.stringify({
		schema: PRESET_SCHEMA,
		version: 1,
		presets: [
			{ name: "Good", query: { ...captureLens(DEFAULT_SETTINGS) } },
			{ name: "", query: { ...captureLens(DEFAULT_SETTINGS) } }, // empty name
			{ query: { ...captureLens(DEFAULT_SETTINGS) } },           // no name
			{ name: "NoQuery" },                                       // no query
			{ name: "BadArr", query: { ...captureLens(DEFAULT_SETTINGS), selectedBases: "x" } }, // where not array
			"nope",                                                    // not an object
		],
	});
	const { presets, errors } = parsePresets(mixed);
	ok(presets.length === 1 && presets[0].name === "Good", "only the valid preset kept");
	ok(errors.length === 5, "five problems reported (got " + errors.length + ")");
}

// Unknown schema is flagged but presets still parse (tolerant).
{
	const json = JSON.stringify({ schema: "other/thing", version: 9, presets: sample });
	const { presets, errors } = parsePresets(json);
	ok(presets.length === 2, "presets recovered despite schema mismatch");
	ok(errors.some((e) => e.includes("Unexpected schema")), "schema mismatch flagged");
}

// Non-bundle, non-array object is rejected cleanly.
{
	const { presets, errors } = parsePresets(JSON.stringify({ foo: 1 }));
	ok(presets.length === 0 && errors.length === 1, "plain object rejected");
}

// mergePresets: same-name overwrite, new names appended, inputs untouched.
{
	const existing: LensPreset[] = [
		{ name: "A", query: { ...captureLens(DEFAULT_SETTINGS), viewMode: "euler" } },
		{ name: "B", query: { ...captureLens(DEFAULT_SETTINGS), viewMode: "heatmap" } },
	];
	const incoming: LensPreset[] = [
		{ name: "B", query: { ...captureLens(DEFAULT_SETTINGS), viewMode: "heatmap" } }, // overwrite
		{ name: "C", query: { ...captureLens(DEFAULT_SETTINGS), viewMode: "lattice" } }, // new
	];
	const merged = mergePresets(existing, incoming);
	ok(merged.length === 3, "A kept, B overwritten, C added (got " + merged.length + ")");
	ok(merged.find((p) => p.name === "B")!.query.viewMode === "heatmap", "B overwritten by incoming");
	ok(merged.find((p) => p.name === "A")!.query.viewMode === "euler", "A untouched");
	ok(existing.length === 2, "existing input not mutated");
}

// presetFileName: stable padded stamp + .json extension.
{
	const name = presetFileName(new Date(2026, 0, 5, 9, 8, 7)); // 2026-01-05 09:08:07
	ok(name === "tag-lens-presets-20260105-090807.json", "padded filename (got " + name + ")");
	ok(name.endsWith(".json"), "json extension (not .png)");
}

// Forward-compat: an `encoding` array on a preset is carried through.
{
	const withEnc = JSON.stringify({
		presets: [{ name: "Enc", query: { ...captureLens(DEFAULT_SETTINGS) }, encoding: [{ channelId: "color" }] }],
	});
	const { presets, errors } = parsePresets(withEnc);
	ok(errors.length === 0 && presets.length === 1, "encoding-bearing preset parses");
	ok(Array.isArray((presets[0] as { encoding?: unknown[] }).encoding), "encoding array preserved");
}

// buildViewStateBundle: schema/version wrapping, node-stripping, preset split.
{
	const nodes: GraphNode[] = [
		{ id: "a", label: "A", memberships: ["t"], mtime: 123, ageDays: 4, score: 2 },
		{ id: "b", label: "B", memberships: ["t"] },
	];
	const settings = { ...DEFAULT_SETTINGS, lensPresets: sample };
	const bundle = buildViewStateBundle(nodes, settings);
	ok(bundle.schema === PRESET_SCHEMA, "schema tag present");
	ok(bundle.version === PRESET_SCHEMA_VERSION, "version present");
	ok(bundle.presets === sample, "lensPresets split out as presets");
	ok(!("lensPresets" in bundle.settings), "lensPresets removed from settings");
	ok(bundle.nodes.length === 2, "all nodes carried");
	ok(!("mtime" in bundle.nodes[0]) && !("ageDays" in bundle.nodes[0]), "volatile node fields stripped");
	ok(bundle.nodes[0].score === 2 && bundle.nodes[0].id === "a", "other node fields kept");
	// Inputs untouched (shallow copies).
	ok(nodes[0].mtime === 123 && nodes[0].ageDays === 4, "input node not mutated");
	ok("lensPresets" in settings, "input settings not mutated");
}

// formatJsonStatusLines: bullet-prefix up to the cap, overflow → "…and N more.".
{
	// Empty → no lines, no overflow.
	const none = formatJsonStatusLines([]);
	ok(none.errorLines.length === 0 && none.moreText === null, "empty errors → no lines/more");

	// Under cap → every error bulleted, no "more".
	const few = formatJsonStatusLines(["bad name", "missing query"]);
	ok(few.errorLines.length === 2 && few.moreText === null, "under-cap → all bulleted, no more");
	ok(few.errorLines[0] === "• bad name", "errors are bullet-prefixed");

	// Exactly cap → all shown, no overflow line.
	const exact = formatJsonStatusLines(Array.from({ length: JSON_STATUS_ERROR_CAP }, (_, i) => `e${i}`));
	ok(exact.errorLines.length === JSON_STATUS_ERROR_CAP && exact.moreText === null, "exactly cap → no more line");

	// Over cap → capped lines + "…and N more.".
	const over = formatJsonStatusLines(Array.from({ length: JSON_STATUS_ERROR_CAP + 3 }, (_, i) => `e${i}`));
	ok(over.errorLines.length === JSON_STATUS_ERROR_CAP, "over-cap → lines capped at cap");
	ok(over.moreText === "…and 3 more.", "overflow summarized");

	// Custom cap honoured; input array not mutated.
	const src = ["a", "b", "c"];
	const custom = formatJsonStatusLines(src, 1);
	ok(custom.errorLines.length === 1 && custom.moreText === "…and 2 more.", "custom cap honoured");
	ok(src.length === 3, "input array not mutated");
}

// jsonExportLabel: pluralized "Export View State (N nodes, M presets)" caption.
{
	// Plural both sides.
	ok(jsonExportLabel(3, 2) === "Export View State (3 nodes, 2 presets)", "both plural");
	// Singular both sides (1 → no trailing s).
	ok(jsonExportLabel(1, 1) === "Export View State (1 node, 1 preset)", "both singular");
	// Zero pluralizes ("0 nodes"), mixed singular/plural.
	ok(jsonExportLabel(0, 1) === "Export View State (0 nodes, 1 preset)", "zero plural, mixed");
}
