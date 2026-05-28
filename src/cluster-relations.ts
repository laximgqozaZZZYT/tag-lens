import type { GraphNode } from "./types";

// Build cluster_key → member_id_set from a list of nodes. Each cluster
// appearing in any node's memberships gets an entry, populated with the
// IDs of every node that lists it.
export function computeMemberSets(
	nodes: GraphNode[],
): Map<string, Set<string>> {
	const memberSets = new Map<string, Set<string>>();
	const keys = new Set<string>();
	for (const n of nodes) for (const m of n.memberships) keys.add(m);
	for (const key of keys) {
		const s = new Set<string>();
		for (const n of nodes) if (n.memberships.includes(key)) s.add(n.id);
		memberSets.set(key, s);
	}
	return memberSets;
}

// For each cluster, the list of clusters that STRICTLY contain its
// member set (i.e. their member set is a strict superset). Used by the
// NODE_DISPLAY resolver's fallback chain: an override on a strict
// superset of the node's group applies when the group itself has no
// override.
export function computeStrictSupersets(
	memberSets: Map<string, Set<string>>,
): Map<string, string[]> {
	const supersetsOf = new Map<string, string[]>();
	for (const [key, mems] of memberSets) {
		const supers: string[] = [];
		for (const [otherKey, otherMems] of memberSets) {
			if (otherKey === key) continue;
			if (otherMems.size <= mems.size) continue;
			let isSuper = true;
			for (const m of mems) {
				if (!otherMems.has(m)) {
					isSuper = false;
					break;
				}
			}
			if (isSuper) supers.push(otherKey);
		}
		supersetsOf.set(key, supers);
	}
	return supersetsOf;
}
