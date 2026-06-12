// Evaluation pipeline: color <- status (categorical) and color <- ageDays
// (quantitative), plus the non-interference invariant (input nodes untouched,
// node set unchanged) that keeps encoding separate from the filter layer.
import { ok } from "./assert";
import { evaluateEncoding } from "../src/encoding/evaluate";
import type { EncNode, EncContext, EncodingBinding } from "../src/encoding/types";

const ctx: EncContext = { nowMs: 0, degreeOf: () => undefined, frontmatterOf: () => undefined };
function nodes(): EncNode[] {
	return [
		{ id: "a", memberships: ["x"], fmStatus: "done", ageDays: 0 },
		{ id: "b", memberships: ["y"], fmStatus: "wip", ageDays: 50 },
		{ id: "c", memberships: ["x"], ageDays: 100 }, // no status
	];
}
const bind = (channelId: string, fieldId: string, extra: Partial<EncodingBinding> = {}): EncodingBinding => ({
	channelId,
	fieldId,
	enabled: true,
	...extra,
});

// color <- status (categorical): defined where status exists, missing otherwise
{
	const r = evaluateEncoding(nodes(), [bind("color", "status")], ctx);
	ok(typeof r.params.get("a").fillColor === "string", "a gets a status colour");
	ok(typeof r.params.get("b").fillColor === "string", "b gets a status colour");
	ok(r.params.get("a").fillColor !== r.params.get("b").fillColor, "different statuses -> different colours");
	ok(r.params.get("c").fillColor === undefined, "node without status gets no colour (missing)");
	ok(r.legends.length === 1 && r.legends[0].legend.kind === "categorical", "categorical legend emitted");
}

// color <- ageDays (quantitative): every node coloured along the ramp
{
	const r = evaluateEncoding(nodes(), [bind("color", "ageDays")], ctx);
	ok(["a", "b", "c"].every((id) => typeof r.params.get(id).fillColor === "string"), "all nodes coloured by ageDays");
	ok(r.legends[0].legend.kind === "quantitative" && r.legends[0].legend.max === 100, "quantitative legend domain");
}

// INVARIANT 1: input nodes are not mutated (no extra keys, values intact)
{
	const ns = nodes();
	const beforeKeys = ns.map((n) => Object.keys(n).length);
	evaluateEncoding(ns, [bind("color", "status"), bind("color", "ageDays")], ctx);
	ok(ns[0].fmStatus === "done" && ns[1].ageDays === 50, "node field values unchanged");
	ok(ns.every((n, i) => Object.keys(n).length === beforeKeys[i]), "no new keys written onto nodes");
}

// INVARIANT 2: node set size is preserved (encoding never drops/adds nodes)
{
	const r = evaluateEncoding(nodes(), [bind("color", "ageDays")], ctx);
	ok(r.params.size === 3, "params cover exactly the input node set (no selection change)");
}

// disabled binding is skipped (no params produced)
{
	const r = evaluateEncoding(nodes(), [bind("color", "status", { enabled: false })], ctx);
	ok(r.params.size === 0 && r.legends.length === 0, "disabled binding produces nothing");
}

// unknown field / channel id is skipped gracefully
{
	const r = evaluateEncoding(nodes(), [bind("color", "frobnicate"), bind("nope", "status")], ctx);
	ok(r.params.size === 0 && r.legends.length === 0, "unknown ids skipped without throwing");
}

// dynamic frontmatter:<key> source resolves via ctx.frontmatterOf
{
	const fmCtx: EncContext = { nowMs: 0, frontmatterOf: (id) => (id === "a" ? { priority: "high" } : undefined) };
	const r = evaluateEncoding(nodes(), [bind("color", "frontmatter:priority")], fmCtx);
	ok(typeof r.params.get("a").fillColor === "string", "frontmatter:priority colours node a");
	ok(r.params.get("b").fillColor === undefined, "node lacking the frontmatter key is missing");
}
