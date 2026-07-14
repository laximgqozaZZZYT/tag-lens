import assert from "node:assert/strict";
import test from "node:test";
import { rebuildSignature } from "../src/layout/rebuild-signature";
import { DEFAULT_SETTINGS, type GraphData } from "../src/types";

const node = (id: string, label = id, memberships: string[] = []) => ({
	id,
	label,
	memberships,
});

const data = (
	nodes: GraphData["nodes"],
	edges: GraphData["edges"] = [],
): GraphData => ({ nodes, edges });

test("identical inputs sign identically", () => {
	const c = new Map([["k", "K"]]);
	const a = rebuildSignature(data([node("a")], [{ source: "a", target: "b" }]), c, DEFAULT_SETTINGS);
	const b = rebuildSignature(data([node("a")], [{ source: "a", target: "b" }]), c, DEFAULT_SETTINGS);
	assert.equal(a, b);
});

test("a changed node id/label/membership flips the signature", () => {
	const c = new Map<string, string>();
	const base = rebuildSignature(data([node("a", "A", ["x"])]), c, DEFAULT_SETTINGS);
	assert.notEqual(rebuildSignature(data([node("z", "A", ["x"])]), c, DEFAULT_SETTINGS), base);
	assert.notEqual(rebuildSignature(data([node("a", "Z", ["x"])]), c, DEFAULT_SETTINGS), base);
	assert.notEqual(rebuildSignature(data([node("a", "A", ["y"])]), c, DEFAULT_SETTINGS), base);
});

test("a changed edge endpoint flips the signature", () => {
	const c = new Map<string, string>();
	const base = rebuildSignature(data([node("a")], [{ source: "a", target: "b" }]), c, DEFAULT_SETTINGS);
	assert.notEqual(
		rebuildSignature(data([node("a")], [{ source: "a", target: "c" }]), c, DEFAULT_SETTINGS),
		base,
	);
});

test("a changed cluster label flips the signature", () => {
	const base = rebuildSignature(data([node("a")]), new Map([["k", "K"]]), DEFAULT_SETTINGS);
	assert.notEqual(rebuildSignature(data([node("a")]), new Map([["k", "K2"]]), DEFAULT_SETTINGS), base);
});

test("a display-only settings toggle keeps the SAME signature", () => {
	const c = new Map<string, string>();
	const base = rebuildSignature(data([node("a")]), c, DEFAULT_SETTINGS);
	const toggled = { ...DEFAULT_SETTINGS, showNodes: !DEFAULT_SETTINGS.showNodes };
	assert.equal(rebuildSignature(data([node("a")]), c, toggled), base);
});

test("a layout-affecting settings change flips the signature", () => {
	const c = new Map<string, string>();
	const base = rebuildSignature(data([node("a")]), c, DEFAULT_SETTINGS);
	const changed = { ...DEFAULT_SETTINGS, viewMode: "lattice" as const };
	assert.notEqual(rebuildSignature(data([node("a")]), c, changed), base);
});

test("missing memberships default to an empty array (no throw)", () => {
	const c = new Map<string, string>();
	const bare = { id: "a", label: "a" } as unknown as GraphData["nodes"][number];
	const a = rebuildSignature(data([bare]), c, DEFAULT_SETTINGS);
	const b = rebuildSignature(data([node("a")]), c, DEFAULT_SETTINGS);
	assert.equal(a, b);
});

test("does not mutate its inputs", () => {
	const nodes = [node("a", "A", ["x"])];
	const edges = [{ source: "a", target: "b" }];
	const c = new Map([["k", "K"]]);
	const snapshot = JSON.stringify({ nodes, edges, c: [...c.entries()], s: DEFAULT_SETTINGS });
	rebuildSignature(data(nodes, edges), c, DEFAULT_SETTINGS);
	assert.equal(JSON.stringify({ nodes, edges, c: [...c.entries()], s: DEFAULT_SETTINGS }), snapshot);
});
