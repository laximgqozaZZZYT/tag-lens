// P4 — view.ts line-count ratchet. `src/view.ts` is the project's giant file;
// every Kaizen step should shrink it (extract pure modules + a unit test) and
// never grow it. This guard fails the moment view.ts exceeds its recorded
// baseline, locking in past extractions.
//
// When you legitimately extract code out of view.ts and the count drops, LOWER
// `BASELINE` to the new number in the same commit — the ratchet only goes down.
// Adding lines to view.ts is the case this test is here to prevent: if you must,
// the bump is a deliberate, reviewable diff to this one constant.
import { readFileSync } from "node:fs";
import { ok } from "./assert";

// Recorded baseline (wc -l semantics: newline-terminated lines).
const BASELINE = 4328;

const text = readFileSync("src/view.ts", "utf8");
const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

ok(
	lines <= BASELINE,
	`src/view.ts grew to ${lines} lines (baseline ${BASELINE}). ` +
		"view.ts must only shrink — extract a pure module instead of adding here. " +
		`If the growth is unavoidable, bump BASELINE to ${lines} in this file with a reason.`,
);
