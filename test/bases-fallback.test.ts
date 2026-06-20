// Bases fallback (`_all.base`) auto-generation tests.
//
// The Obsidian-touching `ensureFallbackBase` (vault.create) is not exercisable
// without a runtime, so we verify the PURE guarantees it relies on:
//   1. The generation gate (`shouldGenerateFallback`) fires ONLY when the vault
//      has zero `.base` files (idempotency: a present base ⇒ no-op).
//   2. The fallback YAML body groups notes by tag — ONE view per tag, each with
//      a `file.tags.contains("#<tag>")` filter — and once parsed each view
//      resolves ONLY the notes carrying that tag (no cross-tag leakage).
//   3. The top-N frequency cap keeps only the most-used tags when a vault has
//      more distinct tags than FALLBACK_MAX_TAG_VIEWS.
//   4. A vault with ZERO tags degrades to the historical single match-all view.
//
// Note: the test obsidian mock's `parseYaml` is a stub, so instead of round-
// tripping the YAML string through a real YAML engine we (a) assert the emitted
// YAML TEXT line-by-line, and (b) feed the structural equivalent object (what a
// real parseYaml would return) into `parseBaseStructure` — mirroring how
// bases-parser.test.ts exercises the pure parser.
import { ok } from "./assert";
import {
	FALLBACK_BASE_PATH,
	FALLBACK_BASE_CONTENT,
	FALLBACK_MAX_TAG_VIEWS,
	shouldGenerateFallback,
	buildFallbackContent,
	topTags,
} from "../src/bases/fallback";
import { parseBaseStructure } from "../src/bases/parser";
import { resolveElements } from "../src/bases/resolve";
import type { FileFacts } from "../src/query/query";

function facts(path: string, tags: string[] = [], fm: Record<string, unknown> = {}): FileFacts {
	return { path, tags, frontmatter: fm };
}

// Structural equivalent of buildFallbackContent(tags), i.e. what a real
// parseYaml() would hand to parseBaseStructure. Keeps the two in lock-step.
function asStructure(tags: string[]): unknown {
	return {
		views: tags.map((t) => ({
			type: "table",
			name: t,
			filters: `file.tags.contains("#${t}")`,
			order: ["file.name"],
		})),
	};
}

// --- generation gate: empty ⇒ generate; any base present ⇒ no-op (idempotent) ---
{
	ok(shouldGenerateFallback([]) === true, "no .base files → generate fallback");
	ok(shouldGenerateFallback(["_all.base"]) === false, "_all.base already present → no regenerate");
	ok(shouldGenerateFallback(["Foo/Bar.base"]) === false, "any real .base present → never generate");
	ok(shouldGenerateFallback(["a.base", "b.base"]) === false, "multiple bases → no-op");
}

// --- fallback path is the vault root `_all.base` ---
{
	ok(FALLBACK_BASE_PATH === "_all.base", "fallback path is vault-root _all.base");
}

// --- emitted YAML text: one view block per tag with the right keys ---
{
	const yaml = buildFallbackContent(["project", "idea", "daily"]);
	ok((yaml.match(/^\s*- type: table$/gm) ?? []).length === 3, "3 table view blocks emitted");
	ok((yaml.match(/file\.tags\.contains/g) ?? []).length === 3, "3 file.tags.contains filters emitted");
	ok(/name: "project"/.test(yaml), "tag name embedded as view name");
	ok(/filters: "file\.tags\.contains\(\\"#idea\\"\)"/.test(yaml), "filter targets the tag, quotes escaped");
}

// --- tag grouping: one view per tag, each with a file.tags.contains filter ---
{
	const tags = ["project", "idea", "daily"];
	const table = parseBaseStructure(asStructure(tags), FALLBACK_BASE_PATH);

	ok(table.views.length === 3, "one view per tag (3/3)");
	ok(
		table.views.map((v) => v.name).join(",") === "project,idea,daily",
		"view names mirror the tag order",
	);
	for (const v of table.views) {
		const f = v.filter;
		ok(f !== null && "cond" in f, `view ${v.name} has a parsed condition filter`);
		if (f && "cond" in f) {
			ok(f.cond.op === "contains" && /tags$/i.test(f.cond.lhs), `${v.name} filter is file.tags.contains`);
			ok(f.cond.rhs === `#${v.name}`, `${v.name} filter targets its own tag`);
		}
	}
}

// --- resolveElements: each tag view emits ONLY its own tag's notes ---
{
	const table = parseBaseStructure(asStructure(["project", "idea"]), FALLBACK_BASE_PATH);

	const factsByPath = new Map<string, FileFacts>([
		["p1.md", facts("p1.md", ["project"])],
		["p2.md", facts("p2.md", ["project", "idea"])],
		["i1.md", facts("i1.md", ["idea"])],
		["none.md", facts("none.md", [])], // tag-less → grouped by NO view
	]);

	const projectView = table.views.find((v) => v.name === "project")!;
	const ideaView = table.views.find((v) => v.name === "idea")!;

	const proj = resolveElements(table, projectView, factsByPath, new Map()).map((e) => e.notePath).sort();
	const idea = resolveElements(table, ideaView, factsByPath, new Map()).map((e) => e.notePath).sort();

	ok(proj.join(",") === "p1.md,p2.md", "project view resolves exactly its tagged notes");
	ok(idea.join(",") === "i1.md,p2.md", "idea view resolves exactly its tagged notes");
	ok(!proj.includes("i1.md") && !idea.includes("p1.md"), "no cross-tag leakage between views");
	ok(!proj.includes("none.md") && !idea.includes("none.md"), "tag-less note is in no tag view");
}

// --- top-N frequency cap: keep most frequent tags, drop the tail ---
{
	// Synthetic counts: t0 used 0× … t99 used 99× (more frequent = higher index).
	const counts: Array<[string, number]> = [];
	for (let i = 0; i < 100; i++) counts.push([`t${i}`, i]);

	const kept = topTags(counts, FALLBACK_MAX_TAG_VIEWS);
	ok(kept.length === FALLBACK_MAX_TAG_VIEWS, `cap honoured (${kept.length} === ${FALLBACK_MAX_TAG_VIEWS})`);
	ok(kept[0] === "t99", "most frequent tag kept first");
	ok(!kept.includes("t0") && !kept.includes("t49"), "low-frequency tail dropped");
	ok(kept.includes("t50") && kept.includes("t99"), "top-50 frequency band retained");

	// A capped tag list still produces exactly N views.
	const yaml = buildFallbackContent(kept);
	ok((yaml.match(/^\s*- type: table$/gm) ?? []).length === FALLBACK_MAX_TAG_VIEWS, "capped → N view blocks");

	// Deterministic tie-break: equal counts sort alphabetically.
	const ties: Array<[string, number]> = [["b", 5], ["a", 5], ["c", 5]];
	ok(topTags(ties, 2).join(",") === "a,b", "ties broken alphabetically");
}

// --- zero-tag vault: degrade to historical single match-all view ---
{
	const yaml = buildFallbackContent([]);
	ok(yaml === FALLBACK_BASE_CONTENT, "empty tag list → degenerate match-all body");
	ok(!/\bfilters?\s*:/.test(yaml), "degenerate body defines no filter key");

	const table = parseBaseStructure(
		{ views: [{ type: "table", name: "All notes", order: ["file.name"] }] },
		FALLBACK_BASE_PATH,
	);
	ok(table.views.length === 1, "single view");
	ok(table.views[0].filter === null, "no-filter view → match-all");

	const factsByPath = new Map<string, FileFacts>([
		["a.md", facts("a.md")],
		["b.md", facts("b.md")],
		["c.md", facts("c.md")],
	]);
	const els = resolveElements(table, table.views[0], factsByPath, new Map());
	ok(els.length === 3, "match-all view resolves EVERY note (3/3)");
}

console.log("bases-fallback tests passed");
