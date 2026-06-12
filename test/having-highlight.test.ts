import { ok } from "./assert";
import { computeDroppedClusters } from "../src/query-pipeline";
import { filterMemberships } from "../src/query-filters";
import type { GraphNode, GraphData } from "../src/types";

// Mock graph nodes for testing
function makeNode(id: string, tags: string[]): GraphNode {
	return {
		id,
		memberships: tags,
		x: 0,
		y: 0,
		width: 10,
		height: 10,
		tags,
	};
}

const nodes = [
	makeNode("1", ["#a", "#b"]),
	makeNode("2", ["#a", "#c"]),
	makeNode("3", ["#a", "#c"]),
	makeNode("4", ["#d"]),
];

const rawRows = ["count >= 2"];

// #a = 3, #b = 1, #c = 2, #d = 1
// dropped should be #b and #d because they have count < 2
const { dropped, errors } = computeDroppedClusters(nodes, rawRows, false);

ok(errors.length === 0, "No parse errors");
ok(dropped.size === 2, "2 clusters should be dropped");
ok(dropped.get("#b") === 1, "#b count is 1");
ok(dropped.get("#d") === 1, "#d count is 1");
ok(dropped.has("#a") === false, "#a should not be dropped");
ok(dropped.has("#c") === false, "#c should not be dropped");

const data: GraphData = {
	nodes: [
		makeNode("1", ["#a", "#b"]),
		makeNode("2", ["#a"]),
	],
	edges: [],
};

const droppedSet = new Set(dropped.keys());
const filtered = filterMemberships(data, droppedSet);

ok(filtered.nodes[0].memberships.length === 1 && filtered.nodes[0].memberships[0] === "#a", "Node 1 should only have #a");
ok(filtered.nodes[1].memberships.length === 1 && filtered.nodes[1].memberships[0] === "#a", "Node 2 should only have #a");
