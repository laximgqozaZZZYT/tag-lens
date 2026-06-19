import type { PositionedNode } from "../layout/layout";

// Per-set aggregation configuration
export interface AggregationConfig {
	enabled: boolean;
	// Reserved for future multi-attribute support
	attributes?: string[];
}

// A group of nodes with identical attribute values
export interface AggregationGroup {
	// Unique key: "setKey:attributeValue" (e.g., "tag/project:status=active")
	key: string;
	// The set/cluster this group belongs to
	setKey: string;
	// Node IDs in this group
	nodeIds: string[];
	// The shared attribute value(s) that define this group
	attributeValue: string;
	// Display position (centroid of member positions)
	x: number;
	y: number;
	// Bounding box for the group (used for hit testing)
	width: number;
	height: number;
	// Representative node (used for encoding, visual properties)
	representativeNode: PositionedNode;
}

// Aggregation state maintained during rendering
export interface AggregationState {
	// Map from aggregation key to group
	groups: Map<string, AggregationGroup>;
	// Map from node ID to aggregation key (for lookup)
	nodeToGroup: Map<string, string>;
	// Set of node IDs that are aggregated (for filtering during draw)
	aggregatedNodeIds: Set<string>;
}
