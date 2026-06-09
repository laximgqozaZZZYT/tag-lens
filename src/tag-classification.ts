// Tag classification ("golder type") shared definitions + the rule that decides
// the Suggested-Classification dropdown's initial value. Kept DOM-free so the
// resolution rule is unit-testable (test/run.mjs) independently of Obsidian.

// Canonical classification keys. MUST stay in sync with the TYPE_LABELS /
// TYPE_DESCRIPTIONS maps in view.ts (the dropdown + info modal).
export const GOLDER_TYPES = [
	"what_it_is",
	"what_it_contains",
	"who_owns_it",
	"refined_category",
	"qualities",
	"task_org",
	"self_ref",
] as const;

export type GolderType = (typeof GOLDER_TYPES)[number];

export function isGolderType(v: unknown): v is GolderType {
	return typeof v === "string" && (GOLDER_TYPES as readonly string[]).includes(v);
}

// The dropdown's initial value: a user's persisted classification (tag-page
// frontmatter `golder_type`) wins over the heuristic suggestion. An absent or
// unrecognised persisted value falls back to the suggestion, so a stale/garbage
// frontmatter entry can never select a non-existent dropdown option.
export function effectiveClassification(persisted: unknown, suggestion: string): string {
	return isGolderType(persisted) ? persisted : suggestion;
}
