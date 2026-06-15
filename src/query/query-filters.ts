import { GraphData } from "../types";

// Strip dropped clusters from each node's memberships. Nodes whose
// entire membership set was dropped are removed from the result
// entirely (SQL HAVING semantics: a row whose group is filtered out
// shouldn't reappear in a fallback bucket). Edges referencing removed
// nodes are also dropped.
export function filterMemberships(
	data: GraphData,
	dropped: Set<string>,
): GraphData {
	const nodes = data.nodes
		.map((n) => ({
			...n,
			memberships: n.memberships.filter((m) => !dropped.has(m)),
		}))
		.filter((n) => n.memberships.length > 0);
	const aliveIds = new Set(nodes.map((n) => n.id));
	const edges = data.edges.filter(
		(e) => aliveIds.has(e.source) && aliveIds.has(e.target),
	);
	return { nodes, edges };
}

export function filterLabels(
	labels: Map<string, string>,
	dropped: Set<string>,
): Map<string, string> {
	const out = new Map(labels);
	for (const k of dropped) out.delete(k);
	return out;
}

// Parse a single HAVING row into a predicate on cluster member count.
// Grammar: <aggregate> <op> <number>
// where <aggregate> is `count` (only supported aggregate today) and <op>
// is one of >= <= == != > <.
export function parseHaving(s: string): (count: number) => boolean {
	const m = s.match(
		/^\s*([A-Za-z_]+)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/,
	);
	if (!m) throw new Error(`expected "count <op> <number>", got: "${s}"`);
	const agg = m[1].toLowerCase();
	if (agg !== "count")
		throw new Error(`unknown aggregate "${agg}" (only "count" supported)`);
	const op = m[2];
	const n = Number(m[3]);
	switch (op) {
		case ">=":
			return (c) => c >= n;
		case "<=":
			return (c) => c <= n;
		case ">":
			return (c) => c > n;
		case "<":
			return (c) => c < n;
		case "==":
			return (c) => c === n;
		case "!=":
			return (c) => c !== n;
	}
	throw new Error(`unknown operator: ${op}`);
}
