// Fallback `.base` auto-generation. When a vault contains NO `.base` file at all,
// Bases mode would have nothing to scope to (blank Bases experience). To make
// every note graph-able out of the box, we synthesise a single `_all.base` at
// the vault root whose view declares NO filter — which `evalBaseFilter(null, …)`
// treats as match-all, so `resolveElements` emits every markdown note.
//
// Strict, non-destructive contract (see ensureFallbackBase):
//   - Generate ONLY when `scanBaseFiles` is empty (zero `.base` of any name).
//   - Never overwrite an existing file (idempotent; create() throws if present,
//     we swallow and return the existing handle when it's our `_all.base`).
//   - Any failure returns null and is swallowed so rebuild() is never broken.

import type { App, TFile } from "obsidian";
import { scanBaseFiles } from "./parser";

// Vault-root path of the auto-generated fallback base.
export const FALLBACK_BASE_PATH = "_all.base";

// YAML body for the fallback base: a single table view over ALL notes. The
// ABSENCE of a `filters` key is deliberate — parseBaseFilter(undefined) → null →
// evalBaseFilter(null, facts) === true ⇒ every note matches (match-all).
export const FALLBACK_BASE_CONTENT = `views:
  - type: table
    name: All notes
    order:
      - file.name
`;

// Pure predicate so tests can verify the gate without an Obsidian runtime:
// generate ONLY when there is not a single `.base` file in the vault.
export function shouldGenerateFallback(baseFilePaths: readonly string[]): boolean {
	return baseFilePaths.length === 0;
}

// Create `_all.base` at the vault root IFF the vault has zero `.base` files.
// Idempotent: with any `.base` present (including a prior `_all.base`) this is a
// no-op. Returns the (possibly pre-existing) fallback TFile, or null on failure
// / when generation is gated off. Never throws.
export async function ensureFallbackBase(app: App): Promise<TFile | null> {
	try {
		const existing = scanBaseFiles(app);
		if (!shouldGenerateFallback(existing.map((f) => f.path))) {
			// A `.base` already exists somewhere — never write into the vault.
			return null;
		}

		// Defensive: if `_all.base` already exists (e.g. a stale non-`.base`
		// extension edge case), reuse it instead of creating a duplicate.
		const prior = app.vault.getAbstractFileByPath(FALLBACK_BASE_PATH);
		if (prior && isTFile(prior)) return prior;

		const created = await app.vault.create(FALLBACK_BASE_PATH, FALLBACK_BASE_CONTENT);
		return created;
	} catch (e) {
		console.warn("[tag-lens] ensureFallbackBase failed (continuing without fallback):", e);
		return null;
	}
}

function isTFile(f: unknown): f is TFile {
	return typeof f === "object" && f !== null && "extension" in f && "stat" in f;
}
