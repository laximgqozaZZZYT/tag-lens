import assert from "node:assert/strict";
import test from "node:test";
import {
	computeDegreeMaps,
	degreeInfoOf,
} from "../src/query/rebuild-pipeline";

// a → b, a → c, b → a: total/in/out counts we can eyeball.
const maps = computeDegreeMaps([
	{ source: "a", target: "b" },
	{ source: "a", target: "c" },
	{ source: "b", target: "a" },
]);

test("resolves total + directional degree for a two-way node", () => {
	// a: out to b,c + in from b → degree 3, out 2, in 1.
	assert.deepEqual(degreeInfoOf("a", maps), {
		inDeg: 1,
		outDeg: 2,
		degree: 3,
	});
});

test("a pure sink has no outDegree entry → outDeg defaults to 0", () => {
	// c: only ever a target → degree 1, in 1, out 0.
	assert.deepEqual(degreeInfoOf("c", maps), {
		inDeg: 1,
		outDeg: 0,
		degree: 1,
	});
});

test("a node absent from the graph → undefined (unbound, not zero)", () => {
	assert.equal(degreeInfoOf("nope", maps), undefined);
});

test("presence keys off total degree, never the directional maps", () => {
	// Craft a node present in a directional map but NOT the total map: it must
	// still read as undefined, because degree presence is the total-map hit.
	const inconsistent = {
		degreeMap: new Map<string, number>(),
		inDegreeMap: new Map([["ghost", 5]]),
		outDegreeMap: new Map<string, number>(),
	};
	assert.equal(degreeInfoOf("ghost", inconsistent), undefined);
});

test("a zero total degree is still present (not undefined)", () => {
	const zero = {
		degreeMap: new Map([["z", 0]]),
		inDegreeMap: new Map<string, number>(),
		outDegreeMap: new Map<string, number>(),
	};
	assert.deepEqual(degreeInfoOf("z", zero), {
		inDeg: 0,
		outDeg: 0,
		degree: 0,
	});
});
