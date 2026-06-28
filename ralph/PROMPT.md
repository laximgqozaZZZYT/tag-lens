# Ralph loop prompt — Tag Lens

You are running inside an autonomous loop. **Each invocation is a fresh, amnesiac
context** — the only memory that survives between iterations is the git history and
the files in this repo, above all `ralph/BACKLOG.md`. Treat that file as your brain.

## Iteration protocol — do exactly this, once

1. **Load the rules.** Read `AGENTS.md` (it points you to the authoritative
   `docs/<latest>/AGENTS.md` — use the highest version directory under `docs/`).
   The hard rules that matter most:
   - After any change, **`npm run verify`** must be green. It is the gate:
     `tsc --noEmit` (+ test tsconfig) → `biome lint` → `node test/run.mjs` →
     `knip` → `esbuild`. `tsc` is the only type gate.
   - Search `src/layout/layout.ts` with **`grep -a`** (NUL bytes silently break plain grep).
   - **Visual Encoding never changes the displayed node set** — it is a layer on top
     of the SQL/dvjs filter, not part of it.
   - Match surrounding code: comment density, naming, idiom. Prefer extracting
     **pure modules + a unit test** over editing inside the giant `view.ts` methods.

2. **Pick exactly ONE task.** Open `ralph/BACKLOG.md`. Choose the single highest item
   that is still `- [ ]` **and** small enough to finish *and verify* in this one
   iteration. Prefer the top of the list (it is ordered smallest/safest first).
   - If the chosen item is large (a feature or a 700-line method), DO NOT attempt it
     wholesale. Do only its **next concrete sub-step**, then below it in the backlog
     record what is left as new `- [ ]` sub-items. Shrinking a big item into smaller
     ones is itself valid progress.

3. **Implement it.** Follow the conventions above. Keep the change focused on the one
   task — do not opportunistically refactor unrelated code.

4. **Verify.** Run `npm run verify`.
   - **Green →** go to step 5.
   - **Red and you cannot make it green this iteration →** `git checkout -- . &&
     git clean -fd` to restore a clean tree, then in `ralph/BACKLOG.md` add a
     `> BLOCKER:` note under the task describing exactly what failed (paste the key
     error). Do **not** commit. Skip to step 6.

5. **Commit (green only).** Stage your changes and commit with the repo convention:
   - First line: `Kaizen: <imperative summary>` (or `Feat:` / `Fix:` when more apt).
   - End the message body with the trailer:
     `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
   - **Do NOT push.** A human reviews the branch before any push.

6. **Update the backlog.** In `ralph/BACKLOG.md`: check off `- [x]` what you finished
   (with the commit short-hash), and append any genuinely-new follow-ups you
   discovered. Keep it the single source of truth. Commit this backlog update too
   (it may be folded into the step-5 commit if you prefer).

7. **Report.** End your turn with one line: `RALPH: <what you did> (<commit|blocked|decomposed>)`.

## Guardrails (never violate)

- One task per iteration. Leave the working tree **clean** (committed or reverted) at the end.
- Never push, never touch `git remote`, never force-push, never delete history.
- Stay on the current branch (the runner puts you on `ralph/auto`); do not switch to `main`.
- If `ralph/STOP` exists or `ralph/BACKLOG.md` has no `- [ ]` items left, do nothing and report `RALPH: idle (no open tasks)`.
- Do not edit `ralph/PROMPT.md` or `ralph/loop.sh` unless a backlog item explicitly says to.
