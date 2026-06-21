// Spec for the pure token-extraction + candidate-filter logic behind the
// WHERE / GROUP_BY typeahead. The DOM-bound TagFieldSuggest class is not tested
// here (no DOM); only the side-effect-free functions are.
import { ok } from "./assert";
import {
	extractEditingToken,
	computeSuggestions,
	type SuggestSources,
} from "../src/panel/tag-field-suggest";

const sources: SuggestSources = {
	tags: ["wip", "project/alpha", "wishlist", "done"],
	fields: ["status", "priority", "stage"],
};

// ── extractEditingToken ──────────────────────────────────────────────────────
{
	const t = extractEditingToken("tag:wi", 6);
	ok(t.token === "tag:wi" && t.before === "" && t.after === "", "token: whole single token");
}
{
	const t = extractEditingToken("tag:wip AND sta", 15);
	ok(t.token === "sta" && t.before === "tag:wip AND " && t.after === "", "token: after operator");
}
{
	const t = extractEditingToken("(tag:wi)", 7);
	ok(t.token === "tag:wi" && t.before === "(" && t.after === ")", "token: inside parens");
}
{
	const t = extractEditingToken("status:draft", 6);
	ok(t.token === "status" && t.after === ":draft", "token: caret mid-token splits correctly");
}

// ── computeSuggestions: field-name completion (no colon) ─────────────────────
{
	const out = computeSuggestions("st", sources);
	const labels = out.map((o) => o.display);
	ok(labels.includes("status") && labels.includes("stage"), "fields: substring matches");
	ok(out.every((o) => o.insert.endsWith(":")), "fields: insert appends colon");
}
{
	const out = computeSuggestions("", sources);
	ok(out.some((o) => o.display === "tag"), "fields: 'tag' always offered on empty token");
}
{
	// Prefix matches rank before mere substring matches.
	const out = computeSuggestions("sta", sources);
	ok(out[0].display === "stage" || out[0].display === "status", "fields: prefix ranked first");
	ok(!out.map((o) => o.display).includes("priority"), "fields: non-matching excluded");
}

// ── computeSuggestions: value completion (after tag:) ────────────────────────
{
	const out = computeSuggestions("tag:wi", sources);
	const labels = out.map((o) => o.display);
	ok(labels.includes("wip") && labels.includes("wishlist"), "values: tag value substring match");
	ok(out.find((o) => o.display === "wip")!.insert === "tag:wip", "values: insert rebuilds field:value");
}
{
	// Leading '#' on the value is preserved in the insertion.
	const out = computeSuggestions("tag:#wi", sources);
	ok(out.find((o) => o.display === "wip")!.insert === "tag:#wip", "values: preserves leading #");
}
{
	// Numbered tag field (tag2:) also completes values.
	const out = computeSuggestions("tag2:wi", sources);
	ok(out.some((o) => o.display === "wip"), "values: tagN field completes values");
}
{
	// Non-tag field after colon → no value guessing.
	const out = computeSuggestions("status:dr", sources);
	ok(out.length === 0, "values: non-tag field yields no value candidates");
}

// ── limit cap ────────────────────────────────────────────────────────────────
{
	const many: SuggestSources = { tags: Array.from({ length: 50 }, (_, i) => `t${i}`), fields: [] };
	const out = computeSuggestions("tag:t", many, 5);
	ok(out.length === 5, "limit: capped to requested size");
}
