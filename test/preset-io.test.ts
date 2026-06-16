// F1-1 — pure preset (de)serialization. Round-trip fidelity + tolerant parsing.
import { ok } from "./assert";
import { serializePresets, parsePresets, PRESET_SCHEMA, PRESET_SCHEMA_VERSION } from "../src/interaction/preset-io";
import { captureLens } from "../src/interaction/lens-presets";
import { DEFAULT_SETTINGS } from "../src/types";
import type { LensPreset } from "../src/types";

const sample: LensPreset[] = [
	{ name: "Alpha", query: { ...captureLens(DEFAULT_SETTINGS), viewMode: "lattice", where: ["a"] } },
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
	ok(presets[0].query.where.length === 1 && presets[0].query.where[0] === "a", "array field round-trips");
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
			{ name: "BadArr", query: { ...captureLens(DEFAULT_SETTINGS), where: "x" } }, // where not array
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

// Forward-compat: an `encoding` array on a preset is carried through.
{
	const withEnc = JSON.stringify({
		presets: [{ name: "Enc", query: { ...captureLens(DEFAULT_SETTINGS) }, encoding: [{ channelId: "color" }] }],
	});
	const { presets, errors } = parsePresets(withEnc);
	ok(errors.length === 0 && presets.length === 1, "encoding-bearing preset parses");
	ok(Array.isArray((presets[0] as { encoding?: unknown[] }).encoding), "encoding array preserved");
}
