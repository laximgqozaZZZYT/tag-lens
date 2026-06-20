// Bases mode is COMPLETELY separate from the SQL-like pipeline: view.ts feeds
// applyLimitRules an EMPTY tier list when base-scoped (limitTiers = baseScoped ?
// [] : parseLimitRules()). This guards the contract that empty tiers ⇒ every node
// visible at "full" with NO reordering — i.e. LIMIT never trims and ORDER_BY
// never reshuffles a base-scoped graph.
import { ok } from "./assert";
import { applyLimitRules } from "../src/query/limit";
import type { GraphNode } from "../src/types";

const nodes: GraphNode[] = [
	{ id: "z.md", label: "z", memberships: ["c1"] },
	{ id: "a.md", label: "a", memberships: ["c1"] },
	{ id: "m.md", label: "m", memberships: ["c1"] },
];

// Empty tiers (the Bases-skip path): all nodes survive at "full".
{
	const { visibleNodes, modes } = applyLimitRules(
		nodes,
		[],
		"name",
		"asc",
		(id) => id,
	);
	ok(visibleNodes.length === 3, "Bases skip: empty tiers keep ALL nodes (no LIMIT trim)");
	ok(
		[...modes.values()].every((m) => m === "full"),
		"Bases skip: every node is 'full' (no brief downgrade)",
	);
}

// ORDER_BY is irrelevant when tiers are empty: visibleNodes preserves the input
// order regardless of the order dir, proving no ranking ran.
{
	const asc = applyLimitRules(nodes, [], "name", "asc", (id) => id).visibleNodes;
	const desc = applyLimitRules(nodes, [], "name", "desc", (id) => id).visibleNodes;
	ok(
		asc.map((n) => n.id).join(",") === "z.md,a.md,m.md",
		"Bases skip: input order preserved under asc (ORDER_BY not applied)",
	);
	ok(
		desc.map((n) => n.id).join(",") === asc.map((n) => n.id).join(","),
		"Bases skip: order dir has no effect when tiers are empty (ORDER_BY skipped)",
	);
}

// Sanity contrast: WITH a tier, the SQL-like path DOES trim + order — proving the
// skip is meaningful (non-empty tiers behave differently).
{
	const { visibleNodes } = applyLimitRules(
		nodes,
		[{ kind: "limit", n: 2 }],
		"name",
		"asc",
		(id) => id,
	);
	ok(
		visibleNodes.length === 2,
		"SQL path contrast: a 'limit 2' tier trims to 2 nodes (skip is meaningful)",
	);
}
