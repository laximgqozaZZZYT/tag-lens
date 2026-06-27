// Shared config for E2E (test/e2e/) and scratch (test/scratch/) scripts.
// Single source of truth for the target Obsidian vault and CDP port so they are
// NOT hardcoded in every script. Override per-invocation via env vars — no file
// edits needed:
//
//   TAG_LENS_VAULT=/path/to/other/vault  node test/e2e/e2e-display.mjs
//   TAG_LENS_CDP_PORT=9333               node test/e2e/e2e-display.mjs
//
// Defaults point at the current development vault.
export const VAULT = process.env.TAG_LENS_VAULT || "/home/ubuntu/obsidian-plugins/開発";
export const CDP_PORT = Number(process.env.TAG_LENS_CDP_PORT || 9222);

// Dedicated MINIMAL vault for the BubbleSets E2E (test/e2e/e2e-bubblesets.mjs).
// Kept separate from VAULT (the deploy target / dev vault) so the E2E opens only
// a handful of files — this avoids exhausting the system inotify watch budget
// (fs.inotify.max_user_watches), which stalls vault.open() on the big dev vault.
// Generated/refreshed by test/e2e/setup-e2e-vault.mjs.
export const E2E_VAULT = process.env.TAG_LENS_E2E_VAULT || "/tmp/tag-lens-e2e-vault";
