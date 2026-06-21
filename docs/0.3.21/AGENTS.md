# AGENTS.md — Tag Lens v0.3.21 (required reading, authoritative)

The standard every agent (human/AI) working in this repo reads first. It collects the
traps, verification gate, and key workflows that agents have repeatedly hit. For the
full design see **basic-design.md** / **detailed-design.md** in this directory.

---

## 0. Verification gate (required)
- After any change, **`npm run verify`** (= `tsc --noEmit && test && build`) must be green.
- **Neither `npm run build` (esbuild) nor `npm test` type-checks.** Type rot slips past
  esbuild and ships silently. **The only type gate is `tsc --noEmit`** (`npm run typecheck` alone also works).
- ~30 tsc errors once sat unfixed after passing build/test. A green `verify` is the **merge condition**.

## 1. Gotchas
1. **`src/layout.ts` contains NUL bytes (sentinel strings).** Plain `grep` treats it as binary and
   returns empty *without warning* → always use **`grep -a`** when searching `layout.ts`.
2. **`src/view.ts` is a ~5200-line god-file.** Line numbers drift constantly; re-anchor with `grep -n` before editing.
   The split is in `docs/0.3.21/refactor-view-split.md` (Tier 1–3 done, Tier 4 = drawing, deferred).
3. **Visual Encoding (`src/encoding/`) is a separate layer from the Bases projection filter.**
   It must never change *which* notes are shown (attribute → visual-channel mapping only). In review, always
   confirm the displayed node set / count did not change because of encoding.
4. **A new settings field must be added to both the `MiniSettings` interface and `DEFAULT_SETTINGS`**
   (missing one is a type-rot cause).
5. **Attribute propagation in layout**: every `nodes.push` must carry `mtime/fmStatus/fmMaturity/ageDays`
   (dropping them silently disables status/freshness/maturity/encoding).
6. **Keep per-mode guards and the applicability table in sync**: `draw()`'s `!laid.upset`/`!laid.setNodeIds`
   guards must match `display-applicability.ts`.
7. **Test directory layout (keep `test/` root clean):**
   - `test/*.test.ts` — unit tests, the only thing `npm run verify` runs (`test/run.mjs` bundles `test/index.ts`). Register every new test in `test/index.ts`.
   - `test/e2e/` — reusable CDP E2E harnesses (tracked). Import vault/port from `../config.mjs`.
   - `test/scratch/` — disposable one-off debug/render experiments (**git-ignored**; never committed). Put throwaway scripts here, not in `test/` root.
   - `test/config.mjs` / `test/run.mjs` / `test/assert.ts` / `test/obsidian.mock.ts` stay at `test/` root.

## 2. Deploy (dev vault)
```
npm run deploy          # builds, then copies main.js/manifest.json/styles.css into the vault
```
The target vault is `test/config.mjs`'s `VAULT` (default = the dev vault); override
without editing files: `TAG_LENS_VAULT=/path/to/vault npm run deploy`. Same env var
as the E2E harness. Reload Obsidian after deploying.

## 3. E2E (real Obsidian / CDP)
- Zero-dependency CDP driver (Node 22 global WebSocket/fetch). Reference: `test/e2e/e2e-display.mjs`, `test/e2e/e2e-closeup.mjs`.
- **Never kill the user's main Obsidian (`~/.config/obsidian`).** Always launch a *separate instance with
  its own profile and port*, and on exit kill **only** that profile's process
  (e.g. `--user-data-dir=/tmp/obs-<name> --remote-debugging-port=92XX`, with obsidian.json pre-registering
  the dev vault `open:true`). **Always clean up afterwards (kill + remove /tmp)** — leaked processes have happened.
- **Target Vault is NOT hardcoded.** All scripts import it from `test/config.mjs`
  (`export const VAULT = process.env.TAG_LENS_VAULT || "/home/ubuntu/obsidian-plugins/開発"`).
  Default = the dev vault; override per-run without editing files:
  `TAG_LENS_VAULT=/path/to/vault node test/e2e/e2e-display.mjs` (also `TAG_LENS_CDP_PORT`).
  Never re-introduce a literal vault path in a script — add/extend `test/config.mjs` instead.
- **A "no exception" result is not a pass.** Bugs that render nothing yet throw nothing (`fillStyle=number`,
  dropped layout fields) slip past a no-exception check. Verify the **actual reflection** (draw params /
  laid.nodes / pixels). Beware writing expectations as a mirror of the implementation — that yields false positives.
- **Closeup Transitions:** Validate `switchToCloseup` and `switchToPanorama` roundtrips across all view modes to prevent `undefined` array iteration (`ids is not iterable`) or filtering issues.

## 4. Working principles
- Don't take reviewer/grep/E2E results at face value; confirm against the real code (a "works" verdict was wrong twice).
- Spec changes go plan → approval → implement. To stop multi-agent design drift, treat this directory's design docs as the single source of truth.
- Refactors are behaviour-preserving, verify-green, one-extraction-one-commit.

## 5. References
- Design: `docs/0.3.21/basic-design.md`, `docs/0.3.21/detailed-design.md`
- In progress: `docs/0.3.21/refactor-view-split.md` (view.ts split)
- Handoff: `docs/0.3.21/handoff-droste-axis.md` (Icon Gallery custom-axis Cartesian)
- Archived (no need to read; isolated to avoid confusion): `docs/old/`
