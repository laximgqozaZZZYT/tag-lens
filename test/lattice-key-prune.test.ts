import assert from "node:assert/strict";
import { test } from "node:test";
import { pruneLatticeKeys } from "../src/layout/lattice-key-prune";

test("pruneLatticeKeys keeps only named keys that survive the relayout", () => {
	const out = pruneLatticeKeys(["a", "b", "c"], ["a", "x", "c", "y"], null);
	assert.deepEqual([...out.namedKeys].sort(), ["a", "c"]);
	assert.equal(out.selectedKey, null);
});

test("pruneLatticeKeys keeps a surviving selected key", () => {
	const out = pruneLatticeKeys(["a", "b"], [], "b");
	assert.equal(out.selectedKey, "b");
});

test("pruneLatticeKeys clears a stale selected key", () => {
	const out = pruneLatticeKeys(["a", "b"], [], "gone");
	assert.equal(out.selectedKey, null);
});

test("pruneLatticeKeys leaves a null selection null", () => {
	const out = pruneLatticeKeys(["a"], [], null);
	assert.equal(out.selectedKey, null);
});

test("pruneLatticeKeys leaves an empty-string selection untouched (truthy guard)", () => {
	// Mirrors the view's original `selectedKey && !has(...)` short-circuit:
	// a falsy selection is never cleared even if absent from the node set.
	const out = pruneLatticeKeys(["a"], [], "");
	assert.equal(out.selectedKey, "");
});

test("pruneLatticeKeys does not mutate its inputs", () => {
	const named = new Set(["a", "x"]);
	const out = pruneLatticeKeys(["a"], named, "a");
	assert.deepEqual([...named].sort(), ["a", "x"]);
	assert.notEqual(out.namedKeys, named);
});

test("pruneLatticeKeys with no surviving nodes empties everything", () => {
	const out = pruneLatticeKeys([], ["a", "b"], "a");
	assert.equal(out.namedKeys.size, 0);
	assert.equal(out.selectedKey, null);
});
