// Pure parse/clamp for the Bridge-finder "Min Jaccard similarity" number input
// (Settings > Display). Extracted from renderSettingsDisplayTab so the accept /
// reject rule is unit-testable without a DOM: the raw input string is accepted
// only when it parses to a finite number inside the closed [0, 1] range
// (Jaccard similarity is a fraction of shared/total). Returns the parsed value
// on accept, or `null` to signal "reject — keep the current setting and reset
// the input box". The view keeps the save/rebuild + input-reset wiring.
export function parseGhostJaccard(raw: string): number | null {
	const v = parseFloat(raw);
	return !Number.isNaN(v) && v >= 0 && v <= 1 ? v : null;
}
