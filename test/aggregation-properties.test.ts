// Property-based tests for node aggregation feature
// These tests verify universal properties that should hold for all inputs

import * as fc from "fast-check";
import { ok } from "./assert";
import { computeAggregationGroups } from "../src/aggregation/compute";
import type { PositionedNode } from "../src/layout/layout";
import type { MiniSettings } from "../src/types";

// ============================================================================
// Arbitrary generators for property-based testing
// ============================================================================

// Generate a valid attribute name
const arbAttributeName = fc.constantFrom("status", "maturity", "age");

// Generate a valid attribute value based on attribute type
function arbAttributeValue(attrName: string): fc.Arbitrary<string> {
	switch (attrName) {
		case "status":
			return fc.constantFrom("active", "done", "pending", "blocked", "archived");
		case "maturity":
			return fc.constantFrom("seedling", "budding", "evergreen", "permanent");
		case "age":
			return fc.constantFrom("today", "this-week", "this-month", "recent", "this-year", "old");
		default:
			return fc.constant("unknown");
	}
}

// Generate a valid set key (membership)
const arbSetKey = fc.oneof(
	fc.string({ minLength: 1, maxLength: 20 }).map(s => `tag/${s}`),
	fc.constant("UNION_LAYER"),
	fc.constant("INTERSECTION_LAYER")
);

// Generate a positioned node with optional attributes
const arbPositionedNode = fc.record({
	id: fc.string({ minLength: 1, maxLength: 10 }),
	label: fc.string({ minLength: 0, maxLength: 50 }),
	memberships: fc.array(arbSetKey, { minLength: 1, maxLength: 3 }),
	x: fc.integer({ min: -1000, max: 1000 }),
	y: fc.integer({ min: -1000, max: 1000 }),
	width: fc.integer({ min: 50, max: 200 }),
	height: fc.integer({ min: 30, max: 100 }),
	// Optional attributes
	fmStatus: fc.option(fc.constantFrom("active", "done", "pending", "blocked", "archived"), { nil: undefined }),
	fmMaturity: fc.option(fc.constantFrom("seedling", "budding", "evergreen", "permanent"), { nil: undefined }),
	ageDays: fc.option(fc.integer({ min: 0, max: 500 }), { nil: undefined }),
}) as fc.Arbitrary<PositionedNode>;

// Generate minimal settings with aggregation config
function arbMiniSettings(): fc.Arbitrary<MiniSettings> {
	return fc.record({
		globalAggregationAttribute: fc.option(arbAttributeName, { nil: "" }),
		aggregationSettings: fc.dictionary(
			arbSetKey,
			fc.record({ enabled: fc.boolean() }),
			{ minKeys: 0, maxKeys: 5 }
		),
	}) as fc.Arbitrary<MiniSettings>;
}

// ============================================================================
// Property 1: Attribute-based grouping consistency
// Validates: Requirements 1.1, 1.2
// ============================================================================

/**
 * Property 1: Attribute-based grouping consistency
 * 
 * For all node arrays N, settings S, if aggregation is enabled for a set K,
 * then all nodes n1, n2 ∈ N where membership(n1) = membership(n2) = K and
 * attribute(n1) = attribute(n2) must be in the same aggregation group.
 */
{
	fc.assert(
		fc.property(
			fc.array(arbPositionedNode, { minLength: 0, maxLength: 50 }),
			arbMiniSettings(),
			(nodes, settings) => {
				const result = computeAggregationGroups(nodes, settings, "euler");

				// If no global attribute, there should be no groups
				if (!settings.globalAggregationAttribute) {
					return result.groups.size === 0;
				}

				// For each pair of nodes with the same primary membership and attribute value
				for (let i = 0; i < nodes.length; i++) {
					for (let j = i + 1; j < nodes.length; j++) {
						const n1 = nodes[i];
						const n2 = nodes[j];

						// Get primary membership (first in list)
						const m1 = n1.memberships[0];
						const m2 = n2.memberships[0];

						// Skip if different primary memberships
						if (m1 !== m2) continue;

						// Skip if aggregation disabled for this set
						const config = settings.aggregationSettings[m1];
						if (!config || !config.enabled) continue;

						// Get attribute values
						const attr1 = getAttrValue(n1, settings.globalAggregationAttribute);
						const attr2 = getAttrValue(n2, settings.globalAggregationAttribute);

						// Skip if either has null attribute
						if (attr1 === null || attr2 === null) continue;

						// If same attribute value, they must be in the same group
						if (attr1 === attr2) {
							const group1 = result.nodeToGroup.get(n1.id);
							const group2 = result.nodeToGroup.get(n2.id);

							// Both should be in a group (not singleton)
							if (group1 === undefined || group2 === undefined) {
								// This can happen if they're the only two with this combination
								// and somehow filtered out - but they should be grouped together
								// Only acceptable if there are exactly 2 nodes with this combo
								const matchingNodes = nodes.filter(n =>
									n.memberships[0] === m1 &&
									getAttrValue(n, settings.globalAggregationAttribute) === attr1
								);
								if (matchingNodes.length >= 2) {
									// They should both be in a group
									if (group1 === undefined || group2 === undefined) {
										return false;
									}
								}
							}

							// If both are in groups, they must be in the SAME group
							if (group1 !== undefined && group2 !== undefined && group1 !== group2) {
								return false;
							}
						}
					}
				}

				return true;
			}
		),
		{ numRuns: 100 }
	);

	ok(true, "Property 1: Attribute-based grouping consistency holds across 100 random inputs");
}

// Helper function to extract attribute value (mirrors the implementation)
function getAttrValue(node: PositionedNode, attribute: string): string | null {
	switch (attribute) {
		case "status":
			return node.fmStatus ?? null;
		case "maturity":
			return node.fmMaturity ?? null;
		case "age":
			if (node.ageDays == null) return null;
			// Age bucketing logic
			if (node.ageDays === 0) return "today";
			if (node.ageDays <= 7) return "this-week";
			if (node.ageDays <= 30) return "this-month";
			if (node.ageDays <= 90) return "recent";
			if (node.ageDays <= 365) return "this-year";
			return "old";
		default:
			return null;
	}
}
