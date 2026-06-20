import type { MiniSettings, ViewMode } from "../types";
import type { PositionedNode } from "../layout/layout";
import type { AggregationState, AggregationGroup } from "./types";

import {
	UNION_LAYER_KEY,
	INTERSECTION_LAYER_KEY,
} from "../visual/node-display";

/**
 * Compute aggregation groups from positioned nodes.
 * 
 * Groups nodes by (setKey, attributeValue) pairs when aggregation is enabled
 * for a set. Only groups with 2+ nodes are created. Single-node groups are
 * left ungrouped.
 * 
 * @param nodes - Array of positioned nodes from the layout pipeline
 * @param settings - User settings including aggregation configuration
 * @param viewMode - Current view mode (for future compatibility checks)
 * @returns AggregationState with groups, lookup maps, and aggregated node set
 */
export function computeAggregationGroups(
	nodes: PositionedNode[],
	settings: MiniSettings,
	viewMode: ViewMode
): AggregationState {
	const groups = new Map<string, AggregationGroup>();
	const nodeToGroup = new Map<string, string>();
	const aggregatedNodeIds = new Set<string>();

	// Early exit if no global attribute configured
	if (!settings.globalAggregationAttribute) {
		return { groups, nodeToGroup, aggregatedNodeIds };
	}

	// Group nodes by (set, attributeValue)
	const groupMap = new Map<string, PositionedNode[]>();

	for (const node of nodes) {
		// Only consider the primary membership (first in the memberships array)
		if (node.memberships.length === 0) continue;

		const membership = node.memberships[0];

		// Check if aggregation is enabled for this membership.
		// We support four levels:
		// 1. Specific tag aggregation (e.g. membership is "#work")
		// 2. Pairwise union/inter aggregation (e.g. "__union__A_B")
		// 3. Category-wide aggregation ("__TAGS__", "__UNIONS__", "__INTERSECTIONS__")
		const isUnion = membership.startsWith("__union__") || membership === UNION_LAYER_KEY;
		const isIntersection = membership.startsWith("__inter__") || membership === INTERSECTION_LAYER_KEY;
		const isTag = !isUnion && !isIntersection;

		let enabled = false;
		const agg = settings.aggregatedLayers || [];
		if (isTag) {
			enabled = agg.includes("__TAGS__") || agg.includes(membership);
		} else if (isUnion) {
			enabled = agg.includes("__UNIONS__") || agg.includes(membership);
		} else if (isIntersection) {
			enabled = agg.includes("__INTERSECTIONS__") || agg.includes(membership);
		}

		if (!enabled) continue;

		// Extract attribute value
		const attrValue = getAttributeValue(
			node,
			settings.globalAggregationAttribute || "status"
		);

		// Skip nodes with null/undefined attributes
		if (attrValue == null) continue;

		const groupKey = `${membership}:${attrValue}`;

		if (!groupMap.has(groupKey)) {
			groupMap.set(groupKey, []);
		}
		groupMap.get(groupKey)!.push(node);
	}

	// Convert groups with 2+ nodes into AggregationGroup
	for (const [groupKey, nodeList] of groupMap) {
		if (nodeList.length < 2) continue;

		const [setKey, attrValue] = groupKey.split(":", 2);

		// Compute centroid position
		const cx = average(nodeList.map(n => n.x));
		const cy = average(nodeList.map(n => n.y));

		// Compute bounding box
		const bounds = computeBounds(nodeList);

		const group: AggregationGroup = {
			key: groupKey,
			setKey,
			nodeIds: nodeList.map(n => n.id),
			attributeValue: attrValue,
			x: cx,
			y: cy,
			width: bounds.width,
			height: bounds.height,
			representativeNode: nodeList[0], // First node as representative
		};

		groups.set(groupKey, group);

		for (const node of nodeList) {
			nodeToGroup.set(node.id, groupKey);
			aggregatedNodeIds.add(node.id);
		}
	}

	return { groups, nodeToGroup, aggregatedNodeIds };
}

/**
 * Extract attribute value from a node based on the attribute name.
 * 
 * Maps attribute names to node fields. Returns null if the attribute
 * is not available or undefined on the node.
 * 
 * @param node - The positioned node
 * @param attribute - Attribute name (e.g., "status", "maturity", "age")
 * @returns The attribute value as a string, or null if unavailable
 */
export function getAttributeValue(
	node: PositionedNode,
	attribute: string
): string | null {
	switch (attribute) {
		case "status":
			return node.fmStatus ?? null;
		case "maturity":
			return node.fmMaturity ?? null;
		case "age":
			// Bucket age in days into ranges
			return node.ageDays != null ? bucketAge(node.ageDays) : null;
		default:
			return null;
	}
}

/**
 * Bucket age in days into human-readable ranges.
 * 
 * @param ageDays - Age in days
 * @returns Bucketed age range as a string
 */
function bucketAge(ageDays: number): string {
	if (ageDays < 1) return "today";
	if (ageDays < 7) return "this-week";
	if (ageDays < 30) return "this-month";
	if (ageDays < 90) return "recent";
	if (ageDays < 365) return "this-year";
	return "old";
}

/**
 * Compute the arithmetic mean of an array of numbers.
 * 
 * @param values - Array of numbers
 * @returns The average value, or 0 for empty arrays
 */
function average(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compute the bounding box for a set of positioned nodes.
 * 
 * Returns the minimum axis-aligned bounding box that contains all nodes.
 * Each node is assumed to be centered at (x, y) with dimensions (width, height).
 * 
 * @param nodes - Array of positioned nodes
 * @returns Object with width and height of the bounding box
 */
export function computeBounds(nodes: PositionedNode[]): {
	width: number;
	height: number;
} {
	if (nodes.length === 0) {
		return { width: 0, height: 0 };
	}

	// Compute min/max for all node extents
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;

	for (const node of nodes) {
		const left = node.x - node.width / 2;
		const right = node.x + node.width / 2;
		const top = node.y - node.height / 2;
		const bottom = node.y + node.height / 2;

		minX = Math.min(minX, left);
		maxX = Math.max(maxX, right);
		minY = Math.min(minY, top);
		maxY = Math.max(maxY, bottom);
	}

	return {
		width: maxX - minX,
		height: maxY - minY,
	};
}
