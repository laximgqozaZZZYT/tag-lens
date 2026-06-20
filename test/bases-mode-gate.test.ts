// UI-rework guard: the Bases SCOPE in rebuild() must fire ONLY when the Logic
// source is "bases" AND at least one `.base` is selected. sql/dvjs modes never
// scope (even if selectedBases still holds stale values), and bases-with-empty
// falls back to the classic pipeline. shouldScopeToBases is the single gate.
import { ok } from "./assert";
import { shouldScopeToBases } from "../src/bases/project";

// bases mode + a selection ⇒ SCOPE.
ok(
	shouldScopeToBases("bases", ["A.base"]) === true,
	"bases mode with a selection must scope",
);

// bases mode + empty selection ⇒ NO scope (classic fallback, no blank canvas).
ok(
	shouldScopeToBases("bases", []) === false,
	"bases mode with empty selection must NOT scope (fallback)",
);
ok(
	shouldScopeToBases("bases", undefined) === false,
	"bases mode with undefined selection must NOT scope",
);

// sql / dvjs modes never scope, even with stale selectedBases values present.
ok(
	shouldScopeToBases("sql", ["A.base", "B.base"]) === false,
	"sql mode must ignore selectedBases (no scope)",
);
ok(
	shouldScopeToBases("dvjs", ["A.base"]) === false,
	"dvjs mode must ignore selectedBases (no scope)",
);
