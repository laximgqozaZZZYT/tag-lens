// Bases relation-builder tests. buildRelations is pure over BaseElement[].
import { ok } from "./assert";
import { buildRelations } from "../src/bases/relations";
import { NONE_BUCKET } from "../src/types";
import type { BaseElement } from "../src/bases/types";

function el(
	tablePath: string,
	notePath: string,
	tags: string[],
	fields: Record<string, unknown> = {},
	links: string[] = [],
	viewName = "v",
): BaseElement {
	return {
		key: `${tablePath}::${viewName}::${notePath}`,
		notePath,
		tablePath,
		viewName,
		fields,
		tags,
		links,
	};
}

// --- shared-tag, with NONE_BUCKET excluded ---
{
	const els = [
		el("A.base", "a.md", ["topic", NONE_BUCKET]),
		el("A.base", "b.md", ["topic"]),
		el("A.base", "c.md", [NONE_BUCKET]),
	];
	const { relations } = buildRelations(els, { link: false, sharedTag: true, sharedProp: false });
	const tagRels = relations.filter((r) => r.kind === "shared-tag");
	ok(tagRels.length === 1, "exactly one shared-tag pair (a–b via topic)");
	ok(tagRels[0].via === "topic", "via = shared tag name");
	ok(!tagRels.some((r) => r.via === NONE_BUCKET), "NONE_BUCKET never forms a shared-tag relation");
}

// --- crossBase flag ---
{
	const els = [
		el("A.base", "a.md", ["x"]),
		el("B.base", "b.md", ["x"]),
		el("A.base", "c.md", ["x"]),
	];
	const { relations } = buildRelations(els, { link: false, sharedTag: true, sharedProp: false });
	const ab = relations.find((r) => r.aNote !== r.bNote && (r.aNote === "b.md" || r.bNote === "b.md"))!;
	ok(ab.crossBase === true, "A.base ↔ B.base pair flagged crossBase");
	const ac = relations.find(
		(r) => (r.aNote === "a.md" && r.bNote === "c.md") || (r.aNote === "c.md" && r.bNote === "a.md"),
	)!;
	ok(ac.crossBase === false, "same-base pair not crossBase");
}

// --- shared-property: same key & value ---
{
	const els = [
		el("A.base", "a.md", [], { status: "open" }),
		el("A.base", "b.md", [], { status: "open" }),
		el("A.base", "c.md", [], { status: "closed" }),
	];
	const { relations } = buildRelations(els, { link: false, sharedTag: false, sharedProp: true });
	const propRels = relations.filter((r) => r.kind === "shared-property");
	ok(propRels.length === 1, "one shared-property pair (a–b via status=open)");
	ok(propRels[0].via === "status=open", "via encodes key=value");
}

// --- link: both ends present ---
{
	const els = [
		el("A.base", "a.md", [], {}, ["b.md", "missing.md"]),
		el("A.base", "b.md", [], {}, []),
	];
	const { relations, adjacency } = buildRelations(els, { link: true, sharedTag: false, sharedProp: false });
	const linkRels = relations.filter((r) => r.kind === "link");
	ok(linkRels.length === 1, "one link relation (a→b); missing.md target ignored");
	ok(adjacency.get(els[0].key)?.length === 1, "adjacency indexes both endpoints");
	ok(adjacency.get(els[1].key)?.length === 1, "adjacency reverse endpoint present");
}

// --- dedupe: identical relation not duplicated ---
{
	// a and b share two tags → two shared-tag relations with distinct `via`,
	// but the SAME tag must not yield a duplicate.
	const els = [
		el("A.base", "a.md", ["t1", "t1", "t2"]),
		el("A.base", "b.md", ["t1", "t2"]),
	];
	const { relations } = buildRelations(els, { link: false, sharedTag: true, sharedProp: false });
	const vias = relations.filter((r) => r.kind === "shared-tag").map((r) => r.via).sort();
	ok(JSON.stringify(vias) === JSON.stringify(["t1", "t2"]), "duplicate tag t1 deduped; two distinct vias");
}

// --- opts gating: all off → no relations ---
{
	const els = [el("A.base", "a.md", ["x"], { s: "1" }, ["a.md"]), el("A.base", "b.md", ["x"], { s: "1" })];
	const { relations } = buildRelations(els, { link: false, sharedTag: false, sharedProp: false });
	ok(relations.length === 0, "all opts off → empty relations");
}

console.log("bases-relations tests passed");
