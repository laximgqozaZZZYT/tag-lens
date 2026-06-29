// Mode-agnostic note navigator: pure decision logic.
// Asserts (1) the DISPLAYED note list is MODE-INVARIANT — `menuNoteList` always
// returns the universal `menuNotes` regardless of the `laid` shape (droste
// gallery / positioned euler nodes / aggregate), so the list + Folder/Tag trees
// are identical across modes — and (2) the click-action routing stays
// mode-appropriate (behaviour, not displayed content).
import { ok } from "./assert";
import {
	menuNoteList,
	menuClickAction,
	clampRect,
	noteMenuHeight,
	buildFolderTree,
	buildTagTree,
	searchNotes,
	advancedSearch,
	suggestQuery,
	currentToken,
	applySuggestionToken,
	tagLabel,
	comboLabel,
	UNTAGGED_BUCKET,
	hideKey,
	nodeIsHidden,
	bulkSetHidden,
	collectDescendantNoteKeys,
	folderCheckState,
	buildFolderPathKey,
	suggestKeyAction,
	type NoteRef,
	type TreeNode,
} from "../src/interaction/note-menu";

const menuNotes: NoteRef[] = [
	{ id: "Area/a.md", label: "a" },
	{ id: "Area/b.md", label: "b" },
	{ id: "c.md", label: "c" },
];

// ── MODE INVARIANCE: the DISPLAYED note list is ALWAYS the universal
//    `menuNotes`, regardless of the `laid` shape. The list (ids/labels/order)
//    must be byte-for-byte identical for a droste-shaped laid, a positioned-
//    node laid, and an aggregate laid given the SAME menuNotes. ────────────────
{
	const sig = (l: NoteRef[]): string =>
		l.map((n) => `${n.id}|${n.label}|${(n.memberships ?? []).join(",")}`).join(";");

	// droste-shaped laid: gallery cells present (a DIFFERENT id set on purpose).
	const drosteLaid = {
		drosteGallery: { cells: [{ id: "g/x.md", label: "x" }, { id: "g/y.md", label: "y" }] },
		nodes: [{ id: "g/x.md", label: "x" }],
	};
	// positioned-node laid: euler/bipartite-style on-canvas cards (also a
	// different id set).
	const positionedLaid = {
		drosteGallery: null,
		nodes: [
			{ id: "Area/a.md", label: "a" },
			{ id: "Area/b.md", label: "b" },
		],
	};
	// aggregate laid: no gallery, no positioned nodes.
	const aggregateLaid = { drosteGallery: null, nodes: [] as { id: string; label: string }[] };

	const drosteList = menuNoteList(drosteLaid, menuNotes);
	const positionedList = menuNoteList(positionedLaid, menuNotes);
	const aggregateList = menuNoteList(aggregateLaid, menuNotes);

	// The displayed list never follows `laid` — always exactly `menuNotes`.
	ok(sig(drosteList) === sig(menuNotes), "menuNoteList: droste laid → universal menuNotes");
	ok(sig(positionedList) === sig(menuNotes), "menuNoteList: positioned laid → universal menuNotes");
	ok(sig(aggregateList) === sig(menuNotes), "menuNoteList: aggregate laid → universal menuNotes");
	// …and therefore identical to EACH OTHER (the core mode-invariance property).
	ok(
		sig(drosteList) === sig(positionedList) && sig(positionedList) === sig(aggregateList),
		"menuNoteList: identical list for droste / positioned / aggregate laid",
	);

	// Folder tree + Tag tree built from the lists must also be identical, since
	// they derive purely from the (now mode-invariant) list.
	const treeSig = (t: TreeNode): string => JSON.stringify(t, (_k, v) =>
		v instanceof Map ? Object.fromEntries(v) : v);
	ok(
		treeSig(buildFolderTree(drosteList)) === treeSig(buildFolderTree(aggregateList)),
		"buildFolderTree: identical across droste / aggregate laid",
	);
	ok(
		treeSig(buildTagTree(drosteList)) === treeSig(buildTagTree(positionedList)),
		"buildTagTree: identical across droste / positioned laid",
	);
}

// ── CLICK ROUTING stays mode-appropriate (behaviour, not displayed content). ──
{
	// droste: every row click re-centres the gallery.
	const drosteLaid = {
		drosteGallery: { cells: [{ id: "g/x.md", label: "x" }, { id: "g/y.md", label: "y" }] },
		nodes: [{ id: "g/x.md", label: "x" }],
	};
	ok(menuClickAction(drosteLaid, "g/x.md") === "drosteFocus", "droste: click → drosteFocus");
	ok(menuClickAction(drosteLaid, "anything.md") === "drosteFocus", "droste: always drosteFocus");

	// euler: positioned node → locate; off-canvas id → openFile.
	const positionedLaid = {
		drosteGallery: null,
		nodes: [
			{ id: "Area/a.md", label: "a" },
			{ id: "Area/b.md", label: "b" },
		],
	};
	ok(menuClickAction(positionedLaid, "Area/a.md") === "locate", "euler: positioned node → locate");
	ok(menuClickAction(positionedLaid, "c.md") === "openFile", "euler: off-canvas id → openFile");

	// aggregate: no canvas position → openFile.
	const aggregateLaid = { drosteGallery: null, nodes: [] as { id: string; label: string }[] };
	ok(menuClickAction(aggregateLaid, "Area/a.md") === "openFile", "aggregate: click → openFile");

	// empty gallery is NOT droste mode for routing → falls through to nodes.
	const emptyGalleryLaid = {
		drosteGallery: { cells: [] as NoteRef[] },
		nodes: [{ id: "Area/a.md", label: "a" }],
	};
	ok(menuClickAction(emptyGalleryLaid, "Area/a.md") === "locate", "empty gallery → not drosteFocus");
}

// ── clampRect: note-navigator move/resize geometry ───────────────────────────
const CONTAINER = { width: 800, height: 600 };
const MIN = { width: 180, height: 120 };

// In-bounds rect is returned unchanged.
{
	const r = clampRect({ left: 8, top: 8, width: 270, height: 400 }, CONTAINER, MIN);
	ok(r.left === 8 && r.top === 8 && r.width === 270 && r.height === 400, "clampRect: in-bounds rect unchanged");
}

// Min size is enforced (width & height floored to MIN).
{
	const r = clampRect({ left: 8, top: 8, width: 10, height: 10 }, CONTAINER, MIN);
	ok(r.width === 180 && r.height === 120, "clampRect: width/height floored to min");
}

// Size is capped to the container (can't grow larger than the view).
{
	const r = clampRect({ left: 0, top: 0, width: 9999, height: 9999 }, CONTAINER, MIN);
	ok(r.width === 800 && r.height === 600, "clampRect: size capped to container");
}

// Dragging far right keeps ≥40px (default keepVisible) on screen.
{
	const r = clampRect({ left: 5000, top: 5000, width: 270, height: 400 }, CONTAINER, MIN);
	ok(r.left === 800 - 40, "clampRect: right edge keeps 40px visible (left = cw - 40)");
	ok(r.top === 600 - 40, "clampRect: bottom edge keeps 40px visible (top = ch - 40)");
}

// Dragging far left/up can't push the panel fully off-screen.
{
	const r = clampRect({ left: -5000, top: -5000, width: 270, height: 400 }, CONTAINER, MIN);
	ok(r.left === 40 - 270, "clampRect: left clamp = keepVisible - width");
	ok(r.top === 0, "clampRect: top never above the container");
}

// Custom keepVisible is honoured.
{
	const r = clampRect({ left: 5000, top: 0, width: 200, height: 200 }, CONTAINER, MIN, 100);
	ok(r.left === 800 - 100, "clampRect: custom keepVisible respected");
}

// ── noteMenuHeight: minimize (header double-click) geometry ───────────────────
// Minimized → header height only (search + tree body hidden).
{
	ok(noteMenuHeight(true, 30, 400, 350) === 30, "noteMenuHeight: minimized → header height");
	ok(noteMenuHeight(true, 30, 400, null) === 30, "noteMenuHeight: minimized ignores restore/current");
}

// Restored → the remembered restore height when known.
{
	ok(noteMenuHeight(false, 30, 30, 350) === 350, "noteMenuHeight: restored → restoreHeight");
}

// Restored with no remembered height → falls back to the current (live) height.
{
	ok(noteMenuHeight(false, 30, 420, null) === 420, "noteMenuHeight: restored, no memory → current");
}

// Restored height can never be shorter than the header bar.
{
	ok(noteMenuHeight(false, 30, 10, 5) === 30, "noteMenuHeight: restore floored to header height");
}

// ── Navigator grouping: folder tree / tag tree / search dedupe ───────────────

// Collect every leaf id under a folder path (e.g. ["b","c"]) of a tree.
function leavesAt(tree: TreeNode, path: string[]): string[] {
	let cur: TreeNode | undefined = tree;
	for (const seg of path) cur = cur?.folders.get(seg);
	return cur ? cur.leaves.map((l) => l.id) : [];
}

// (d) Folder tree unchanged: groups by id path, one leaf per note.
{
	const notes: NoteRef[] = [
		{ id: "Area/a.md", label: "a", memberships: ["x"] },
		{ id: "Area/b.md", label: "b", memberships: [] },
		{ id: "c.md", label: "c" },
	];
	const t = buildFolderTree(notes);
	ok(leavesAt(t, ["Area"]).join(",") === "Area/a.md,Area/b.md", "folder tree: Area holds a,b sorted");
	ok(leavesAt(t, []).join(",") === "c.md", "folder tree: root holds top-level note c");
	// Each note appears exactly once across the whole folder tree.
	const all = [...leavesAt(t, []), ...leavesAt(t, ["Area"])];
	ok(all.length === 3, "folder tree: 3 leaves total (one per note)");
}

// Display label of the folder reached by `path` (Map-key descent).
function labelAt(tree: TreeNode, path: string[]): string | undefined {
	let cur: TreeNode | undefined = tree;
	for (const seg of path) cur = cur?.folders.get(seg);
	return cur?.label;
}
// The single combination-subgroup Map key under tag folder `tag` (combos are the
// only sub-folders of a tag folder; their keys are prefixed "combo:").
function comboKeysUnder(tree: TreeNode, tag: string): string[] {
	const tf = tree.folders.get(tag);
	return tf ? [...tf.folders.keys()] : [];
}

// ── Change 1: tag-label formatting (#xxxx, strip tag= prefix) ────────────────
{
	ok(tagLabel("project") === "#project", "tagLabel: bare key → #project");
	ok(tagLabel("tag=project") === "#project", "tagLabel: strips 'tag=' prefix");
	ok(tagLabel("tag:project") === "#project", "tagLabel: strips 'tag:' prefix");
	ok(tagLabel("tag=status%2Factive") === "#status/active", "tagLabel: URI-decodes value");
	ok(tagLabel("tag=x", "status/active") === "#status/active", "tagLabel: uses display name when given");
	ok(comboLabel(["tag=a", "tag=b"]) === "#a * #b", "comboLabel: '#a * #b'");
	ok(comboLabel(["a", "b", "c"]) === "#a * #b * #c", "comboLabel: 3-way joined by ' * '");
}

// (a) Tag tree: top-level tag folders are labeled "#A"; a single-tag note is a
//     DIRECT leaf under its tag folder (NOT in a combo subgroup).
{
	const notes: NoteRef[] = [
		{ id: "n2.md", label: "n2", memberships: ["a"] },
	];
	const t = buildTagTree(notes);
	ok(labelAt(t, ["a"]) === "#a", "tag tree: tag folder renders as '#a'");
	ok(leavesAt(t, ["a"]).join(",") === "n2.md", "tag tree: {a}-only note is a DIRECT leaf under #a");
	ok(comboKeysUnder(t, "a").length === 0, "tag tree: {a}-only note creates NO combo subgroup");
}

// (b) Tag tree: a {A,B} note's combo subgroup "#a * #b" appears under BOTH #a and
//     #b (intended duplication); a {A}-only note stays a direct leaf under #a.
{
	const notes: NoteRef[] = [
		{ id: "n1.md", label: "n1", memberships: ["a", "b"] },
		{ id: "n2.md", label: "n2", memberships: ["a"] },
	];
	const t = buildTagTree(notes);
	// Same combo Map key under both parents → identical subgroup placement.
	const ca = comboKeysUnder(t, "a");
	const cb = comboKeysUnder(t, "b");
	ok(ca.length === 1 && cb.length === 1 && ca[0] === cb[0], "tag tree: {a,b} combo key is the SAME under #a and #b");
	const cid = ca[0];
	ok(labelAt(t, ["a", cid]) === "#a * #b", "tag tree: combo subgroup labeled '#a * #b'");
	ok(labelAt(t, ["b", cid]) === "#a * #b", "tag tree: same combo label under #b");
	ok(leavesAt(t, ["a", cid]).join(",") === "n1.md", "tag tree: combo under #a holds n1");
	ok(leavesAt(t, ["b", cid]).join(",") === "n1.md", "tag tree: combo under #b holds n1 (duplicated)");
	// n2 ({a}-only) is a DIRECT leaf under #a, not inside the combo subgroup.
	ok(leavesAt(t, ["a"]).join(",") === "n2.md", "tag tree: {a}-only n2 stays a direct leaf under #a");
	ok(leavesAt(t, ["a", cid]).indexOf("n2.md") < 0, "tag tree: {a}-only n2 NOT in the combo subgroup");
}

// (c) Tag tree (SUBSET LATTICE): a {A,B,C} note nests under each 2-subset combo,
//     which itself sits under its single tags. The 3-way node is SHARED across
//     every parent chain and carries the note leaf.
{
	const notes: NoteRef[] = [
		{ id: "m.md", label: "m", memberships: ["a", "b", "c"] },
	];
	const t = buildTagTree(notes);
	// Top level: #a, #b, #c.
	ok(["a", "b", "c"].every((k) => t.folders.has(k)), "tag tree: single tags #a #b #c at top level");
	// Each single tag hosts the 2-combos that contain it.
	ok(comboKeysUnder(t, "a").join("|") === "a b|a c", "tag tree: #a hosts 2-combos {a,b},{a,c}");
	ok(comboKeysUnder(t, "b").join("|") === "a b|b c", "tag tree: #b hosts {a,b},{b,c}");
	ok(comboKeysUnder(t, "c").join("|") === "a c|b c", "tag tree: #c hosts {a,c},{b,c}");
	// The 2-combo carries the label and nests the 3-way combo as its child.
	ok(labelAt(t, ["a", "a b"]) === "#a * #b", "tag tree: 2-combo labeled '#a * #b'");
	ok([...t.folders.get("a")!.folders.get("a b")!.folders.keys()].join(",") === "a b c", "tag tree: {a,b} nests {a,b,c}");
	ok(labelAt(t, ["a", "a b", "a b c"]) === "#a * #b * #c", "tag tree: 3-way labeled '#a * #b * #c'");
	ok(leavesAt(t, ["a", "a b", "a b c"]).join(",") === "m.md", "tag tree: 3-way node holds m");
	// The 3-way node is the SAME shared object reached via {a,b}, {a,c}, {b,c}.
	const viaAB = t.folders.get("a")!.folders.get("a b")!.folders.get("a b c");
	const viaAC = t.folders.get("a")!.folders.get("a c")!.folders.get("a b c");
	const viaBC = t.folders.get("b")!.folders.get("b c")!.folders.get("a b c");
	ok(viaAB === viaAC && viaAC === viaBC && !!viaAB, "tag tree: the 3-way node is SHARED across all parent chains");
	// A folder cascade from #a sees the 3-way note m (descendants recurse the lattice).
	ok(collectDescendantNoteKeys(t.folders.get("a")!).join(",") === "m.md", "tag tree: #a cascade reaches the lattice-nested m");
}

// (d) Untagged bucket: notes with no memberships go under "(untagged)" (unchanged).
{
	const notes: NoteRef[] = [
		{ id: "u1.md", label: "u1" },
		{ id: "u2.md", label: "u2", memberships: [] },
		{ id: "t1.md", label: "t1", memberships: ["g"] },
	];
	const t = buildTagTree(notes);
	ok(leavesAt(t, [UNTAGGED_BUCKET]).join(",") === "u1.md,u2.md", "tag tree: untagged bucket holds u1,u2");
	ok(labelAt(t, [UNTAGGED_BUCKET]) === UNTAGGED_BUCKET, "tag tree: untagged bucket keeps its plain label (no '#')");
	ok(leavesAt(t, ["g"]).join(",") === "t1.md", "tag tree: tagged note under its group, not untagged");
}

// (e) clusterLabels-style display names flow into tag + combo labels.
{
	const notes: NoteRef[] = [
		{ id: "p.md", label: "p", memberships: ["tag=proj", "tag=stat"] },
	];
	const displays = new Map([["tag=proj", "project"], ["tag=stat", "status/active"]]);
	const t = buildTagTree(notes, displays);
	ok(labelAt(t, ["tag=proj"]) === "#project", "tag tree: display name → '#project'");
	const cid = comboKeysUnder(t, "tag=proj")[0];
	ok(labelAt(t, ["tag=proj", cid]) === "#project * #status/active", "tag tree: combo uses display names");
}

// (b) searchNotes dedupes a multi-group note to a single result.
{
	const notes: NoteRef[] = [
		{ id: "n1.md", label: "match", memberships: ["a", "b/c"] },
		{ id: "n2.md", label: "other", memberships: ["a"] },
	];
	const hits = searchNotes(notes, "match");
	ok(hits.length === 1 && hits[0].id === "n1.md", "searchNotes: multi-group note appears exactly once");
}

// searchNotes matches on id, label, and group name; result stays unique-by-id.
{
	const notes: NoteRef[] = [
		{ id: "alpha.md", label: "Alpha", memberships: ["proj/x"] },
		{ id: "beta.md", label: "Beta", memberships: ["proj/y"] },
	];
	// "proj" matches both notes via group name; each appears once.
	const hits = searchNotes(notes, "proj");
	ok(hits.length === 2, "searchNotes: group-name match returns both notes");
	const ids = hits.map((h) => h.id).sort().join(",");
	ok(ids === "alpha.md,beta.md", "searchNotes: unique-by-id across group matches");
	// Empty query → no results.
	ok(searchNotes(notes, "   ").length === 0, "searchNotes: blank query → empty");
}

// menuNoteList carries memberships straight from the universal menuNotes,
// independent of the (droste/positioned) `laid` shape it is handed.
{
	const menuNotesMemb: NoteRef[] = [
		{ id: "g/x.md", label: "x", memberships: ["a", "b"] },
		{ id: "g/y.md", label: "y", memberships: ["c"] },
	];
	// A droste-shaped laid whose gallery cells carry NO memberships must not
	// change the result: the list + memberships come from menuNotes only.
	const droste = {
		drosteGallery: { cells: [{ id: "g/x.md", label: "x" }, { id: "g/y.md", label: "y" }] },
		nodes: [{ id: "g/x.md", label: "x" }],
	};
	const list = menuNoteList(droste, menuNotesMemb);
	ok(
		list.length === 2 &&
			(list[0].memberships ?? []).join(",") === "a,b" &&
			(list[1].memberships ?? []).join(",") === "c",
		"menuNoteList: memberships taken from universal menuNotes, not from laid",
	);
}

// ── BUG FIXES regression tests ───────────────────────────────────────────────

// Bug #2: buildFolderTree with Euler-nested-copy ids (`${tag}\t${path}`).
// These ids are produced by the Euler/bubbles layout when a note appears in
// N intersection regions; the folder tree must split on the PATH (after the tab)
// not the whole string, so the hierarchy shows the real vault structure.
{
	// Two Euler copies of the same file appearing in two different tag intersections.
	const notes: NoteRef[] = [
		{ id: "tagA\tnotes/MyNote.md", label: "MyNote", memberships: ["tagA"] },
		{ id: "tagB\tnotes/MyNote.md", label: "MyNote", memberships: ["tagB"] },
		{ id: "notes/Other.md", label: "Other", memberships: ["tagB"] },
	];
	const t = buildFolderTree(notes);
	// Folder should be "notes", NOT the corrupted "tagA\tnotes".
	ok(!t.folders.has("tagA\tnotes"), "buildFolderTree: Euler copy must NOT produce a 'tag\\tnotes' folder");
	ok(t.folders.has("notes"), "buildFolderTree: Euler copy path → correct 'notes' folder");
	// Both copies + plain note appear under "notes".
	const leaves = leavesAt(t, ["notes"]);
	ok(leaves.length === 3, "buildFolderTree: Euler copies and plain note all under 'notes' (3 leaves)");
	// Labels are the real filename segment (not the full id with tab prefix).
	const labels = t.folders.get("notes")!.leaves.map((l) => l.label).sort().join(",");
	ok(labels === "MyNote.md,MyNote.md,Other.md", "buildFolderTree: leaf labels are real filenames (no tag prefix)");
}

// Bug #2b: searchNotes deduplicates Euler-copy ids by the underlying path,
// so the same file appearing twice (under two tags) produces ONE search result.
{
	const notes: NoteRef[] = [
		{ id: "tagA\tnotes/MyNote.md", label: "MyNote", memberships: ["tagA"] },
		{ id: "tagB\tnotes/MyNote.md", label: "MyNote", memberships: ["tagB"] },
		{ id: "notes/Other.md", label: "Other", memberships: ["tagB"] },
	];
	const hits = searchNotes(notes, "MyNote");
	ok(hits.length === 1, "searchNotes: Euler-copy duplicates of same file dedupe to ONE result");
	ok(hits[0].id === "tagA\tnotes/MyNote.md", "searchNotes: first occurrence's id is kept");
}

// Deduplication by path also works when both copies have the same raw path (no prefix).
{
	const notes: NoteRef[] = [
		{ id: "Area/a.md", label: "a", memberships: ["x"] },
		{ id: "Area/a.md", label: "a", memberships: ["y"] },
	];
	const hits = searchNotes(notes, "Area");
	ok(hits.length === 1, "searchNotes: plain-id duplicate dedupe to ONE result");
}

// Bug #3 (padding order) is DOM-only and verified by code review — no unit test needed.
// The fix swaps the Object.assign key order so padding (shorthand) is applied first
// and paddingLeft (depth indent) overwrites it last, restoring tree indentation.

// ── ADVANCED search ──────────────────────────────────────────────────────────
// A representative note set carrying tags + frontmatter (as rebuild() now does).
const advNotes: NoteRef[] = [
	{
		id: "proj/alpha.md", label: "Alpha", path: "proj/alpha.md",
		memberships: ["tag=proj"],
		tags: ["proj", "proj/alpha", "status/active"],
		frontmatter: { status: ["active"], priority: ["high"], owner: ["Ann"] },
	},
	{
		id: "proj/beta.md", label: "Beta", path: "proj/beta.md",
		memberships: ["tag=proj"],
		tags: ["proj", "draft"],
		frontmatter: { status: ["done"], owner: ["Bob"] },
	},
	{
		id: "notes/gamma.md", label: "Gamma", path: "notes/gamma.md",
		memberships: [],
		tags: ["project"], // note: "project" must NOT match "#proj" prefix
		frontmatter: { priority: ["low"] },
	},
	{
		id: "notes/project-plan.md", label: "Project Plan", path: "notes/project-plan.md",
		memberships: [],
		tags: ["project"],
		frontmatter: { priority: ["mid"] },
	},
];

// #tag — hierarchical PREFIX match (#proj matches proj and proj/alpha, NOT project).
{
	const hits = advancedSearch(advNotes, "#proj");
	const ids = hits.map((h) => h.id).sort().join(",");
	ok(ids === "proj/alpha.md,proj/beta.md", "advancedSearch: #proj prefix-matches proj & proj/alpha, not 'project'");
	const sub = advancedSearch(advNotes, "#proj/alpha").map((h) => h.id).join(",");
	ok(sub === "proj/alpha.md", "advancedSearch: #proj/alpha matches the hierarchical child only");
}

// key:value — substring match on a frontmatter value (case-insensitive).
{
	const hits = advancedSearch(advNotes, "status:act");
	ok(hits.length === 1 && hits[0].id === "proj/alpha.md", "advancedSearch: key:value substring match");
	ok(advancedSearch(advNotes, "STATUS:Done")[0].id === "proj/beta.md", "advancedSearch: key+value both case-insensitive");
}

// key: (empty value) — note merely HAS that frontmatter key.
{
	const ids = advancedSearch(advNotes, "owner:").map((h) => h.id).sort().join(",");
	ok(ids === "proj/alpha.md,proj/beta.md", "advancedSearch: 'key:' matches presence of the key");
	ok(advancedSearch(advNotes, "missingkey:").length === 0, "advancedSearch: 'key:' for absent key → none");
}

// bare word — substring of label OR path.
{
	ok(advancedSearch(advNotes, "alpha").map((h) => h.id).join(",") === "proj/alpha.md", "advancedSearch: bare word matches label/path");
	ok(advancedSearch(advNotes, "gamma").map((h) => h.id).join(",") === "notes/gamma.md", "advancedSearch: bare word matches path segment");
}

// AND of multiple terms — all must match.
{
	const hits = advancedSearch(advNotes, "#proj status:active");
	ok(hits.length === 1 && hits[0].id === "proj/alpha.md", "advancedSearch: AND of #tag + key:value");
	ok(advancedSearch(advNotes, "#proj priority:low").length === 0, "advancedSearch: AND fails when one term misses");
}

// Negation — leading '-' excludes.
{
	const ids = advancedSearch(advNotes, "#proj -#draft").map((h) => h.id).sort().join(",");
	ok(ids === "proj/alpha.md", "advancedSearch: -#draft excludes the drafted note");
	ok(advancedSearch(advNotes, "-status:done").map((h) => h.id).sort().join(",") === "notes/gamma.md,notes/project-plan.md,proj/alpha.md", "advancedSearch: -key:value excludes matching notes");
	ok(advancedSearch(advNotes, "-alpha").map((h) => h.id).sort().join(",") === "notes/gamma.md,notes/project-plan.md,proj/beta.md", "advancedSearch: -word excludes label/path match");
}

// unique-by-path — Euler copies of one file collapse to a single result.
{
	const dup: NoteRef[] = [
		{ id: "tagA\tproj/alpha.md", label: "Alpha", path: "proj/alpha.md", tags: ["proj"], frontmatter: {} },
		{ id: "tagB\tproj/alpha.md", label: "Alpha", path: "proj/alpha.md", tags: ["proj"], frontmatter: {} },
	];
	const hits = advancedSearch(dup, "#proj");
	ok(hits.length === 1, "advancedSearch: Euler copies dedupe to ONE result (unique-by-path)");
	ok(hits[0].id === "tagA\tproj/alpha.md", "advancedSearch: first occurrence id kept");
}

// empty query → [].
{
	ok(advancedSearch(advNotes, "").length === 0, "advancedSearch: empty query → []");
	ok(advancedSearch(advNotes, "   ").length === 0, "advancedSearch: blank query → []");
}

// Robust when tags/frontmatter are absent (undefined) — bare word still works.
{
	const bare: NoteRef[] = [{ id: "x/foo.md", label: "Foo" }];
	ok(advancedSearch(bare, "foo")[0].id === "x/foo.md", "advancedSearch: missing tags/fm → bare word still matches");
	ok(advancedSearch(bare, "#anything").length === 0, "advancedSearch: missing tags → #tag matches nothing");
	ok(advancedSearch(bare, "k:v").length === 0, "advancedSearch: missing frontmatter → key:value matches nothing");
}

// ── currentToken ─────────────────────────────────────────────────────────────
{
	ok(currentToken("#pr") === "#pr", "currentToken: whole string when no space");
	ok(currentToken("#proj stat") === "stat", "currentToken: substring after last space");
	ok(currentToken("done ") === "", "currentToken: trailing space → empty token");
}

// ── applySuggestionToken ─────────────────────────────────────────────────────
{
	// Tag/note completions replace the trailing token and add a closing space.
	ok(
		applySuggestionToken("#pro", "#project") === "#project ",
		"applySuggestionToken: tag replaces token + trailing space",
	);
	ok(
		applySuggestionToken("#proj sta", "status") === "#proj status ",
		"applySuggestionToken: only the last token is replaced",
	);
	// "key:" completions keep no space so the value can keep being typed.
	ok(
		applySuggestionToken("stat", "status:") === "status:",
		"applySuggestionToken: key: completion adds no trailing space",
	);
	// Empty token (trailing space) → suggestion is appended.
	ok(
		applySuggestionToken("#done ", "#project") === "#done #project ",
		"applySuggestionToken: empty token appends after the space",
	);
}

// ── suggestQuery ─────────────────────────────────────────────────────────────

// #tag partial → distinct matching tags, with '#', sorted, kind "tag".
{
	const sugs = suggestQuery(advNotes, "#pro");
	const texts = sugs.map((s) => s.text);
	ok(sugs.every((s) => s.kind === "tag"), "suggestQuery: #partial → all kind 'tag'");
	ok(texts.includes("#proj") && texts.includes("#proj/alpha") && texts.includes("#project"), "suggestQuery: #pro suggests proj, proj/alpha, project");
	// Sorted alpha.
	ok(JSON.stringify(texts) === JSON.stringify([...texts].sort()), "suggestQuery: tag suggestions sorted");
}

// key:partial → distinct VALUES of that key, rendered key:value, kind "field".
{
	const sugs = suggestQuery(advNotes, "status:");
	const texts = sugs.map((s) => s.text).sort();
	ok(sugs.every((s) => s.kind === "field"), "suggestQuery: key:partial → kind 'field'");
	ok(texts.join(",") === "status:active,status:done", "suggestQuery: status: suggests its distinct values");
	ok(suggestQuery(advNotes, "status:do").map((s) => s.text).join(",") === "status:done", "suggestQuery: key:partial filters values by substring");
}

// bare token → merged keys (key:) + tags (#tag) + note labels, with kinds.
{
	const sugs = suggestQuery(advNotes, "pro");
	const kinds = new Set(sugs.map((s) => s.kind));
	ok(kinds.has("tag"), "suggestQuery: bare 'pro' includes tag suggestions (#proj…)");
	ok(kinds.has("note"), "suggestQuery: bare 'pro' includes note-label suggestions (Project Plan)");
	ok(sugs.some((s) => s.kind === "note" && s.text === "Project Plan"), "suggestQuery: bare token yields the matching note label");
	// A bare token matching a frontmatter KEY surfaces it as 'key:' (kind field).
	const keySugs = suggestQuery(advNotes, "owne");
	ok(keySugs.some((s) => s.kind === "field" && s.text === "owner:"), "suggestQuery: bare 'owne' suggests 'owner:' key (kind field)");
	// Deterministic order: kind priority tag < field < note, then alpha.
	const mixed = suggestQuery(advNotes, "o"); // matches owner key, proj tags, and labels
	const ranks = mixed.map((s) => ({ tag: 0, field: 1, note: 2 }[s.kind]));
	ok(JSON.stringify(ranks) === JSON.stringify([...ranks].sort((a, b) => a - b)), "suggestQuery: kind-priority ordering (tag<field<note)");
}

// caps — at most ~8 for tag/field, ~10 merged for bare.
{
	const many: NoteRef[] = [];
	for (let i = 0; i < 30; i++) {
		many.push({ id: `t${i}.md`, label: `T${i}`, path: `t${i}.md`, tags: [`tagx${String(i).padStart(2, "0")}`], frontmatter: { f: [`v${i}`] } });
	}
	ok(suggestQuery(many, "#tagx").length <= 8, "suggestQuery: tag suggestions capped at ~8");
	ok(suggestQuery(many, "f:").length <= 8, "suggestQuery: field-value suggestions capped at ~8");
	ok(suggestQuery(many, "t").length <= 10, "suggestQuery: bare merged suggestions capped at ~10");
}

// empty token → [].
{
	ok(suggestQuery(advNotes, "").length === 0, "suggestQuery: empty query → []");
	ok(suggestQuery(advNotes, "#proj ").length === 0, "suggestQuery: trailing space (empty token) → []");
}

// `searchNotes` is retained (legacy) — a quick smoke check it still works.
{
	ok(searchNotes(advNotes, "alpha").length === 1, "searchNotes: legacy function still operational");
}

// ── PER-ROW GRAPH-VISIBILITY CHECKBOXES ──────────────────────────────────────
// Pure logic powering the navigator's per-row hide-from-graph checkboxes.

// hideKey: a note's persisted hide key is its real PATH (Euler tab prefix off).
{
	ok(hideKey({ id: "Area/a.md", label: "a" }) === "Area/a.md", "hideKey: plain id → path itself");
	ok(hideKey({ id: "tagA\tnotes/MyNote.md", label: "MyNote" }) === "notes/MyNote.md", "hideKey: Euler copy → underlying path");
}

// nodeIsHidden: an on-canvas id is hidden if its FULL id OR its PATH is in the set.
// This is what makes a single PATH entry hide every `${tag}\t${path}` copy.
{
	// Path entry hides ALL Euler copies of the same file.
	const byPath = new Set(["notes/MyNote.md"]);
	ok(nodeIsHidden("tagA\tnotes/MyNote.md", byPath), "nodeIsHidden: path entry hides Euler copy A");
	ok(nodeIsHidden("tagB\tnotes/MyNote.md", byPath), "nodeIsHidden: path entry hides Euler copy B");
	ok(nodeIsHidden("notes/MyNote.md", byPath), "nodeIsHidden: path entry hides the plain-id node");
	ok(!nodeIsHidden("notes/Other.md", byPath), "nodeIsHidden: unrelated node stays visible");
	// Legacy raw-id entry (per-card panel) still matches that exact id.
	const byId = new Set(["tagA\tnotes/MyNote.md"]);
	ok(nodeIsHidden("tagA\tnotes/MyNote.md", byId), "nodeIsHidden: legacy raw-id entry matches exact id");
	ok(!nodeIsHidden("tagB\tnotes/MyNote.md", byId), "nodeIsHidden: raw-id entry does NOT hide the other copy");
}

// bulkSetHidden: the Select-all / Deselect-all transform on `hiddenNodes`.
{
	// Deselect all (hide=true): append every key not already present, de-duped,
	// preserving original order then push order.
	ok(
		JSON.stringify(bulkSetHidden(["x.md"], ["a.md", "b.md"], true)) ===
			JSON.stringify(["x.md", "a.md", "b.md"]),
		"bulkSetHidden hide: appends new keys after existing in push order",
	);
	ok(
		JSON.stringify(bulkSetHidden(["a.md"], ["a.md", "b.md"], true)) ===
			JSON.stringify(["a.md", "b.md"]),
		"bulkSetHidden hide: skips keys already present (dedup)",
	);
	// Select all (hide=false): remove every listed key, keeping the rest in order.
	ok(
		JSON.stringify(bulkSetHidden(["a.md", "x.md", "b.md"], ["a.md", "b.md"], false)) ===
			JSON.stringify(["x.md"]),
		"bulkSetHidden show: removes listed keys, preserves remaining order",
	);
	ok(
		JSON.stringify(bulkSetHidden(["x.md"], ["a.md"], false)) === JSON.stringify(["x.md"]),
		"bulkSetHidden show: removing an absent key is a no-op",
	);
	// Purity: the input array is never mutated.
	const input = ["a.md"];
	bulkSetHidden(input, ["b.md"], true);
	bulkSetHidden(input, ["a.md"], false);
	ok(JSON.stringify(input) === JSON.stringify(["a.md"]), "bulkSetHidden: input array is not mutated");
}

// LAYOUT-LEVEL CHECK (DOM-less): a PATH in the hidden set removes EVERY on-canvas
// copy of that note from a laid result. Mirrors filterLayoutData's filter
// (`!nodeIsHidden(id, hiddenSet)`) so we assert the hide actually drops nodes.
{
	const laidNodes = [
		{ id: "tagA\tnotes/MyNote.md" },
		{ id: "tagB\tnotes/MyNote.md" },
		{ id: "notes/Other.md" },
	];
	const hidden = new Set([hideKey({ id: "tagA\tnotes/MyNote.md", label: "MyNote" })]); // = "notes/MyNote.md"
	const kept = laidNodes.filter((n) => !nodeIsHidden(n.id, hidden)).map((n) => n.id);
	ok(kept.length === 1 && kept[0] === "notes/Other.md", "filter: a path in hiddenNodes removes ALL canvas copies of the note");
}

// collectDescendantNoteKeys: de-duplicated note PATH keys under a node,
// recursively across NESTED folders AND combination subgroups.
{
	// Folder tree: nested folders, one leaf per note.
	const folderNotes: NoteRef[] = [
		{ id: "Area/Sub/a.md", label: "a" },
		{ id: "Area/Sub/b.md", label: "b" },
		{ id: "Area/c.md", label: "c" },
	];
	const ft = buildFolderTree(folderNotes);
	const areaKeys = collectDescendantNoteKeys(ft.folders.get("Area")!).sort();
	ok(areaKeys.join(",") === "Area/Sub/a.md,Area/Sub/b.md,Area/c.md", "collectDescendantNoteKeys: nested folders collected recursively");

	// Tag tree: a {a,b} combo note appears under BOTH #a and #b. Collecting under
	// #a returns its path ONCE (even though it's nested in a combo subgroup).
	const tagNotes: NoteRef[] = [
		{ id: "n1.md", label: "n1", memberships: ["a", "b"] },
		{ id: "n2.md", label: "n2", memberships: ["a"] },
	];
	const tt = buildTagTree(tagNotes);
	const aKeys = collectDescendantNoteKeys(tt.folders.get("a")!).sort();
	ok(aKeys.join(",") === "n1.md,n2.md", "collectDescendantNoteKeys: combo subgroup + direct leaf under #a both collected");
	// The whole tag tree collects each distinct note ONCE despite cross-group dupes
	// (n1 is under #a AND #b).
	const allKeys = collectDescendantNoteKeys(tt).sort();
	ok(allKeys.join(",") === "n1.md,n2.md", "collectDescendantNoteKeys: cross-group note deduped to a single key");
}

// collectDescendantNoteKeys: Euler copies under one folder collapse to ONE key.
{
	const notes: NoteRef[] = [
		{ id: "tagA\tnotes/MyNote.md", label: "MyNote", memberships: ["tagA"] },
		{ id: "tagB\tnotes/MyNote.md", label: "MyNote", memberships: ["tagB"] },
		{ id: "notes/Other.md", label: "Other", memberships: ["tagB"] },
	];
	const ft = buildFolderTree(notes);
	const keys = collectDescendantNoteKeys(ft.folders.get("notes")!).sort();
	ok(keys.join(",") === "notes/MyNote.md,notes/Other.md", "collectDescendantNoteKeys: Euler copies dedupe to one path key");
}

// folderCheckState: tri-state over descendant keys.
{
	const keys = ["a.md", "b.md", "c.md"];
	ok(folderCheckState(keys, new Set()) === "checked", "folderCheckState: none hidden → checked");
	ok(folderCheckState(keys, new Set(["a.md", "b.md", "c.md"])) === "unchecked", "folderCheckState: all hidden → unchecked");
	ok(folderCheckState(keys, new Set(["b.md"])) === "indeterminate", "folderCheckState: some hidden → indeterminate");
	// Empty group → defaults checked (no descendants).
	ok(folderCheckState([], new Set(["x"])) === "checked", "folderCheckState: empty group → checked");
}

// CASCADE semantics: toggling a fully-checked folder hides ALL descendants;
// toggling an indeterminate/unchecked folder shows ALL. Modelled with a plain
// Set mutation that mirrors the view's per-key toggleArrayMember loop.
{
	const keys = ["a.md", "b.md", "c.md"];
	const hidden = new Set<string>();
	// fully checked → cascade HIDE all.
	const wasChecked1 = folderCheckState(keys, hidden) === "checked";
	for (const k of keys) { if (wasChecked1) hidden.add(k); else hidden.delete(k); }
	ok(folderCheckState(keys, hidden) === "unchecked", "cascade: checked folder → uncheck-all (all hidden)");
	// now unchecked → cascade SHOW all.
	const wasChecked2 = folderCheckState(keys, hidden) === "checked";
	for (const k of keys) { if (wasChecked2) hidden.add(k); else hidden.delete(k); }
	ok(folderCheckState(keys, hidden) === "checked", "cascade: unchecked folder → check-all (all visible)");
	// indeterminate → cascade SHOW all (not "checked", so hide=false branch).
	hidden.clear(); hidden.add("b.md");
	ok(folderCheckState(keys, hidden) === "indeterminate", "cascade: precondition mixed → indeterminate");
	const wasChecked3 = folderCheckState(keys, hidden) === "checked";
	for (const k of keys) { if (wasChecked3) hidden.add(k); else hidden.delete(k); }
	ok(folderCheckState(keys, hidden) === "checked", "cascade: indeterminate folder → check-all (all visible)");
}

// MENU STILL LISTS A HIDDEN NOTE: the displayed list is the universal menuNotes,
// independent of hiddenNodes — a hidden note must still appear (so it can be
// re-checked). menuNoteList never consults the hidden set.
{
	const universe: NoteRef[] = [
		{ id: "keep.md", label: "keep" },
		{ id: "hidden.md", label: "hidden" },
	];
	// Even though "hidden.md" is hidden from the graph, the navigator list keeps it.
	const listed = menuNoteList({ drosteGallery: null, nodes: [] }, universe).map((n) => n.id).sort();
	ok(listed.join(",") === "hidden.md,keep.md", "menu list includes a hidden note (still re-checkable)");
}

// ── HIDE-KEY CONSISTENCY REGRESSION TESTS ────────────────────────────────────
// The LEAF checkbox and the FOLDER CASCADE must use the SAME hide key so:
//   (a) toggling a leaf and toggling its parent folder agree on the note's state,
//   (b) a note hidden by path (navigator) is correctly detected by folderCheckState,
//   (c) Euler-copy ids (`${tag}\t${path}`) collapse to the same path key as plain ids.

// (a) Leaf key == folder-cascade key for a plain-path note.
//     hideKey(note) === the key written to hiddenNodes by a leaf checkbox toggle
//     === the key read by collectDescendantNoteKeys used in folderCheckState.
{
	const note: NoteRef = { id: "Area/a.md", label: "a" };
	const leafKey = hideKey(note);               // what a leaf checkbox writes
	const ft = buildFolderTree([note]);
	const areaNode = ft.folders.get("Area")!;
	const cascadeKeys = collectDescendantNoteKeys(areaNode); // what a folder cascade operates on

	ok(leafKey === "Area/a.md", "hide-key consistency: plain-path note's hideKey is its id");
	ok(cascadeKeys.length === 1 && cascadeKeys[0] === leafKey,
		"hide-key consistency: leaf key equals the key in collectDescendantNoteKeys");
}

// (b) Leaf key == folder-cascade key for an Euler-copy note (`${tag}\t${path}`).
//     Both must collapse to the same path so hiding via the leaf and hiding via
//     the folder cascade agree.
{
	const eulerNote: NoteRef = { id: "tagA\tnotes/MyNote.md", label: "MyNote" };
	const leafKey = hideKey(eulerNote);           // what a leaf checkbox writes
	const ft = buildFolderTree([eulerNote]);
	const notesNode = ft.folders.get("notes")!;
	const cascadeKeys = collectDescendantNoteKeys(notesNode);

	ok(leafKey === "notes/MyNote.md", "hide-key consistency: Euler-copy leafKey is the underlying path");
	ok(cascadeKeys.length === 1 && cascadeKeys[0] === leafKey,
		"hide-key consistency: Euler-copy cascade key equals the leaf key");
}

// (c) A note hidden by LEAF toggle is correctly seen by folderCheckState
//     (i.e. the folder shows as "unchecked" after all its leaves are hidden).
{
	const notes: NoteRef[] = [
		{ id: "Area/a.md", label: "a" },
		{ id: "Area/b.md", label: "b" },
	];
	const ft = buildFolderTree(notes);
	const areaNode = ft.folders.get("Area")!;
	const cascadeKeys = collectDescendantNoteKeys(areaNode);

	// Simulate leaf toggle writing hideKey(n) for each note.
	const hidden = new Set<string>();
	for (const n of notes) hidden.add(hideKey(n));

	// The folder should now read as "unchecked" (all hidden).
	ok(folderCheckState(cascadeKeys, hidden) === "unchecked",
		"hide-key consistency: notes hidden via leaf key → folder reads 'unchecked'");

	// Show one note via leaf toggle.
	hidden.delete(hideKey(notes[0]));
	ok(folderCheckState(cascadeKeys, hidden) === "indeterminate",
		"hide-key consistency: one note unhidden → folder reads 'indeterminate'");

	// Show all via leaf toggle.
	hidden.clear();
	ok(folderCheckState(cascadeKeys, hidden) === "checked",
		"hide-key consistency: all notes unhidden → folder reads 'checked'");
}

// (d) A folder cascade toggle (which writes the same keys as collectDescendantNoteKeys)
//     is reflected correctly in leaf checkbox state (which reads hideKey(note)).
//     i.e. after a folder cascade hides all its leaves, each leaf's hideKey IS
//     in the hidden set → leaf checkboxes read unchecked.
{
	const notes: NoteRef[] = [
		{ id: "Proj/alpha.md", label: "alpha" },
		{ id: "Proj/beta.md", label: "beta" },
	];
	const ft = buildFolderTree(notes);
	const projNode = ft.folders.get("Proj")!;
	const cascadeKeys = collectDescendantNoteKeys(projNode); // what folder cascade writes

	// Folder cascade hides all (wasChecked → hide=true → add all cascade keys).
	const hidden = new Set<string>(cascadeKeys);

	// Each leaf's hideKey must now be in the hidden set.
	for (const n of notes) {
		ok(hidden.has(hideKey(n)),
			`hide-key consistency: after folder cascade, leaf "${n.id}" is hidden`);
	}
}

// (e) Tag-tree combo leaf key matches the cascade key (multi-group note).
//     A note with memberships ["a","b"] appears under both #a and #b via a combo
//     subgroup. Its hide key from the leaf must equal what the cascade writes.
{
	const comboNote: NoteRef = { id: "shared.md", label: "shared", memberships: ["a", "b"] };
	const tt = buildTagTree([comboNote]);
	const aNode = tt.folders.get("a")!;
	const cascadeKeysUnderA = collectDescendantNoteKeys(aNode);

	const leafKey = hideKey(comboNote);
	ok(cascadeKeysUnderA.length === 1 && cascadeKeysUnderA[0] === leafKey,
		"hide-key consistency: tag-tree combo note's cascade key equals its leafKey");
}

// (f) nodeIsHidden correctly handles both PATH entries (from navigator) and
//     RAW-ID entries (from old per-card panel), so both flavours hide the node.
{
	const pathEntry = new Set(["Area/a.md"]);
	const rawEntry = new Set(["tagX\tArea/a.md"]);

	// Path entry hides both the plain node and any Euler copy.
	ok(nodeIsHidden("Area/a.md", pathEntry), "nodeIsHidden: path entry hides plain node");
	ok(nodeIsHidden("tagX\tArea/a.md", pathEntry), "nodeIsHidden: path entry hides Euler copy");

	// Raw-id entry hides exactly that Euler copy, but NOT the plain path or a different copy.
	ok(nodeIsHidden("tagX\tArea/a.md", rawEntry), "nodeIsHidden: raw-id entry hides exact Euler copy");
	ok(!nodeIsHidden("Area/a.md", rawEntry), "nodeIsHidden: raw-id entry does NOT hide the plain node");
	ok(!nodeIsHidden("tagY\tArea/a.md", rawEntry), "nodeIsHidden: raw-id entry does NOT hide a different copy");
}

// ── buildFolderPathKey: stable path-key for the navigator tree ───────────────
// This key is used in two places that must agree:
//   1. renderTree() stamps data-menupath=<key> on each folder row element.
//   2. removeNoteMenu() reads those attributes to record which folders were open.
//   3. ensureNoteMenu() checks noteMenuExpandedPaths.has(key) to re-open folders.
// The key rules are: top-level = the Map key itself; nested = parent/child.
{
	// Top-level folder: empty parentPath → key is the name itself.
	ok(buildFolderPathKey("", "Area") === "Area", "buildFolderPathKey: top-level folder key = name");
	ok(buildFolderPathKey("", "(untagged)") === "(untagged)", "buildFolderPathKey: top-level untagged bucket");
	ok(buildFolderPathKey("", "tag=proj") === "tag=proj", "buildFolderPathKey: top-level tag tree key");

	// Nested folder: parentPath/name.
	ok(buildFolderPathKey("Area", "Sub") === "Area/Sub", "buildFolderPathKey: one level of nesting");
	ok(buildFolderPathKey("Area/Sub", "Deep") === "Area/Sub/Deep", "buildFolderPathKey: two levels of nesting");

	// Combo subgroup key (tag tree): parent is a tag key, child is a combo:xxxx key.
	ok(buildFolderPathKey("tag=proj", "combo:aabb") === "tag=proj/combo:aabb", "buildFolderPathKey: tag-tree combo subgroup key");
}

// ── STATE-PRESERVATION CONTRACT (pure invariant) ─────────────────────────────
// Regression tests for the folder-expand / checkbox-toggle state preservation.
// The DOM mechanism works like this:
//   • User opens folder "Area/Sub" → kids div visible, row.dataset.menupath="Area/Sub".
//   • A vault change triggers rebuild() → removeNoteMenu() is called.
//     removeNoteMenu reads every [data-menupath] row whose kids sibling is visible
//     → records {"Area/Sub"} in noteMenuExpandedPaths.
//   • ensureNoteMenu() runs draw() → renderTree() checks
//     noteMenuExpandedPaths.has(folderPath) and calls openFolder() for matches.
//   • Result: "Area/Sub" is open after rebuild, scroll position restored.
//
// The pure invariant is: a folder whose path key is in the expanded set is
// exactly the path built by successive buildFolderPathKey calls as renderTree
// descends.
{
	// Build a two-level folder tree and verify the path keys renderTree would use.
	const notes: NoteRef[] = [
		{ id: "Area/Sub/a.md", label: "a" },
		{ id: "Area/Sub/b.md", label: "b" },
		{ id: "Area/c.md", label: "c" },
		{ id: "d.md", label: "d" },
	];
	const ft = buildFolderTree(notes);

	// Top-level folders of ft: "Area" and the root-level leaf "d.md" (root leaves have no folder).
	// renderTree visits folders first, then leaves.
	// For folder "Area": key = buildFolderPathKey("", "Area") = "Area".
	// For folder "Sub" under "Area": key = buildFolderPathKey("Area", "Sub") = "Area/Sub".
	const areaKey = buildFolderPathKey("", "Area");
	ok(areaKey === "Area", "state-preservation: top-level 'Area' key matches data-menupath");
	ok(ft.folders.has("Area"), "state-preservation: tree has 'Area' top-level folder");

	const subKey = buildFolderPathKey(areaKey, "Sub");
	ok(subKey === "Area/Sub", "state-preservation: nested 'Area/Sub' key is correct");
	ok(ft.folders.get("Area")!.folders.has("Sub"), "state-preservation: tree has 'Area/Sub' nested folder");

	// Verify that the keys in an expanded-set snapshot correctly identify the right tree nodes.
	const expandedPaths = new Set(["Area", "Area/Sub"]);
	// "Area" → top-level; exists.
	ok(expandedPaths.has(buildFolderPathKey("", "Area")), "state-preservation: snapshot 'Area' found at top level");
	// "Area/Sub" → nested; exists.
	ok(expandedPaths.has(buildFolderPathKey("Area", "Sub")), "state-preservation: snapshot 'Area/Sub' found at depth 1");
	// A folder NOT in the snapshot (e.g. a different sibling) is not restored.
	ok(!expandedPaths.has(buildFolderPathKey("", "Other")), "state-preservation: unlisted folder NOT in snapshot");
}

// ── suggestKeyAction: search-box dropdown keyboard reducer ───────────────────
// Pure transition mirroring the keydown handler in view.ts. `open` implies the
// dropdown is shown WITH suggestions (count > 0).
{
	const closed = { open: false, selIdx: -1, count: 0 };
	const openTop = { open: true, selIdx: -1, count: 3 };
	const openSel1 = { open: true, selIdx: 1, count: 3 };

	// ArrowDown closed → open the dropdown (no preventDefault action).
	ok(suggestKeyAction("ArrowDown", closed).type === "open", "suggestKey: ArrowDown closed → open");

	// ArrowDown open → move highlight forward (wraps), preventing default.
	const dn = suggestKeyAction("ArrowDown", openSel1);
	ok(dn.type === "move" && dn.selIdx === 2 && dn.preventDefault === true, "suggestKey: ArrowDown open → move to next");
	const dnWrap = suggestKeyAction("ArrowDown", { open: true, selIdx: 2, count: 3 });
	ok(dnWrap.type === "move" && dnWrap.selIdx === 0, "suggestKey: ArrowDown wraps to 0 at end");
	const dnFromNone = suggestKeyAction("ArrowDown", openTop);
	ok(dnFromNone.type === "move" && dnFromNone.selIdx === 0, "suggestKey: ArrowDown from −1 → 0");

	// ArrowUp closed → nothing; open → move backward (wraps).
	ok(suggestKeyAction("ArrowUp", closed).type === "none", "suggestKey: ArrowUp closed → none");
	const up = suggestKeyAction("ArrowUp", openSel1);
	ok(up.type === "move" && up.selIdx === 0, "suggestKey: ArrowUp open → move to prev");
	const upWrap = suggestKeyAction("ArrowUp", { open: true, selIdx: 0, count: 3 });
	ok(upWrap.type === "move" && upWrap.selIdx === 2, "suggestKey: ArrowUp wraps to last from 0");

	// Enter with a highlighted row → accept that index; otherwise → run search.
	const acc = suggestKeyAction("Enter", openSel1);
	ok(acc.type === "accept" && acc.index === 1 && acc.preventDefault === true, "suggestKey: Enter highlighted → accept index");
	ok(suggestKeyAction("Enter", openTop).type === "search", "suggestKey: Enter open w/o highlight → search");
	ok(suggestKeyAction("Enter", closed).type === "search", "suggestKey: Enter closed → search");

	// Escape open → close (suppress default + propagation); closed → nothing.
	const esc = suggestKeyAction("Escape", openSel1);
	ok(esc.type === "close" && esc.preventDefault === true && esc.stopPropagation === true, "suggestKey: Escape open → close");
	ok(suggestKeyAction("Escape", closed).type === "none", "suggestKey: Escape closed → none");

	// Any other key is inert.
	ok(suggestKeyAction("a", openSel1).type === "none", "suggestKey: unrelated key → none");
}
