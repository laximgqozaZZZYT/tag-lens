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
// Grammar: <aggregate> <op> <expression>
// where <aggregate> is `count` (only supported aggregate today) and <op>
// is one of >= <= == != > <. Supports _noteCount variable and basic multiplication.
export function parseHaving(
	s: string,
	context: { _noteCount: number },
): (count: number) => boolean {
	const normalized = s.trim();

	// Handle AND-combined clauses (e.g. "(A) AND (B)")
	if (/\bAND\b/i.test(normalized)) {
		const parts = normalized.split(/\bAND\b/i);
		const predicates = parts.map((p) => parseHaving(p.trim(), context));
		return (count) => predicates.every((pred) => pred(count));
	}

	// Strip surrounding parentheses if any
	const inner = normalized.replace(/^\((.*)\)$/, "$1").trim();

	const m = inner.match(
		/^\s*([A-Za-z_]+)\s*(>=|<=|==|!=|>|<)\s*(.+)\s*$/,
	);
	if (!m) throw new Error(`expected "count <op> <value>", got: "${inner}"`);
	const agg = m[1].toLowerCase();
	if (agg !== "count")
		throw new Error(`unknown aggregate "${agg}" (only "count" supported)`);
	const op = m[2];
	const expr = m[3].trim();

	// Evaluate RHS expression. Supports literal numbers and _noteCount [ * factor ]
	let n: number;
	if (/^-?\d+(?:\.\d+)?$/.test(expr)) {
		n = Number(expr);
	} else {
		// Replace _noteCount and evaluate simple multiplication
		const substituted = expr.replace(/_noteCount/g, String(context._noteCount));
		const multMatch = substituted.match(
			/^\s*(\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?)\s*$/,
		);
		if (multMatch) {
			n = Number(multMatch[1]) * Number(multMatch[2]);
		} else if (/^\d+(?:\.\d+)?$/.test(substituted)) {
			n = Number(substituted);
		} else {
			throw new Error(`unsupported expression in HAVING: "${expr}"`);
		}
	}

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
