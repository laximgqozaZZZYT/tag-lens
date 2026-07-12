import assert from "node:assert/strict";
import { test } from "node:test";
import { axisFallbackSpan } from "../src/layout/axis-fallback-span";

test("axisFallbackSpan floors nSpan at 20 for small node counts", () => {
	// ceil(sqrt(0..25))*4 <= 20, so the floor dominates and width = 20*slot.
	assert.deepEqual(axisFallbackSpan(0, 2, 3), { nSpan: 20, width: 40, height: 60 });
	assert.deepEqual(axisFallbackSpan(25, 2, 3), { nSpan: 20, width: 40, height: 60 });
});

test("axisFallbackSpan grows with sqrt(count) past the floor", () => {
	// 100 nodes → ceil(sqrt(100))*4 = 40 (> 20 floor).
	assert.deepEqual(axisFallbackSpan(100, 1, 1), { nSpan: 40, width: 40, height: 40 });
});

test("axisFallbackSpan forces nSpan even so cx/cy stay integral", () => {
	// 30 nodes → ceil(sqrt(30)) = 6 → *4 = 24 (already even).
	assert.equal(axisFallbackSpan(30, 1, 1).nSpan % 2, 0);
	// A range of counts: nSpan always even, and width/height are its slot multiples.
	for (let n = 0; n <= 500; n += 7) {
		const { nSpan, width, height } = axisFallbackSpan(n, 5, 8);
		assert.equal(nSpan % 2, 0, `nSpan even for n=${n}`);
		assert.equal(width, nSpan * 5);
		assert.equal(height, nSpan * 8);
		assert.ok(nSpan >= 20);
	}
});

test("axisFallbackSpan scales width/height independently by slot size", () => {
	const { width, height } = axisFallbackSpan(0, 10, 4);
	assert.equal(width, 200);
	assert.equal(height, 80);
});
