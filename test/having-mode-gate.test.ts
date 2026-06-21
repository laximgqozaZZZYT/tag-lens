// Gate guard: rebuild()'s HAVING (cluster-size filter/highlight) stage is
// sql-only. HAVING is an SQL-like post-projection filter; in dvjs mode the
// script's return value is the single source of truth for grouping (mirroring
// GROUP_BY), so there is NO hidden cluster-size post-processing and dvjs must
// NOT apply HAVING. Bases mode is always excluded (baseScoped). This test pins
// that split so a future edit can't silently widen HAVING back to dvjs.
import { ok } from "./assert";
import { computeDroppedClusters, shouldApplyHaving } from "../src/query/query-pipeline";
import type { GraphNode, MiniSettings } from "../src/types";

// ── shouldApplyHaving: only sql applies HAVING; dvjs and bases never do ──
ok(
	shouldApplyHaving("sql", false) === true,
	"sql mode (not base-scoped) applies HAVING",
);
ok(
	shouldApplyHaving("dvjs", false) === false,
	"dvjs mode never applies HAVING (the script's groups are the single source of truth)",
);
ok(
	shouldApplyHaving("bases", false) === false,
	"bases mode never applies HAVING (base projection is its own complete graph)",
);
// baseScoped overrides everything: even sql skips HAVING when scoped to a base.
ok(
	shouldApplyHaving("sql", true) === false,
	"base-scoped sql skips HAVING",
);
ok(
	shouldApplyHaving("dvjs", true) === false,
	"base-scoped dvjs skips HAVING",
);

// ── HAVING and LIMIT/ORDER_BY share the same sql-only condition: dvjs must NOT
// qualify for either. Mirror the LIMIT gate here to prove dvjs gets neither. ──
{
	// Mirrors view.ts's applySqlPostFilters: LIMIT/ORDER_BY are sql-only.
	const limitApplies = (mode: MiniSettings["filterMode"], baseScoped: boolean) =>
		!baseScoped && mode === "sql";
	ok(
		shouldApplyHaving("dvjs", false) === false && limitApplies("dvjs", false) === false,
		"dvjs: neither HAVING nor LIMIT/ORDER_BY apply",
	);
	ok(
		shouldApplyHaving("sql", false) === true && limitApplies("sql", false) === true,
		"sql: both HAVING and LIMIT/ORDER_BY apply",
	);
}

// ── computeDroppedClusters remains a pure, gate-agnostic helper used by the
// sql HAVING stage: given cluster memberships and a count threshold it drops
// the undersized/oversized clusters. (Only reached when shouldApplyHaving is
// true, i.e. sql mode.) ──
{
	const nodes: GraphNode[] = [
		{ id: "a.md", label: "a", memberships: ["big"] },
		{ id: "b.md", label: "b", memberships: ["big"] },
		{ id: "c.md", label: "c", memberships: ["big"] },
		{ id: "d.md", label: "d", memberships: ["small"] },
	];
	// HAVING "count >= 2" should drop "small" (1 member) and keep "big" (3).
	const { dropped, errors } = computeDroppedClusters(nodes, ["count >= 2"], false, { _noteCount: 4 });
	ok(errors.length === 0, "HAVING parses without error");
	ok(dropped.has("small"), "HAVING drops the undersized cluster (count 1 < 2)");
	ok(!dropped.has("big"), "HAVING keeps the qualifying cluster (count 3 >= 2)");
	ok(dropped.get("small") === 1, "dropped map carries the failing cluster's member count");
}
