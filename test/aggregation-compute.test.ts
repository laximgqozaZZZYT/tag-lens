import { ok } from "./assert";
import {
	computeAggregationGroups,
	getAttributeValue,
	computeBounds,
} from "../src/aggregation/compute";
import type { PositionedNode } from "../src/layout/layout";
import type { MiniSettings } from "../src/types";

// Helper to create a mock PositionedNode
function mockNode(
	id: string,
	memberships: string[],
	x: number,
	y: number,
	attrs?: { fmStatus?: string; fmMaturity?: string; ageDays?: number }
): PositionedNode {
	return {
		id,
		label: `Note ${id}`,
		memberships,
		x,
		y,
		width: 100,
		height: 50,
		...attrs,
	};
}

// Helper to create minimal settings with aggregation config
function mockSettings(
	globalAttr: string,
	enabledSets: string[]
): MiniSettings {
	const aggregationSettings: Record<string, { enabled: boolean }> = {};
	for (const set of enabledSets) {
		aggregationSettings[set] = { enabled: true };
	}

	return {
		globalAggregationAttribute: globalAttr,
		aggregationSettings,
	} as MiniSettings;
}

// Test: Empty node array
{
	const nodes: PositionedNode[] = [];
	const settings = mockSettings("status", ["tag/project"]);
	const result = computeAggregationGroups(nodes, settings, "euler");

	ok(result.groups.size === 0, "Empty nodes produces no groups");
	ok(result.nodeToGroup.size === 0, "Empty nodes produces no node lookup");
	ok(result.aggregatedNodeIds.size === 0, "Empty nodes produces no aggregated IDs");
}

// Test: No global attribute configured
{
	const nodes = [
		mockNode("1", ["tag/project"], 0, 0, { fmStatus: "active" }),
		mockNode("2", ["tag/project"], 0, 0, { fmStatus: "active" }),
	];
	const settings = mockSettings("", ["tag/project"]);
	const result = computeAggregationGroups(nodes, settings, "euler");

	ok(result.groups.size === 0, "No global attribute produces no groups");
	ok(result.aggregatedNodeIds.size === 0, "No global attribute produces no aggregated IDs");
}

// Test: Aggregation disabled for set
{
	const nodes = [
		mockNode("1", ["tag/project"], 0, 0, { fmStatus: "active" }),
		mockNode("2", ["tag/project"], 0, 0, { fmStatus: "active" }),
	];
	const settings = mockSettings("status", []); // No enabled sets
	const result = computeAggregationGroups(nodes, settings, "euler");

	ok(result.groups.size === 0, "Disabled aggregation produces no groups");
	ok(result.aggregatedNodeIds.size === 0, "Disabled aggregation produces no aggregated IDs");
}

// Test: Nodes with null/undefined attributes
{
	const nodes = [
		mockNode("1", ["tag/project"], 0, 0), // No status
		mockNode("2", ["tag/project"], 0, 0), // No status
		mockNode("3", ["tag/project"], 0, 0, { fmStatus: "active" }), // Has status (singleton)
	];
	const settings = mockSettings("status", ["tag/project"]);
	const result = computeAggregationGroups(nodes, settings, "euler");

	ok(result.groups.size === 0, "Nodes with null attributes are not grouped");
	ok(result.aggregatedNodeIds.size === 0, "Nodes with null attributes are not aggregated");
}

// Test: Single-node groups are not created
{
	const nodes = [
		mockNode("1", ["tag/project"], 0, 0, { fmStatus: "active" }),
		mockNode("2", ["tag/project"], 0, 0, { fmStatus: "done" }),
		mockNode("3", ["tag/project"], 0, 0, { fmStatus: "pending" }),
	];
	const settings = mockSettings("status", ["tag/project"]);
	const result = computeAggregationGroups(nodes, settings, "euler");

	ok(result.groups.size === 0, "Single-node groups are not created");
	ok(result.aggregatedNodeIds.size === 0, "Single-node groups produce no aggregated IDs");
}

// Test: Two nodes with same attribute are grouped
{
	const nodes = [
		mockNode("1", ["tag/project"], 10, 20, { fmStatus: "active" }),
		mockNode("2", ["tag/project"], 30, 40, { fmStatus: "active" }),
	];
	const settings = mockSettings("status", ["tag/project"]);
	const result = computeAggregationGroups(nodes, settings, "euler");

	ok(result.groups.size === 1, "Two nodes with same attribute create one group");
	ok(result.aggregatedNodeIds.size === 2, "Both nodes are aggregated");

	const group = result.groups.get("tag/project:active");
	ok(group != null, "Group key is correct");
	ok(group!.nodeIds.length === 2, "Group contains 2 nodes");
	ok(group!.nodeIds.includes("1"), "Group contains node 1");
	ok(group!.nodeIds.includes("2"), "Group contains node 2");
	ok(group!.setKey === "tag/project", "Group setKey is correct");
	ok(group!.attributeValue === "active", "Group attributeValue is correct");
	ok(group!.x === 20, "Centroid x is average of node x positions");
	ok(group!.y === 30, "Centroid y is average of node y positions");
}

// Test: Multiple groups from different attribute values
{
	const nodes = [
		mockNode("1", ["tag/project"], 0, 0, { fmStatus: "active" }),
		mockNode("2", ["tag/project"], 0, 0, { fmStatus: "active" }),
		mockNode("3", ["tag/project"], 0, 0, { fmStatus: "done" }),
		mockNode("4", ["tag/project"], 0, 0, { fmStatus: "done" }),
	];
	const settings = mockSettings("status", ["tag/project"]);
	const result = computeAggregationGroups(nodes, settings, "euler");

	ok(result.groups.size === 2, "Two groups created for different attribute values");
	ok(result.aggregatedNodeIds.size === 4, "All 4 nodes are aggregated");

	const activeGroup = result.groups.get("tag/project:active");
	const doneGroup = result.groups.get("tag/project:done");

	ok(activeGroup != null, "Active group exists");
	ok(doneGroup != null, "Done group exists");
	ok(activeGroup!.nodeIds.length === 2, "Active group has 2 nodes");
	ok(doneGroup!.nodeIds.length === 2, "Done group has 2 nodes");
}

// Test: Multiple sets with independent aggregation
{
	const nodes = [
		mockNode("1", ["tag/project"], 0, 0, { fmStatus: "active" }),
		mockNode("2", ["tag/project"], 0, 0, { fmStatus: "active" }),
		mockNode("3", ["tag/work"], 0, 0, { fmStatus: "active" }),
		mockNode("4", ["tag/work"], 0, 0, { fmStatus: "active" }),
	];
	const settings = mockSettings("status", ["tag/project", "tag/work"]);
	const result = computeAggregationGroups(nodes, settings, "euler");

	ok(result.groups.size === 2, "Two groups created for two different sets");
	ok(result.aggregatedNodeIds.size === 4, "All 4 nodes are aggregated");

	const projectGroup = result.groups.get("tag/project:active");
	const workGroup = result.groups.get("tag/work:active");

	ok(projectGroup != null, "Project group exists");
	ok(workGroup != null, "Work group exists");
	ok(projectGroup!.setKey === "tag/project", "Project group setKey is correct");
	ok(workGroup!.setKey === "tag/work", "Work group setKey is correct");
}

// Test: Primary membership precedence (only first membership is used)
{
	const nodes = [
		mockNode("1", ["tag/project", "tag/work"], 0, 0, { fmStatus: "active" }),
		mockNode("2", ["tag/project", "tag/work"], 0, 0, { fmStatus: "active" }),
	];
	const settings = mockSettings("status", ["tag/project", "tag/work"]);
	const result = computeAggregationGroups(nodes, settings, "euler");

	ok(result.groups.size === 1, "Only one group created from primary membership");
	ok(result.groups.has("tag/project:active"), "Group uses primary membership (tag/project)");
	ok(!result.groups.has("tag/work:active"), "Secondary membership not used");
}

// Test: getAttributeValue - status
{
	const node = mockNode("1", ["tag/project"], 0, 0, { fmStatus: "active" });
	const value = getAttributeValue(node, "status");
	ok(value === "active", "getAttributeValue extracts status correctly");
}

// Test: getAttributeValue - maturity
{
	const node = mockNode("1", ["tag/project"], 0, 0, { fmMaturity: "permanent" });
	const value = getAttributeValue(node, "maturity");
	ok(value === "permanent", "getAttributeValue extracts maturity correctly");
}

// Test: getAttributeValue - age bucketing
{
	const node0 = mockNode("1", ["tag/project"], 0, 0, { ageDays: 0 });
	ok(getAttributeValue(node0, "age") === "today", "Age 0 days buckets to 'today'");

	const node3 = mockNode("2", ["tag/project"], 0, 0, { ageDays: 3 });
	ok(getAttributeValue(node3, "age") === "this-week", "Age 3 days buckets to 'this-week'");

	const node15 = mockNode("3", ["tag/project"], 0, 0, { ageDays: 15 });
	ok(getAttributeValue(node15, "age") === "this-month", "Age 15 days buckets to 'this-month'");

	const node60 = mockNode("4", ["tag/project"], 0, 0, { ageDays: 60 });
	ok(getAttributeValue(node60, "age") === "recent", "Age 60 days buckets to 'recent'");

	const node180 = mockNode("5", ["tag/project"], 0, 0, { ageDays: 180 });
	ok(getAttributeValue(node180, "age") === "this-year", "Age 180 days buckets to 'this-year'");

	const node400 = mockNode("6", ["tag/project"], 0, 0, { ageDays: 400 });
	ok(getAttributeValue(node400, "age") === "old", "Age 400 days buckets to 'old'");
}

// Test: getAttributeValue - null when attribute not set
{
	const node = mockNode("1", ["tag/project"], 0, 0);
	ok(getAttributeValue(node, "status") === null, "Missing status returns null");
	ok(getAttributeValue(node, "maturity") === null, "Missing maturity returns null");
	ok(getAttributeValue(node, "age") === null, "Missing ageDays returns null");
}

// Test: getAttributeValue - unknown attribute
{
	const node = mockNode("1", ["tag/project"], 0, 0, { fmStatus: "active" });
	ok(getAttributeValue(node, "unknown") === null, "Unknown attribute returns null");
}

// Test: computeBounds - empty array
{
	const bounds = computeBounds([]);
	ok(bounds.width === 0, "Empty array has 0 width");
	ok(bounds.height === 0, "Empty array has 0 height");
}

// Test: computeBounds - single node
{
	const nodes = [mockNode("1", ["tag/project"], 100, 200)]; // width=100, height=50
	const bounds = computeBounds(nodes);
	ok(bounds.width === 100, "Single node bounds width equals node width");
	ok(bounds.height === 50, "Single node bounds height equals node height");
}

// Test: computeBounds - multiple nodes
{
	const nodes = [
		mockNode("1", ["tag/project"], 0, 0), // left=-50, right=50, top=-25, bottom=25
		mockNode("2", ["tag/project"], 200, 100), // left=150, right=250, top=75, bottom=125
	];
	const bounds = computeBounds(nodes);
	// minX = -50, maxX = 250 → width = 300
	// minY = -25, maxY = 125 → height = 150
	ok(bounds.width === 300, "Multiple nodes bounds width is correct");
	ok(bounds.height === 150, "Multiple nodes bounds height is correct");
}

// Test: Representative node is first node
{
	const nodes = [
		mockNode("1", ["tag/project"], 0, 0, { fmStatus: "active" }),
		mockNode("2", ["tag/project"], 0, 0, { fmStatus: "active" }),
	];
	const settings = mockSettings("status", ["tag/project"]);
	const result = computeAggregationGroups(nodes, settings, "euler");

	const group = result.groups.get("tag/project:active");
	ok(group!.representativeNode.id === "1", "Representative node is the first node");
}

// Test: nodeToGroup lookup map
{
	const nodes = [
		mockNode("1", ["tag/project"], 0, 0, { fmStatus: "active" }),
		mockNode("2", ["tag/project"], 0, 0, { fmStatus: "active" }),
		mockNode("3", ["tag/project"], 0, 0, { fmStatus: "done" }),
	];
	const settings = mockSettings("status", ["tag/project"]);
	const result = computeAggregationGroups(nodes, settings, "euler");

	ok(result.nodeToGroup.get("1") === "tag/project:active", "Node 1 maps to active group");
	ok(result.nodeToGroup.get("2") === "tag/project:active", "Node 2 maps to active group");
	ok(result.nodeToGroup.get("3") === undefined, "Node 3 not in any group (singleton)");
}
