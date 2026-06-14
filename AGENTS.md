# AGENTS.md — Tag Lens

Every agent working in this repo must first read the **authoritative docs for the current version**.

➡ **`docs/0.3.17/AGENTS.md`** (gotchas, verification gate, E2E/deploy workflow)
➡ **`docs/0.3.17/basic-design.md`** / **`docs/0.3.17/detailed-design.md`** (design)

Superseded material is isolated in `docs/old/` (no need to read).

## Bare-minimum rules (details above)
- After any change, **`npm run verify`** (`tsc --noEmit && test && build`) must be green. `tsc` is the only type gate.
- Search `src/layout.ts` with **`grep -a`** (NUL bytes make plain grep return empty silently).
- For E2E, use a separate profile + dedicated port, never kill the user's main Obsidian, always clean up, and check **reflection** — not just "no exception".
- Visual Encoding never changes the displayed node set (it is a separate layer from the SQL/dvjs filter).
