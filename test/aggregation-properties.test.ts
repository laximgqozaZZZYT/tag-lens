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


// Generate a valid set key (membership)
const arbSetKey = fc.oneof(
	fc.string({ minLength: 1, maxLength: 20 }).map(s => `tag/${s}`),
	fc.constant("__union__"),
	fc.constant("__intersection__")
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

// Helper to get attribute value from node for test assertions
function getAttrValue(node: PositionedNode, attr: string): string | null {
	if (attr === "status") return node.fmStatus ?? null;
	if (attr === "maturity") return node.fmMaturity ?? null;
	if (attr === "age") {
		if (node.ageDays == null) return null;
		if (node.ageDays < 1) return "today";
		if (node.ageDays < 7) return "this-week";
		if (node.ageDays < 30) return "this-month";
		if (node.ageDays < 90) return "recent";
		if (node.ageDays < 365) return "this-year";
		return "old";
	}
	return null;
}

// Generate minimal settings with aggregation config
function arbMiniSettings(): fc.Arbitrary<MiniSettings> {
	return fc.record({
		globalAggregationAttribute: fc.option(arbAttributeName, { nil: "" }),
		aggregatedLayers: fc.array(fc.string()),
		layerAggregation: fc.record({
			tags: fc.boolean(),
			unions: fc.boolean(),
			intersections: fc.boolean(),
		}),
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

						// Check if aggregation is enabled for this category
                                                const isUnion = m1 === "__union__";
                                                const isIntersection = m1 === "__intersection__";
                                                const isTag = !isUnion && !isIntersection;

                                                const agg = settings.aggregatedLayers || [];
                                                let enabled = false;
                                                if (isTag) {
                                                    enabled = agg.includes("__TAGS__") || agg.includes(m1);
                                                } else if (isUnion) {
                                                    enabled = agg.includes("__UNIONS__");
                                                } else if (isIntersection) {
                                                    enabled = agg.includes("__INTERSECTIONS__");
                                                }

                                                if (!enabled) continue;
						// Get attribute values
						const attr1 = getAttrValue(n1, settings.globalAggregationAttribute);
						const attr2 = getAttrValue(n2, settings.globalAggregationAttribute);

						// Skip if either has null attribute
						if (attr1 === null || attr2 === null) continue;

						// If same attribute value, they must be in the same group
						if (attr1 === attr2) {
							const group1 = result.nodeToGroup.get(n1.id);
							const group2 = result.nodeToGroup.get(n2.id);

							// If they exist and are the same combined key, they should be grouped together if there are >= 2 of them
							const matchingNodes = nodes.filter(n =>
								n.memberships[0] === m1 &&
								getAttrValue(n, settings.globalAggregationAttribute) === attr1
							);

							if (matchingNodes.length >= 2) {
								if (group1 === undefined || group2 === undefined) {
									console.log(`FAIL: Nodes not grouped. m1=${m1}, attr1=${attr1}, matching=${matchingNodes.length}`);
									return false;
								}
								if (group1 !== group2) {
									console.log(`FAIL: Nodes in different groups. g1=${group1}, g2=${group2}`);
									return false;
								}
							} else {
								// Should NOT be grouped
								if (group1 !== undefined || group2 !== undefined) {
									console.log(`FAIL: Node should not be grouped. g1=${group1}, g2=${group2}`);
									return false;
								}
							}
						}
					}
				}

				return true;
			}
		)
	);

	ok(true, "Property 1: Attribute-based grouping consistency holds across random inputs");
}
