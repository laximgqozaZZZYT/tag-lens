import { ok as assertOk, approx } from "./assert";
import { findBridges } from "../src/query/bridge-finder";

// Simple graph with two pairs.
// 1 and 2 share "A", "B", "C". 2 also has "D".
// 3 and 4 share "E", "F".
const nodes = [
	{ id: "1", tags: ["A", "B", "C"] },
	{ id: "2", tags: ["A", "B", "C", "D"] },
	{ id: "3", tags: ["E", "F"] },
	{ id: "4", tags: ["E", "F"] },
];

// No links yet. Both pairs should be found.
const pairs1 = findBridges(nodes, new Set(), 0.5, 50);

assertOk(pairs1.length === 2, "Should find 2 bridges");
// Pair 1|2 has intersection 3 ("A", "B", "C"), union 4 ("A", "B", "C", "D"). Jaccard = 0.75
// Pair 3|4 has intersection 2, union 2. Jaccard = 1.0
// Sorted by Jaccard descending, so 3|4 comes first.
assertOk(pairs1[0].a === "3", "First bridge node A is 3");
assertOk(pairs1[0].b === "4", "First bridge node B is 4");
approx(pairs1[0].jaccard, 1.0, 0.001, "First bridge jaccard is 1.0");

assertOk(pairs1[1].a === "1", "Second bridge node A is 1");
assertOk(pairs1[1].b === "2", "Second bridge node B is 2");
approx(pairs1[1].jaccard, 0.75, 0.001, "Second bridge jaccard is 0.75");

// Add link 3|4 to linkedPairs, so only 1|2 should be found.
const linked = new Set(["3|4"]);
const pairs2 = findBridges(nodes, linked, 0.5, 50);
assertOk(pairs2.length === 1, "Should find 1 bridge after excluding linked pair");
assertOk(pairs2[0].a === "1", "Remaining bridge node A is 1");
assertOk(pairs2[0].b === "2", "Remaining bridge node B is 2");

// Test maxResults
const pairs3 = findBridges(nodes, new Set(), 0.5, 1);
assertOk(pairs3.length === 1, "Should respect maxResults");
assertOk(pairs3[0].a === "3", "Should return the top bridge");

// Test minJaccard
const pairs4 = findBridges(nodes, new Set(), 0.9, 50);
assertOk(pairs4.length === 1, "Should respect minJaccard");
assertOk(pairs4[0].a === "3", "Should return only the bridge with >= 0.9 jaccard");

// Test mega-tag exclusion (>30% of nodes).
const bigNodes = [];
for (let i = 0; i < 20; i++) {
	bigNodes.push({ id: `n${i}`, tags: ["noise" + i] });
}
bigNodes.push({ id: "1", tags: ["A", "B", "C"] });
bigNodes.push({ id: "2", tags: ["A", "B", "C", "D"] });
// Add a mega-tag "X" that is on 15 nodes (>30% of 22 nodes, >10)
for (let i = 0; i < 15; i++) {
	bigNodes[i].tags.push("X");
}
bigNodes[20].tags.push("X"); // node "1"
bigNodes[21].tags.push("X"); // node "2"

const pairs5 = findBridges(bigNodes, new Set(), 0.5, 50);
assertOk(pairs5.length === 1, "Should find bridge ignoring mega-tags");
assertOk(pairs5[0].a === "1", "Bridge node A is 1");
assertOk(pairs5[0].b === "2", "Bridge node B is 2");
approx(pairs5[0].jaccard, 0.8, 0.001, "Jaccard should be 0.8");

// If they only share "X" (a mega-tag), they should not be discovered!
const bigNodes2 = [];
for (let i = 0; i < 20; i++) {
	bigNodes2.push({ id: `n${i}`, tags: ["noise" + i] });
}
for (let i = 0; i < 15; i++) {
	bigNodes2[i].tags.push("X");
}
const pairs6 = findBridges(bigNodes2, new Set(), 0.1, 50);
assertOk(pairs6.length === 0, "Should not find bridges if only mega-tags are shared");
