import type { GraphNode } from "../types";

// Phase A: zone decomposition + count + NONE_BUCKET handling + aggregate
// preprocessing. The output `Zone[]` is the input to Phase C (target area
// computation) and the basis of the topology graph (Phase D).

// Special key for the "none-bucket" base set. Nodes whose membership[] is
// empty (no tag / no cluster match) are gathered here. Treated as a
// regular base set in the layout pipeline, with the only special rule
// being that NONE_BUCKET has "separation-required" relation to every
// other base set (= it never shares a zone with anything else).
export const NONE_BUCKET_KEY = "__NONE_BUCKET__";

// Phase A output: one Zone per unique membership signature.
//   `key`         = sorted membership array joined by "|" (cache lookup)
//   `memberships` = sorted membership array (canonical form)
//   `count`       = number of real nodes belonging to this zone (excludes
//                   aggregate-placeholder virtual nodes when count is read
//                   for "is this zone empty for Helly purposes?", but
//                   includes virtuals when sizing — see Phase C)
//   `nodes`       = the actual node ids in this zone (post-aggregate
//                   substitution; virtual stack nodes use synthetic ids)
//   `isHellyForced` = filled in by detectHellyForcedZones; default false
export interface Zone {
	key: string;
	memberships: string[];
	count: number;
	nodes: GraphNode[];
	isHellyForced: boolean;
}

// Aggregate flag input — which base sets should be folded into a 3-card
// stack (`aggregateStackSize` virtual nodes replacing all real members).
export interface AggregateSpec {
	aggregatedSets: Set<string>;
	stackSize: number; // typically 3
	// Virtual node id prefix; ids will be `${prefix}${cluster}__${i}`.
	virtualIdPrefix: string;
}

// Replace aggregated clusters' member nodes with `stackSize` virtual
// nodes, all with membership = [aggregatedCluster] only. Virtual nodes
// inherit no other memberships even if the original real nodes were
// multi-tag, because the aggregate stack is a visual summary of the
// cluster, not its intersections. Returns the modified node list.
//
// The original real nodes are NOT preserved here — Phase G's stack
// renderer (existing `drawAggregateStack`) renders the visual stack
// from the cluster rect; the original member count is reported back
// to the caller separately via `aggregatePreservedCounts`.
export function applyAggregatePreprocessing(
	nodes: GraphNode[],
	spec: AggregateSpec,
): {
	nodes: GraphNode[];
	aggregatePreservedCounts: Map<string, number>;
} {
	if (spec.aggregatedSets.size === 0) {
		return { nodes, aggregatePreservedCounts: new Map() };
	}
	const out: GraphNode[] = [];
	const preserved = new Map<string, number>();
	// Pass 1: count how many real members each aggregated cluster has,
	// for later stack-badge labeling.
	for (const n of nodes) {
		let isAggregatedMember = false;
		for (const m of n.memberships) {
			if (spec.aggregatedSets.has(m)) {
				isAggregatedMember = true;
				preserved.set(m, (preserved.get(m) ?? 0) + 1);
				break;
			}
		}
		if (!isAggregatedMember) out.push(n);
	}
	// Pass 2: for each aggregated cluster with ≥ 1 preserved member,
	// emit `stackSize` virtual nodes.
	for (const cluster of spec.aggregatedSets) {
		const orig = preserved.get(cluster) ?? 0;
		if (orig === 0) continue;
		for (let i = 0; i < spec.stackSize; i++) {
			out.push({
				id: `${spec.virtualIdPrefix}${cluster}__${i}`,
				label: cluster,
				memberships: [cluster],
			});
		}
	}
	return { nodes: out, aggregatePreservedCounts: preserved };
}

// Move nodes with empty `memberships` into the synthetic NONE_BUCKET
// base set. Returns the modified node list AND a boolean indicating
// whether the bucket was actually used (so callers can decide whether
// to add NONE_BUCKET to the base-set roster).
export function ensureNoneBucket(nodes: GraphNode[]): {
	nodes: GraphNode[];
	hasNoneBucket: boolean;
} {
	let hasNoneBucket = false;
	const out: GraphNode[] = [];
	for (const n of nodes) {
		if (!n.memberships || n.memberships.length === 0) {
			out.push({ ...n, memberships: [NONE_BUCKET_KEY] });
			hasNoneBucket = true;
		} else {
			out.push(n);
		}
	}
	return { nodes: out, hasNoneBucket };
}

// Decompose nodes into zones by their canonical (sorted) membership
// signature. Each zone holds the list of nodes and the count.
//
// Helly-forced flag is left false; the caller runs `detectHellyForced`
// after Phase A-5 to populate this. The flag is irrelevant for zones
// with count ≥ 1 (those always get the minGap constraint).
export function decomposeZones(nodes: GraphNode[]): Zone[] {
	const map = new Map<string, Zone>();
	for (const n of nodes) {
		const sorted = [...n.memberships].sort();
		const key = sorted.join("|");
		let z = map.get(key);
		if (!z) {
			z = {
				key,
				memberships: sorted,
				count: 0,
				nodes: [],
				isHellyForced: false,
			};
			map.set(key, z);
		}
		z.count++;
		z.nodes.push(n);
	}
	return [...map.values()];
}

// Collect the per-base-set total count (= sum of zone counts where the
// base set is a member). Used by Phase B's cascade tie-break and by
// Phase C's per-cluster weight.
export function computeBaseSetCounts(zones: Zone[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const z of zones) {
		for (const m of z.memberships) {
			out.set(m, (out.get(m) ?? 0) + z.count);
		}
	}
	return out;
}

// Set of base-set pairs that MUST overlap (= they co-occur in at least
// one non-empty zone). Used by Phase D (seed) and Phase E (topology
// penalty), and also by `detectHellyForcedZones`.
//
// Pair encoding: `${a}|${b}` where a < b lexicographically.
export function computeMustOverlapPairs(zones: Zone[]): Set<string> {
	const pairs = new Set<string>();
	for (const z of zones) {
		if (z.count === 0) continue;
		for (let i = 0; i < z.memberships.length; i++) {
			for (let j = i + 1; j < z.memberships.length; j++) {
				const a = z.memberships[i];
				const b = z.memberships[j];
				pairs.add(a < b ? `${a}|${b}` : `${b}|${a}`);
			}
		}
	}
	return pairs;
}
