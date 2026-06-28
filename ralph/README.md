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

## Scheduled (hourly) runs

A cron entry resumes the loop **once an hour** — it picks up exactly where the last
batch stopped, because the loop is resume-safe (progress persists only via green
commits; an interrupted task stays open in `BACKLOG.md`). This is the answer to the
usage limit: each hourly batch works until the limit, the loop **early-breaks** the
moment a "session/usage limit" line appears, and the next hour resumes.

```cron
40 * * * * /home/ubuntu/obsidian-plugins/tag-lens/ralph/cron.sh >> /tmp/tag-lens-ralph.log 2>&1
```

`ralph/cron.sh` fixes the PATH for cron (nvm-node/claude/git), takes a `flock` so a
slow batch never overlaps the next tick, and honours `ralph/STOP` as a pause switch.

```bash
tail -f /tmp/tag-lens-ralph.log     # watch the scheduled runs
touch ralph/STOP                    # pause scheduled runs (no crontab edit needed)
rm ralph/STOP                       # resume
crontab -l | grep -A2 TAG-LENS-RALPH   # inspect the entry; edit/remove with `crontab -e`
```

> Caveat: the loop runs on branch `ralph/auto` in the main working tree. If you are
> editing this repo on another branch when the hour fires, `git switch ralph/auto`
> can clash — pause with `ralph/STOP` while you work, or move the loop to a dedicated
> git worktree for full isolation.

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
