#!/usr/bin/env bash
# Cron entry point for the Ralph loop — runs hourly, picks up where the last run
# left off (the loop is resume-safe: progress persists only via green commits, the
# working tree is reset between iterations, and an interrupted task stays open in
# ralph/BACKLOG.md). Designed to be safe to fire even while a previous hour's batch
# is still running (flock) or when the usage limit is exhausted (loop early-breaks).
#
# Install (hourly, on the minute):  0 * * * * /home/ubuntu/obsidian-plugins/tag-lens/ralph/cron.sh >> /tmp/tag-lens-ralph.log 2>&1
set -uo pipefail

# cron has a minimal env — make node (nvm), claude, and git reachable.
export HOME="${HOME:-/home/ubuntu}"
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"

REPO="/home/ubuntu/obsidian-plugins/tag-lens"
MAX_ITERS="${RALPH_MAX_ITERS:-12}"   # the loop early-breaks on usage limit, so this is just a ceiling
LOCK="$REPO/ralph/.cron.lock"

cd "$REPO" || { echo "ralph-cron: repo not found at $REPO"; exit 1; }

# Skip this tick if a previous batch is still running (no overlap, no queueing).
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "ralph-cron: $(date '+%F %T %Z') previous batch still running — skipping this tick."
  exit 0
fi

# Don't pile a fresh batch onto an already-busy machine. If the 1-minute load
# average is at/above the core count (i.e. the CPU is already saturated by other
# work), skip this tick — the next hour will retry against a clean, idle tree.
# Override the threshold with RALPH_LOAD_MAX (0 disables the guard).
if command -v nproc >/dev/null 2>&1; then
  LOAD_MAX="${RALPH_LOAD_MAX:-$(nproc)}"
  LOAD1="$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo 0)"
  if [[ "$LOAD_MAX" != 0 ]] && awk "BEGIN{exit !($LOAD1 >= $LOAD_MAX)}"; then
    echo "ralph-cron: $(date '+%F %T %Z') load $LOAD1 ≥ $LOAD_MAX — machine busy; skipping this tick."
    exit 0
  fi
fi

# Honour a manual pause: `touch ralph/STOP` halts scheduled runs without editing cron.
if [[ -e ralph/STOP ]]; then
  echo "ralph-cron: $(date '+%F %T %Z') ralph/STOP present — paused; skipping."
  exit 0
fi

echo "=== ralph-cron: $(date '+%F %T %Z') starting batch (cap $MAX_ITERS) ==="
ralph/loop.sh "$MAX_ITERS"
echo "=== ralph-cron: $(date '+%F %T %Z') batch done; HEAD $(git rev-parse --short HEAD 2>/dev/null) ==="
