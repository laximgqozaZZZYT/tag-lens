// Gate guard: rebuild()'s HAVING (cluster-size filter/highlight) stage runs for
// BOTH sql AND dvjs modes — HAVING only inspects cluster member counts, so it
// works identically whether the grouping came from settings.groupBy (sql) or a
// dvjs script's returned groups. Bases mode is always excluded (baseScoped).
// LIMIT/ORDER_BY stay sql-only and are gated separately (filterMode === "sql"),
// NOT by shouldApplyHaving — this test pins that split so a future edit can't
// silently widen LIMIT to dvjs or narrow HAVING back to sql-only.
import { ok } from "./assert";
import { computeDroppedClusters, shouldApplyHaving } from "../src/query/query-pipeline";
import type { GraphNode, MiniSettings } from "../src/types";

// ── shouldApplyHaving: sql AND dvjs apply HAVING; bases never does ──
ok(
	shouldApplyHaving("sql", false) === true,
	"sql mode (not base-scoped) applies HAVING",
);
ok(
	shouldApplyHaving("dvjs", false) === true,
	"dvjs mode (not base-scoped) applies HAVING (the new behavior)",
);
ok(
	shouldApplyHaving("bases", false) === false,
	"bases mode never applies HAVING (base projection is its own complete graph)",
);
// baseScoped overrides everything: even sql/dvjs skip HAVING when scoped to a base.
ok(
	shouldApplyHaving("sql", true) === false,
	"base-scoped sql skips HAVING",
);
ok(
	shouldApplyHaving("dvjs", true) === false,
	"base-scoped dvjs skips HAVING",
);

// ── LIMIT/ORDER_BY split: those use filterMode === "sql" directly, so dvjs must
// NOT qualify. Mirror that condition here to prove HAVING and LIMIT diverge for
// dvjs (HAVING=on, LIMIT=off). If both used the same gate this would fail. ──
{
	// Mirrors view.ts's applySqlPostFilters: LIMIT/ORDER_BY are sql-only.
	const limitApplies = (mode: MiniSettings["filterMode"], baseScoped: boolean) =>
		!baseScoped && mode === "sql";
	ok(
		shouldApplyHaving("dvjs", false) === true && limitApplies("dvjs", false) === false,
		"dvjs: HAVING applies but LIMIT/ORDER_BY do NOT (gates are split)",
	);
	ok(
		shouldApplyHaving("sql", false) === true && limitApplies("sql", false) === true,
		"sql: both HAVING and LIMIT/ORDER_BY apply",
	);
}

// ── End-to-end: the SAME computeDroppedClusters drives HAVING regardless of how
// clusters were formed. dvjs-derived clusters (memberships set from a script's
// returned groups) drop oversized/undersized clusters exactly like sql ones. ──
{
	// 3 notes in cluster "big", 1 note in cluster "small" — as if a dvjs script
	// returned { path, groups } that produced these memberships.
	const nodes: GraphNode[] = [
		{ id: "a.md", label: "a", memberships: ["big"] },
		{ id: "b.md", label: "b", memberships: ["big"] },
		{ id: "c.md", label: "c", memberships: ["big"] },
		{ id: "d.md", label: "d", memberships: ["small"] },
	];
	// HAVING "count >= 2" should drop "small" (1 member) and keep "big" (3).
	const { dropped, errors } = computeDroppedClusters(nodes, ["count >= 2"], false, { _noteCount: 4 });
	ok(errors.length === 0, "HAVING on dvjs-derived clusters parses without error");
	ok(dropped.has("small"), "HAVING drops the undersized dvjs cluster (count 1 < 2)");
	ok(!dropped.has("big"), "HAVING keeps the qualifying dvjs cluster (count 3 >= 2)");
	ok(dropped.get("small") === 1, "dropped map carries the failing cluster's member count");
}
