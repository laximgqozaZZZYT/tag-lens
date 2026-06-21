// Spec for the pure parse/stringify + candidate-collection logic behind the
// WHERE / GROUP_BY visual builder. The DOM-bound renderer is not tested here.
import { ok } from "./assert";
import {
	parseSimpleRow,
	stringifySimpleCondition,
	buildBuilderSources,
	collectPropertyValues,
	collectPropertyValueMap,
	classifyTagPickerRow,
	classifyTagPickerRows,
	tagRowString,
	tagPickerRowLabel,
	buildPickerCandidates,
	computePickerCandidates,
	PROPERTY_VALUE_CANDIDATE_CAP,
	type SimpleCondition,
	type BuilderSources,
} from "../src/panel/query-builder";
import type { SuggestSources } from "../src/panel/tag-field-suggest";

// ── parseSimpleRow: the six simple patterns ─────────────────────────────────
{
	const c = parseSimpleRow("tag:#x");
	ok(c?.kind === "tag-has" && c.field === "tag" && c.value === "x", "parse tag:#x → tag-has");
}
{
	const c = parseSimpleRow("tag:x"); // '#' optional
	ok(c?.kind === "tag-has" && c.value === "x", "parse tag:x (no #) → tag-has");
}
{
	const c = parseSimpleRow("-tag:#x");
	ok(c?.kind === "tag-not" && c.value === "x", "parse -tag:#x → tag-not");
}
{
	const c = parseSimpleRow("tag:?");
	ok(c?.kind === "tag-any" && c.field === "tag" && c.value === "", "parse tag:? → tag-any");
}
{
	const c = parseSimpleRow("tag:*"); // glob alias
	ok(c?.kind === "tag-any", "parse tag:* → tag-any");
}
{
	const c = parseSimpleRow("status:draft");
	ok(c?.kind === "fm-eq" && c.field === "status" && c.value === "draft", "parse field:value → fm-eq");
}
{
	const c = parseSimpleRow("-status:draft");
	ok(c?.kind === "fm-not" && c.field === "status" && c.value === "draft", "parse -field:value → fm-not");
}
{
	const c = parseSimpleRow("status:?");
	ok(c?.kind === "fm-any" && c.field === "status" && c.value === "", "parse field:? → fm-any");
}
{
	// surrounding whitespace tolerated
	const c = parseSimpleRow("  tag:#x  ");
	ok(c?.kind === "tag-has" && c.value === "x", "parse trims outer whitespace");
}

// ── parseSimpleRow: non-simple rows return null (never destroyed) ───────────
{
	ok(parseSimpleRow("tag:#a AND tag:#b") === null, "non-simple: AND → null");
	ok(parseSimpleRow("tag:#a OR tag:#b") === null, "non-simple: OR → null");
	ok(parseSimpleRow("(tag:#a)") === null, "non-simple: parens → null");
	ok(parseSimpleRow("tag1:#a") === null, "non-simple: tagN depth → null");
	ok(parseSimpleRow("tag.category:Infra") === null, "non-simple: tag.fm → null");
	ok(parseSimpleRow("") === null, "non-simple: empty → null");
	ok(parseSimpleRow("tag:") === null, "non-simple: empty value → null");
	ok(parseSimpleRow("draft") === null, "non-simple: no colon → null");
	ok(parseSimpleRow("-tag:?") === null, "non-simple: NOT-any not a builder concept → null");
	ok(parseSimpleRow("-field:?") === null, "non-simple: NOT-any property → null");
	ok(parseSimpleRow("folder:foo") === null, "non-simple: folder: unsupported → null");
	ok(parseSimpleRow("path:foo") === null, "non-simple: path: unsupported → null");
}

// ── stringifySimpleCondition: canonical strings ─────────────────────────────
{
	const cases: { c: SimpleCondition; s: string }[] = [
		{ c: { kind: "tag-has", field: "tag", value: "x" }, s: "tag:#x" },
		{ c: { kind: "tag-not", field: "tag", value: "x" }, s: "-tag:#x" },
		{ c: { kind: "tag-any", field: "tag", value: "" }, s: "tag:?" },
		{ c: { kind: "fm-eq", field: "status", value: "draft" }, s: "status:draft" },
		{ c: { kind: "fm-not", field: "status", value: "draft" }, s: "-status:draft" },
		{ c: { kind: "fm-any", field: "status", value: "" }, s: "status:?" },
	];
	for (const { c, s } of cases) {
		ok(stringifySimpleCondition(c) === s, `stringify ${c.kind} → ${s}`);
	}
	// stringify accepts a value that already carries '#' for tags.
	ok(
		stringifySimpleCondition({ kind: "tag-has", field: "tag", value: "#x" }) === "tag:#x",
		"stringify strips duplicate # on tag value",
	);
}

// ── round-trip: parse → stringify → parse is stable ─────────────────────────
{
	const rows = ["tag:#x", "-tag:#x", "tag:?", "status:draft", "-status:draft", "status:?"];
	for (const r of rows) {
		const c = parseSimpleRow(r);
		ok(c !== null, `roundtrip parse ${r}`);
		const back = stringifySimpleCondition(c!);
		const c2 = parseSimpleRow(back);
		ok(
			c2 !== null && c2.kind === c!.kind && c2.field === c!.field && c2.value === c!.value,
			`roundtrip stable for ${r} (→ ${back})`,
		);
	}
}

// ── buildBuilderSources: filters reserved / non-simple field keys ───────────
{
	const src: SuggestSources = {
		tags: ["wip", "done"],
		fields: ["status", "priority", "tag", "tag1", "tag.category", "folder", "path", "weird key"],
	};
	const b = buildBuilderSources(src);
	ok(b.tags.length === 2, "builder sources keep tag values");
	ok(b.fields.includes("status") && b.fields.includes("priority"), "builder keeps simple fm keys");
	ok(!b.fields.includes("tag"), "builder drops bare 'tag' from fm fields");
	ok(!b.fields.includes("tag1"), "builder drops tagN");
	ok(!b.fields.includes("tag.category"), "builder drops tag.fm");
	ok(!b.fields.includes("folder") && !b.fields.includes("path"), "builder drops folder/path");
	ok(!b.fields.includes("weird key"), "builder drops invalid identifiers");
}

// ── collectPropertyValues: flattens scalars + arrays, dedupes, sorts ────────
{
	// Minimal fake App with the two methods collectPropertyValues uses.
	const files = [
		{ frontmatter: { status: "draft", tags: ["a"] } },
		{ frontmatter: { status: "done" } },
		{ frontmatter: { status: ["done", "review"] } },
		{ frontmatter: { status: { nested: 1 } } }, // skipped (object)
		{ frontmatter: { other: "x" } }, // different field
		{ frontmatter: null },
	];
	const app = {
		vault: { getMarkdownFiles: () => files.map((_, i) => ({ id: i })) },
		metadataCache: {
			getFileCache: (f: { id: number }) => ({ frontmatter: files[f.id].frontmatter }),
		},
	} as unknown as import("obsidian").App;

	const values = collectPropertyValues(app, "status");
	ok(JSON.stringify(values) === JSON.stringify(["done", "draft", "review"]), "property values flattened/sorted/deduped");
	ok(collectPropertyValues(app, "missing").length === 0, "missing field → empty (free-text fallback)");
}

// ── Beginner tag-picker classification ──────────────────────────────────────
// The beginner WHERE/GROUP_BY UI shows plain `tag:#x` rows as removable tag
// chips and EVERYTHING else as verbatim read-only text (never rewritten), so
// the SQL-like power survives untouched.
{
	const r = classifyTagPickerRow("tag:#wip", 0);
	ok(r.kind === "tag" && r.tag === "wip" && r.index === 0, "tag:#wip → tag chip 'wip'");
}
{
	const r = classifyTagPickerRow("tag:wip", 3); // '#' optional, parsed the same
	ok(r.kind === "tag" && r.tag === "wip" && r.index === 3, "tag:wip (no #) → tag chip 'wip'");
}
{
	// NOT / property / wildcard / depth / compound → raw verbatim, NOT a chip.
	for (const raw of ["-tag:#wip", "status:draft", "tag:?", "tag2:#x", "tag:a AND tag:b", "(tag:#a)"]) {
		const r = classifyTagPickerRow(raw, 0);
		ok(r.kind === "raw" && r.raw === raw && r.tag === "", `non-simple '${raw}' → raw verbatim`);
	}
}
{
	// classifyTagPickerRows drops blank rows but keeps everything else in order
	// with original indices preserved (so deletion by index/value is correct).
	const rows = ["tag:#a", "", "status:draft", "tag:#b"];
	const got = classifyTagPickerRows(rows);
	ok(got.length === 3, "blank rows excluded from picker list");
	ok(got[0].kind === "tag" && got[0].tag === "a" && got[0].index === 0, "row0 tag a @ index 0");
	ok(got[1].kind === "raw" && got[1].raw === "status:draft" && got[1].index === 2, "row1 raw @ index 2 (blank skipped)");
	ok(got[2].kind === "tag" && got[2].tag === "b" && got[2].index === 3, "row2 tag b @ index 3");
}
{
	// tagRowString produces the canonical saved string and round-trips back to a
	// tag-has condition (same as a hand-typed row).
	ok(tagRowString("wip") === "tag:#wip", "tagRowString('wip') → tag:#wip");
	ok(tagRowString("#wip") === "tag:#wip", "tagRowString strips a leading #");
	ok(tagRowString("  spaced  ") === "tag:#spaced", "tagRowString trims");
	const back = parseSimpleRow(tagRowString("foo/bar"));
	ok(back?.kind === "tag-has" && back.value === "foo/bar", "tagRowString round-trips through parseSimpleRow");
}

// ── tagPickerRowLabel: friendly labels for all six simple kinds ──────────────
// Property = value AND the auto-split rows are now "simple" (friendly label),
// so they no longer fall through to raw monospace text. Anything non-simple is
// returned verbatim and flagged simple === false.
{
	ok(tagPickerRowLabel("tag:#wip").text === "#wip", "label tag-has → #wip");
	ok(tagPickerRowLabel("tag:#wip").simple === true, "label tag-has is simple");
	ok(tagPickerRowLabel("-tag:#wip").text === "not #wip", "label tag-not → not #wip");
	ok(
		tagPickerRowLabel("tag:?").text === "One group per tag (auto-split)",
		"label tag-any → auto-split tags",
	);
	ok(tagPickerRowLabel("tag:?").simple === true, "label tag-any is simple");
	ok(tagPickerRowLabel("status:draft").text === "status: draft", "label fm-eq → status: draft");
	ok(tagPickerRowLabel("status:draft").simple === true, "label fm-eq is simple");
	ok(tagPickerRowLabel("-status:draft").text === "status not draft", "label fm-not → status not draft");
	ok(
		tagPickerRowLabel("status:?").text === "One group per status value (auto-split)",
		"label fm-any → auto-split per status",
	);
	ok(tagPickerRowLabel("status:?").simple === true, "label fm-any is simple");
	// Non-simple → verbatim, flagged not simple.
	const adv = tagPickerRowLabel("tag:#a AND tag:#b");
	ok(adv.text === "tag:#a AND tag:#b" && adv.simple === false, "label non-simple → verbatim, not simple");
}

// ── buildPickerCandidates: four candidate kinds, capped per-property values ──
{
	const sources: BuilderSources = { tags: ["wip", "done"], fields: ["status", "priority"] };
	const valueMap = {
		status: ["draft", "review", "done"],
		priority: Array.from({ length: 25 }, (_, i) => `p${i}`),
	};
	const cands = buildPickerCandidates(sources, valueMap, 10);

	// Auto-split-all-tags is the headline candidate, always first.
	ok(cands[0].kind === "tag-split" && cands[0].insert === "tag:?", "first candidate = tag auto-split");

	// Tag value candidates inserted as canonical tag:#name.
	const wip = cands.find((c) => c.kind === "tag" && c.label === "#wip");
	ok(!!wip && wip.insert === "tag:#wip", "tag candidate inserts tag:#wip");

	// Each property contributes an auto-split candidate.
	const statusSplit = cands.find((c) => c.kind === "field-split" && c.insert === "status:?");
	ok(!!statusSplit && statusSplit.label === "Show one group per status value (auto-split)", "status field-split present");

	// Property = value candidates inserted as field:value.
	const statusDraft = cands.find((c) => c.kind === "property" && c.insert === "status:draft");
	ok(!!statusDraft && statusDraft.label === "status: draft", "property candidate inserts status:draft");

	// Per-property value cap applied: priority has 25 values but only 10 become
	// candidates (plus its one field-split).
	const priorityValues = cands.filter((c) => c.kind === "property" && c.label.startsWith("priority:"));
	ok(priorityValues.length === 10, "per-property value cap applied (10 of 25 priority values)");
}
{
	// Default cap constant is wired through when the arg is omitted.
	const sources: BuilderSources = { tags: [], fields: ["f"] };
	const valueMap = { f: Array.from({ length: 50 }, (_, i) => `v${i}`) };
	const cands = buildPickerCandidates(sources, valueMap);
	const fValues = cands.filter((c) => c.kind === "property");
	ok(fValues.length === PROPERTY_VALUE_CANDIDATE_CAP, "default per-property cap == PROPERTY_VALUE_CANDIDATE_CAP");
}

// ── computePickerCandidates: mixed filter hits tags AND properties ──────────
{
	const sources: BuilderSources = { tags: ["draft-notes", "wip"], fields: ["status"] };
	const valueMap = { status: ["draft", "done"] };
	const pool = buildPickerCandidates(sources, valueMap);

	// "draft" matches BOTH the #draft-notes tag and the status: draft property.
	const hits = computePickerCandidates(pool, "draft", []);
	const labels = hits.map((c) => c.label);
	ok(labels.includes("#draft-notes"), "filter hits tag candidate");
	ok(labels.includes("status: draft"), "filter hits property candidate");

	// Empty query surfaces the auto-split head first (capability discoverable).
	const empty = computePickerCandidates(pool, "", []);
	ok(empty[0].kind === "tag-split", "empty query surfaces tag auto-split first");

	// Already-present rows are excluded so no duplicate can be added.
	const dedup = computePickerCandidates(pool, "", ["tag:?"]);
	ok(!dedup.some((c) => c.insert === "tag:?"), "existing row excluded from candidates");

	// Limit cap respected.
	const capped = computePickerCandidates(pool, "", [], 2);
	ok(capped.length === 2, "candidate limit cap respected");
}

// ── collectPropertyValueMap: per-field capped value collection ──────────────
{
	const files = [
		{ frontmatter: { status: "draft" } },
		{ frontmatter: { status: "done" } },
		{ frontmatter: { priority: Array.from({ length: 20 }, (_, i) => `p${i}`) } },
	];
	const app = {
		vault: { getMarkdownFiles: () => files.map((_, i) => ({ id: i })) },
		metadataCache: {
			getFileCache: (f: { id: number }) => ({ frontmatter: files[f.id].frontmatter }),
		},
	} as unknown as import("obsidian").App;

	const map = collectPropertyValueMap(app, ["status", "priority"], 10);
	ok(JSON.stringify(map.status) === JSON.stringify(["done", "draft"]), "status values collected/sorted");
	ok(map.priority.length === 10, "priority values capped at 10");
}
