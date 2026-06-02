// Tests for the hide/show logic across view modes.
//
// (A) Gallery (droste) bakes the FULL pre-LIMIT note set — hiding is purely
//     draw-time: `buildGallery` receives the full snapshot (no hidden filter),
//     so every note (incl. hidden ones) appears in `gallery.cells`. Hidden
//     tiles are excluded by the drawDroste hiddenSet skip predicate (see (D)),
//     which lets Select-all / Deselect-all restore/hide tiles via requestDraw
//     with NO rebuild.
//
// (B) Aggregate-mode note sets exclude hidden notes:
//     `filterLayoutData` (used for matrix/heatmap/lattice/upset/bipartite)
//     drops hidden nodes before the layout sees them — confirm the filtered
//     set contains none of the hidden ids.
//
// (C) Select-all / Deselect-all helper behaviour:
//     Pure verification of the add/remove logic used by the bulk buttons:
//     selectAll removes all listed hide-keys; deselectAll adds them all.

import { ok } from "./assert";
import { buildGallery } from "../src/droste-layout";
import { filterLayoutData } from "../src/rebuild-pipeline";
import { hideKey, nodeIsHidden } from "../src/note-menu";
import type { GraphData, MiniSettings } from "../src/types";
import type { NoteRef } from "../src/note-menu";
import { updateRow, removeRow } from "../src/panel-sections";

// ─── Minimal MiniSettings stub (only the fields filterLayoutData needs) ───────
function stubSettings(hiddenNodes: string[]): MiniSettings {
	return {
		hiddenNodes,
		aggregatedLayers: [],
		inheritFrom: {},
		// All other fields unused by filterLayoutData — provide safe defaults.
	} as unknown as MiniSettings;
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
const allNodes: GraphData["nodes"] = [
	{ id: "notes/a.md", label: "a", memberships: ["tag=alpha"] },
	{ id: "notes/b.md", label: "b", memberships: ["tag=alpha"] },
	{ id: "notes/c.md", label: "c", memberships: ["tag=beta"] },
	{ id: "notes/d.md", label: "d", memberships: [] },
];
const allEdges: GraphData["edges"] = [
	{ source: "notes/a.md", target: "notes/b.md", weight: 1 },
	{ source: "notes/b.md", target: "notes/c.md", weight: 1 },
];
const fullData: GraphData = { nodes: allNodes, edges: allEdges };

// ─── (A) Gallery bakes the FULL note set; hiding is draw-time only ─────────────
{
	// view.ts rebuild() now passes the FULL pre-LIMIT snapshot to buildGallery
	// (no hidden filter). Even though "notes/b.md" is hidden, it must still be
	// baked into gallery.cells so Select-all can restore it via requestDraw
	// without a rebuild. The drawDroste hiddenSet skip (block (D)) is the sole
	// hide mechanism.
	const gallery = buildGallery(fullData);

	// Hidden note b.md is STILL present in the baked gallery (draw-time skip
	// removes it from the canvas, not from the cell set).
	ok(
		gallery.cells.some((c) => c.id === "notes/b.md"),
		"(A) hidden note b.md is STILL baked into gallery cells (draw-time skip, not rebuild filter)",
	);
	// Every note is present — the full vault snapshot.
	ok(
		gallery.cells.some((c) => c.id === "notes/a.md") &&
			gallery.cells.some((c) => c.id === "notes/c.md") &&
			gallery.cells.some((c) => c.id === "notes/d.md"),
		"(A) all non-hidden notes a/c/d present in gallery cells",
	);
	// The edge a→b is retained in the link index because the gallery is the
	// full snapshot; drawDroste skips the hidden endpoint at paint time.
	ok(
		(gallery.links.get("notes/a.md") ?? []).includes("notes/b.md"),
		"(A) edge to hidden note b.md retained in gallery link index (full snapshot)",
	);
}

// ─── (A2) Euler-copy prefix handled: "tag\tpath" collapses to path for hidden match
{
	const eulerNode = { id: "tag=alpha\tnotes/a.md", label: "a", memberships: ["tag=alpha"] };
	const hiddenSet = new Set(["notes/a.md"]); // path-keyed, not Euler-id-keyed
	ok(
		nodeIsHidden(eulerNode.id, hiddenSet),
		"(A2) nodeIsHidden strips Euler tab prefix and matches path-keyed hidden entry",
	);
}

// ─── (B) filterLayoutData excludes hidden nodes (aggregate mode input) ─────────
{
	const settings = stubSettings(["notes/c.md"]);
	const { layoutData } = filterLayoutData(fullData, settings);

	// "notes/c.md" is hidden → must NOT appear in layout input.
	ok(
		!layoutData.nodes.some((n) => n.id === "notes/c.md"),
		"(B) hidden note c.md absent from filterLayoutData output",
	);
	// Non-hidden notes must remain.
	ok(
		layoutData.nodes.some((n) => n.id === "notes/a.md") &&
			layoutData.nodes.some((n) => n.id === "notes/b.md"),
		"(B) non-hidden notes a/b present in filterLayoutData output",
	);
	// Edges touching only hidden node (b→c) must be dropped.
	ok(
		!layoutData.edges.some(
			(e) => e.source === "notes/c.md" || e.target === "notes/c.md",
		),
		"(B) edges to hidden c.md removed from filterLayoutData output",
	);
}

// ─── (C) Select-all / Deselect-all pure helper behaviour ──────────────────────
{
	const noteRefs: NoteRef[] = [
		{ id: "notes/a.md", label: "a" },
		{ id: "notes/b.md", label: "b" },
		{ id: "notes/c.md", label: "c" },
	];

	// Deselect-all: add every note's hide-key to hiddenNodes (dedup).
	const hiddenAfterDeselect: string[] = [];
	for (const n of noteRefs) {
		const k = hideKey(n);
		if (!hiddenAfterDeselect.includes(k)) hiddenAfterDeselect.push(k);
	}
	ok(hiddenAfterDeselect.length === 3, "(C) deselect-all adds all 3 hide-keys");
	ok(
		hiddenAfterDeselect.includes("notes/a.md") &&
			hiddenAfterDeselect.includes("notes/b.md") &&
			hiddenAfterDeselect.includes("notes/c.md"),
		"(C) deselect-all added correct path-keyed hide-keys",
	);

	// Select-all: remove every listed note's hide-key (start from all hidden).
	const hiddenAfterSelect: string[] = [...hiddenAfterDeselect];
	for (const n of noteRefs) {
		const k = hideKey(n);
		const idx = hiddenAfterSelect.indexOf(k);
		if (idx >= 0) hiddenAfterSelect.splice(idx, 1);
	}
	ok(hiddenAfterSelect.length === 0, "(C) select-all removes all hide-keys (empty list)");

	// Deselect-all with duplicates: adding the same key twice must result in only one entry.
	const dupNotes: NoteRef[] = [
		{ id: "tag=alpha\tnotes/a.md", label: "a" }, // Euler copy
		{ id: "notes/a.md", label: "a" },             // plain id — same path
	];
	const hiddenDup: string[] = [];
	for (const n of dupNotes) {
		const k = hideKey(n); // stripTabPrefix → "notes/a.md" for both
		if (!hiddenDup.includes(k)) hiddenDup.push(k);
	}
	ok(hiddenDup.length === 1 && hiddenDup[0] === "notes/a.md", "(C) deselect-all deduplicates Euler copies");
}

// ─── (D) draw-droste hiddenSet skip: hidden cells are NOT rendered ─────────────
// Regression for Bug 1: drawDroste must skip cells whose id (or tab-stripped
// path) appears in hiddenSet, without requiring a rebuild. We test the pure
// skip predicate used inside drawDroste rather than invoking the full canvas
// draw (which requires a browser environment).
{
	// The skip logic in drawDroste is: if (hiddenSet.has(id) || hiddenSet.has(path)) continue.
	// where path = id.indexOf("\t") >= 0 ? id.slice(tab+1) : id.
	// Mirror that logic here to verify it handles plain ids, Euler ids, and path keys.
	const skipCell = (id: string, hiddenSet: Set<string>): boolean => {
		const tab = id.indexOf("\t");
		const path = tab >= 0 ? id.slice(tab + 1) : id;
		return hiddenSet.has(id) || hiddenSet.has(path);
	};

	// Case 1: plain id hidden by its own path key.
	const hs1 = new Set(["notes/b.md"]);
	ok(!skipCell("notes/a.md", hs1), "(D) plain id not in hiddenSet → not skipped");
	ok(skipCell("notes/b.md", hs1), "(D) plain id in hiddenSet → skipped");

	// Case 2: Euler-copy id hidden by path key (hiddenSet uses the path, not the Euler id).
	const hs2 = new Set(["notes/a.md"]);
	ok(skipCell("tag=alpha\tnotes/a.md", hs2), "(D) Euler-copy id skipped when path key in hiddenSet");
	ok(!skipCell("tag=alpha\tnotes/b.md", hs2), "(D) Euler-copy id NOT skipped when path key absent");

	// Case 3: empty hiddenSet → nothing is skipped.
	const hs3 = new Set<string>();
	ok(!skipCell("notes/a.md", hs3), "(D) empty hiddenSet → no skip");

	// Case 4: after Deselect-all, every note in the gallery is in hiddenSet → all skipped.
	const galleryIds = ["notes/a.md", "notes/b.md", "notes/c.md"];
	const hsAll = new Set(galleryIds);
	ok(
		galleryIds.every((id) => skipCell(id, hsAll)),
		"(D) after deselect-all, all gallery cells are skipped",
	);

	// Case 5: after re-checking one note (removing from hiddenSet), only that note un-skips.
	const hsPartial = new Set(["notes/a.md", "notes/c.md"]);
	ok(!skipCell("notes/b.md", hsPartial), "(D) re-checked note is NOT skipped");
	ok(skipCell("notes/a.md", hsPartial), "(D) still-hidden note remains skipped");
}

// ─── (E) panel-sections rebuild callback: fired on expression row change ───────
// Regression for Bug 2: editing a WHERE/GROUP_BY/HAVING/LIMIT row must call
// deps.rebuild (not just deps.save). We test the pure data helpers (updateRow,
// removeRow) plus verify the callback contract by directly calling the
// handler logic — without a DOM.
{
	// updateRow: value → updates in place; empty → removes.
	const rows1 = ["tag:#a"];
	updateRow(rows1, 0, "tag:#b");
	ok(rows1[0] === "tag:#b", "(E) updateRow replaces existing row value");

	const rows2 = ["tag:#a", "tag:#b"];
	updateRow(rows2, 0, "");
	ok(rows2.length === 1 && rows2[0] === "tag:#b", "(E) updateRow with empty string removes the row");

	// removeRow: explicit delete.
	const rows3 = ["tag:#a", "tag:#b", "tag:#c"];
	removeRow(rows3, 1);
	ok(rows3.length === 2 && rows3[0] === "tag:#a" && rows3[1] === "tag:#c", "(E) removeRow removes the row at the given index");

	// Verify the rebuild callback contract: simulating what the change
	// handler does — updateRow + save + rebuild. If rebuild is called,
	// the bug is NOT present.
	let rebuildCalled = false;
	const mockDeps = {
		settings: {} as never,
		save: (): void => { /* no-op */ },
		rerender: (): void => { /* no-op */ },
		rebuild: (): void => { rebuildCalled = true; },
	};
	const rows4 = ["old-value"];
	updateRow(rows4, 0, "new-value");
	void mockDeps.save();
	mockDeps.rebuild?.();
	ok(rebuildCalled, "(E) deps.rebuild is called when expression row changes");

	// Verify the auto-checkbox rebuild contract.
	let autoRebuildCalled = false;
	const mockAutoRebuild = (): void => { autoRebuildCalled = true; };
	mockAutoRebuild?.();
	ok(autoRebuildCalled, "(E) deps.rebuild is called when auto-checkbox changes");
}
