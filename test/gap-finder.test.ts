import { ok, approx } from "./assert";
import { findGaps } from "../src/query/gap-finder";

const tags = [
	{ key: "a", label: "A", size: 100 },
	{ key: "b", label: "B", size: 50 },
	{ key: "c", label: "C", size: 80 },
	{ key: "d", label: "D", size: 2 } // Noise tag, < 3
];

const totalNotes = 1000;
const n = tags.length;

// Co-occurrence counts: 
// A*B = 0 (expected = 100*50/1000 = 5) -> gap
// A*C = 10 (expected = 100*80/1000 = 8) -> not a gap
// B*C = 1 (expected = 50*80/1000 = 4) -> gap
// A*D = 0 (expected = 100*2/1000 = 0.2) -> ignored due to size
const counts = new Uint32Array(n * n);
counts[0 * n + 1] = 0; // A*B
counts[1 * n + 0] = 0;
counts[0 * n + 2] = 10; // A*C
counts[2 * n + 0] = 10;
counts[1 * n + 2] = 1; // B*C
counts[2 * n + 1] = 1;

const gaps = findGaps(tags, counts, n, totalNotes, 10);

ok(gaps.length === 2, `Expected 2 gaps, got ${gaps.length}`);

// A*B gap
ok(gaps[0].a === "A" && gaps[0].b === "B", "Top gap should be A and B");
approx(gaps[0].expected, 5, 0.001, "A*B expected 5");
ok(gaps[0].actual === 0, "A*B actual 0");
ok(gaps[0].score === 5, "A*B score 5");

// B*C gap
ok(gaps[1].a === "B" && gaps[1].b === "C", "Second gap should be B and C");
approx(gaps[1].expected, 4, 0.001, "B*C expected 4");
ok(gaps[1].actual === 1, "B*C actual 1");
ok(gaps[1].score === 3, "B*C score 3");

// Verify noise is ignored
const dGaps = gaps.filter(g => g.a === "D" || g.b === "D");
ok(dGaps.length === 0, "Tag D should be ignored as noise");

// Zero total notes test
const emptyGaps = findGaps(tags, counts, n, 0, 10);
ok(emptyGaps.length === 0, "Should handle 0 total notes without throwing NaN");
