import type { GraphNode } from "../types";

// LIMIT section: per-cluster node display rules. Each tier consumes a
// successive rank range from the cluster's sort order; ranks past the last
// tier are hidden.
export type LimitRule =
	| { kind: "limit"; n: number }
	| { kind: "brief"; n: number };

// Apply tier rules per cluster. Each cluster sorts its members by the
// order rule (default: name asc), then `limit` / `brief` rows consume
// successive rank ranges. Anything past the last tier is implicitly
// hidden.
//
// Multi-membership nodes pick the BEST mode they earned across their
// clusters (full > brief > hidden) so an "important in cluster A" node
// isn't suppressed just because it's a low rank in cluster B.
export function applyLimitRules(
	nodes: GraphNode[],
	tiers: LimitRule[],
	field: string,
	dir: "asc" | "desc",
	getSortKey: (id: string, field: string) => string | number,
): { visibleNodes: GraphNode[]; modes: Map<string, "full" | "brief"> } {
	// No tier rules (or every tier resolves to "zero items") → everything
	// visible at full mode. This safety check stops a bad LIMIT setting
	// (like "limit 0") from wiping the entire canvas.
	const effectiveTiers = tiers.filter((t) => t.n > 0);
	if (effectiveTiers.length === 0) {
		const modes = new Map<string, "full" | "brief">();
		for (const n of nodes) modes.set(n.id, "full");
		return { visibleNodes: nodes, modes };
	}
	tiers = effectiveTiers;

	const byCluster = new Map<string, GraphNode[]>();
	for (const n of nodes) {
		for (const m of n.memberships) {
			const arr = byCluster.get(m);
			if (arr) arr.push(n);
			else byCluster.set(m, [n]);
		}
	}

	const modes = new Map<string, "full" | "brief">();
	const rank = (m: "full" | "brief") => (m === "full" ? 2 : 1);

	for (const members of byCluster.values()) {
		const sorted = [...members].sort((a, b) => {
			const ka = getSortKey(a.id, field);
			const kb = getSortKey(b.id, field);
			let cmp: number;
			if (typeof ka === "number" && typeof kb === "number") cmp = ka - kb;
			else cmp = String(ka).localeCompare(String(kb));
			return dir === "asc" ? cmp : -cmp;
		});
		let cursor = 0;
		for (const tier of tiers) {
			const target = Math.min(tier.n, sorted.length);
			const mode = tier.kind === "limit" ? "full" : "brief";
			for (let i = cursor; i < target; i++) {
				const id = sorted[i].id;
				const existing = modes.get(id);
				if (!existing || rank(mode) > rank(existing)) modes.set(id, mode);
			}
			cursor = target;
		}
	}

	const visibleNodes = nodes.filter((n) => modes.has(n.id));
	return { visibleNodes, modes };
}
