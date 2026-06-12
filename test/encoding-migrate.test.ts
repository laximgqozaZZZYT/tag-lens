// Legacy migration: status overlay -> color binding, fallback resolution, and a
// migrate->evaluate integration proving the legacy statusColors are reproduced.
import { ok } from "./assert";
import { synthesizeEncodingFromLegacy, effectiveEncoding } from "../src/encoding/migrate";
import { evaluateEncoding } from "../src/encoding/evaluate";
import type { EncNode, EncContext } from "../src/encoding/types";

// no statusField -> nothing synthesized
ok(synthesizeEncodingFromLegacy({ statusField: "" }).length === 0, "empty statusField -> no binding");
ok(synthesizeEncodingFromLegacy({}).length === 0, "absent statusField -> no binding");

// statusField set -> one categorical colour binding carrying the palette
{
	const enc = synthesizeEncodingFromLegacy({ statusField: "status", statusColors: { done: "#0f0" } });
	ok(enc.length === 1, "one binding synthesized");
	const b = enc[0];
	ok(b.channelId === "color" && b.fieldId === "status" && b.enabled, "color <- status, enabled");
	ok(b.scale.type === "categorical" && b.scale.palette.done === "#0f0", "palette carried through");
}

// the synthesized palette is a copy (mutating it must not touch source settings)
{
	const src = { done: "#0f0" };
	const enc = synthesizeEncodingFromLegacy({ statusField: "status", statusColors: src });
	enc[0].scale.palette.done = "#fff";
	ok(src.done === "#0f0", "source statusColors not mutated via synthesized palette");
}

// effectiveEncoding: explicit user encoding wins; empty/undefined -> synthesize
{
	const explicit = [{ channelId: "color", fieldId: "ageDays", enabled: true }];
	ok(effectiveEncoding(explicit, { statusField: "status" })[0].fieldId === "ageDays", "explicit encoding wins");
	ok(effectiveEncoding([], { statusField: "status" })[0].fieldId === "status", "empty -> legacy fallback");
	ok(effectiveEncoding(undefined, {}).length === 0, "undefined + no legacy -> empty");
}

// integration: migrate -> evaluate reproduces the exact legacy status colour
{
	const ctx: EncContext = { nowMs: 0 };
	const nodes: EncNode[] = [
		{ id: "a", memberships: [], fmStatus: "done" },
		{ id: "b", memberships: [], fmStatus: "wip" },
	];
	const enc = synthesizeEncodingFromLegacy({ statusField: "status", statusColors: { done: "#abcdef" } });
	const r = evaluateEncoding(nodes, enc, ctx);
	ok(r.params.get("a").fillColor === "#abcdef", "legacy palette colour reproduced for mapped value");
	ok(typeof r.params.get("b").fillColor === "string" && r.params.get("b").fillColor !== "#abcdef", "unmapped value auto-coloured");
}
