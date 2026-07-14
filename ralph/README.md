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

### Load protection (keep the host responsive)

The batch runs a heavy pipeline — `claude` (opus) plus `npm run verify`
(tsc×2 · biome · tests · knip · esbuild) plus `npm run deploy` — up to a dozen
times back-to-back. To stop that from pinning every core and crashing the host,
the loop is throttled:

- **Idle priority.** `loop.sh` re-execs the whole batch under `nice -n 19 ionice -c 3`,
  so every child (claude, tsc, biome, knip, esbuild) yields the CPU/disk to the
  desktop and system — the machine stays responsive even at full tilt.
- **Cool-down between iterations** — `RALPH_COOLDOWN` seconds (default 20) of idle
  between bursts, so temps/power settle instead of sustaining an all-core pin.
- **Node heap cap** — `RALPH_NODE_HEAP_MB` (default 4096) caps each Node process so a
  runaway tool can't exhaust RAM and thrash swap.
- **Busy-host guard** — `cron.sh` skips the tick if the 1-minute load average is
  already ≥ the core count (override with `RALPH_LOAD_MAX`, `0` disables).
- **Lower ceiling** — default cap is **12** iterations/batch (was 25); the loop still
  early-breaks on the usage limit, so this is just an upper bound.

```bash
tail -f /tmp/tag-lens-ralph.log     # watch the scheduled runs
touch ralph/STOP                    # pause scheduled runs (no crontab edit needed)
rm ralph/STOP                       # resume
crontab -l | grep -A2 TAG-LENS-RALPH   # inspect the entry; edit/remove with `crontab -e`
RALPH_COOLDOWN=45 RALPH_MAX_ITERS=6 ralph/loop.sh   # even gentler manual run
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
6. **Deploy:** every iteration that produced a commit runs `npm run deploy`, mirroring
   the freshly-built plugin (`main.js`/`manifest.json`/`styles.css`) into the dev
   vault's same-named `tag-lens` plugin folder (`$TAG_LENS_VAULT`, default the 開発
   vault). Reload Obsidian to see the change. A deploy failure is logged but never
   aborts the loop — the commit always stands.

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
