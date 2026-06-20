// Bases fallback (`_all.base`) auto-generation tests.
//
// The Obsidian-touching `ensureFallbackBase` (vault.create) is not exercisable
// without a runtime, so we verify the two PURE guarantees it relies on:
//   1. The generation gate (`shouldGenerateFallback`) fires ONLY when the vault
//      has zero `.base` files (idempotency: a present base ⇒ no-op).
//   2. The fallback YAML body, once parsed, yields a NO-FILTER view that
//      match-alls every note via resolveElements (= every note graphed).
import { ok } from "./assert";
import {
	FALLBACK_BASE_PATH,
	FALLBACK_BASE_CONTENT,
	shouldGenerateFallback,
} from "../src/bases/fallback";
import { parseBaseStructure } from "../src/bases/parser";
import { resolveElements } from "../src/bases/resolve";
import type { FileFacts } from "../src/query/query";

function facts(path: string, tags: string[] = [], fm: Record<string, unknown> = {}): FileFacts {
	return { path, tags, frontmatter: fm };
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

// --- fallback YAML body declares NO filter ⇒ match-all over every note ---
{
	// Mirror what parseYaml(FALLBACK_BASE_CONTENT) yields. We assert the body has
	// no `filters`/`filter` key so the parsed view.filter is null (= match-all).
	ok(!/\bfilters?\s*:/.test(FALLBACK_BASE_CONTENT), "fallback YAML defines no filter key");
	ok(/type:\s*table/.test(FALLBACK_BASE_CONTENT), "fallback YAML has a table view");

	// Structural equivalent of the YAML (what parseYaml returns), fed to the pure
	// parser so we exercise the real resolve path.
	const parsed = {
		views: [{ type: "table", name: "All notes", order: ["file.name"] }],
	};
	const table = parseBaseStructure(parsed, FALLBACK_BASE_PATH);
	ok(table.views.length === 1, "one view parsed");
	ok(table.views[0].filter === null, "no-filter view → filter is null (match-all)");

	const factsByPath = new Map<string, FileFacts>([
		["a.md", facts("a.md", ["x"])],
		["b.md", facts("b.md", [], { status: "open" })],
		["sub/c.md", facts("sub/c.md")],
	]);
	const els = resolveElements(table, table.views[0], factsByPath, new Map());
	ok(els.length === 3, "match-all view resolves EVERY note (3/3)");
	ok(
		els.some((e) => e.notePath === "a.md") &&
			els.some((e) => e.notePath === "b.md") &&
			els.some((e) => e.notePath === "sub/c.md"),
		"all note paths present in resolved elements",
	);
	ok(els[0].fields["file.name"] === "a.md", "declared order column is extracted");
}

console.log("bases-fallback tests passed");
