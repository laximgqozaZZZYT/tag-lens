// stripTabPrefix(id) — the Euler-nested-copy `${tag}\t${path}` id → path strip,
// now living in the neutral util/ module so both interaction/ and draw/ share it.
import { ok } from "./assert";
import { stripTabPrefix } from "../src/util/tab-prefix";

// A tab-prefixed Euler copy → the real path after the first tab.
{
	ok(stripTabPrefix("書籍\tnotes/a.md") === "notes/a.md", "strips tag\\tpath prefix");
	ok(stripTabPrefix("#tag\tfoo/bar.md") === "foo/bar.md", "strips even with # in the tag");
}

// A plain path (no tab) → returned unchanged.
{
	ok(stripTabPrefix("notes/a.md") === "notes/a.md", "plain path unchanged");
	ok(stripTabPrefix("") === "", "empty unchanged");
}

// Only the FIRST tab is the separator; any later tab stays in the path.
{
	ok(stripTabPrefix("t\ta\tb") === "a\tb", "splits on the first tab only");
}
