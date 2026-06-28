# Ralph loop — Tag Lens

Autonomous development/improvement loop, "Ralph" style (Geoffrey Huntley): a fixed
prompt is fed to a fresh, amnesiac headless agent over and over; the **filesystem is
the memory** and `npm run verify` is the safety net.

```
ralph/
├── PROMPT.md    the per-iteration instruction (the loop's "brain stem")
├── BACKLOG.md   the durable task list (the loop's actual memory) — edit this freely
├── loop.sh      the runner
└── logs/        per-iteration transcripts (gitignored)
```

## Run it

```bash
ralph/loop.sh          # up to 20 iterations on branch ralph/auto
ralph/loop.sh 5        # cap at 5 iterations
RALPH_MODEL=sonnet ralph/loop.sh   # cheaper model
```

Stop any time:

```bash
touch ralph/STOP       # graceful: finishes nothing new, exits before next iteration
#  …or just Ctrl-C
```

Review and land the work yourself (the loop never pushes):

```bash
git log --oneline main..ralph/auto
git switch main && git merge --ff-only ralph/auto    # or open a PR
```

## How each iteration works

1. Read `AGENTS.md` → `docs/<latest>/AGENTS.md` for the rules.
2. Pick the **single** topmost open `- [ ]` item in `BACKLOG.md` it can finish *and*
   verify now (large items get decomposed instead).
3. Implement it (preferring pure-module-plus-test over editing giant `view.ts` methods).
4. `npm run verify` — **commit only when green**; otherwise revert and log a `BLOCKER:`.
5. Update `BACKLOG.md` (check off done, append follow-ups).

## Safety model

- **Isolated branch** `ralph/auto` — never runs on `main`.
- **Never pushes / never touches the remote** — a human reviews before landing.
- **Green-only commits** — the agent reverts a red tree; `loop.sh` also hard-resets any
  leftover dirt between iterations so each amnesiac run starts clean.
- **Bounded** — iteration cap, `STOP` sentinel, and "stop when backlog empty".
- Runs with `--dangerously-skip-permissions` (required for unattended use); the branch
  isolation + no-push + verify gate are what make that acceptable. Run it on a machine/
  checkout you're willing to let edit files unattended.

## Driving it

You steer the loop almost entirely through `BACKLOG.md`. Add a task as a `- [ ]` line,
order it by putting it higher (top = sooner), and the next iteration will pick it up.
Keep tasks small and verifiable; that is what makes Ralph converge instead of thrash.
