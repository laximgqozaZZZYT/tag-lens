// End-to-end smoke for the `.base` filter grammar fix (T4). The reported bug:
// a real `.base` whose view filter is `file.tags.containsAny("書籍","小説")`
// matched 0 notes and emptied the graph. This drives the FULL pipeline the way
// `parseBaseFile` does — `parseBaseStructure` (the object `parseYaml` produces)
// → `resolveElements` — and proves the graph is NON-empty (CDP/E2E is blocked
// in the agent sandbox, so this headless smoke is the behaviour gate).
import { ok } from "./assert";
import { parseBaseStructure } from "../src/bases/parser";
import { resolveElements } from "../src/bases/resolve";
import type { FileFacts } from "../src/query/query";

function facts(path: string, tags: string[], fm: Record<string, unknown> = {}): FileFacts {
	return { path, tags, frontmatter: fm };
}

// The object shape a parsed `.base` YAML yields: a single table view whose
// `filters` is the exact multi-arg tag condition from the bug report.
const table = parseBaseStructure(
	{
		views: [
			{
				type: "table",
				name: "Books",
				order: ["file.name", "file.tags"],
				filters: 'file.tags.containsAny("書籍", "小説")',
			},
		],
	},
	"Library.base",
);

const view = table.views[0];
ok(view != null && view.filter != null, "the containsAny filter parsed (not dropped as raw)");

// A vault where two notes carry one of the wanted tags, two carry neither.
const factsByPath = new Map<string, FileFacts>([
	["book.md", facts("book.md", ["書籍", "wip"])],
	["novel.md", facts("novel.md", ["小説"])],
	["essay.md", facts("essay.md", ["随筆"])],
	["untagged.md", facts("untagged.md", [])],
]);
const forward = new Map<string, string[]>();

const els = resolveElements(table, view, factsByPath, forward);

ok(els.length > 0, "containsAny `.base` no longer empties the graph");
ok(els.length === 2, "exactly the two notes with 書籍/小説 resolve");
const paths = els.map((e) => e.notePath).sort();
ok(JSON.stringify(paths) === JSON.stringify(["book.md", "novel.md"]), "matched notes are book.md + novel.md");

console.log("bases-containsany-smoke tests passed");
