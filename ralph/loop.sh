#!/usr/bin/env bash
# Ralph loop for Tag Lens — runs the headless agent on a fixed prompt until the
# backlog is empty, an iteration cap is hit, or a STOP sentinel appears.
#
#   ralph/loop.sh [MAX_ITERS]      # default 20
#
# Env knobs:
#   RALPH_MODEL    model alias/name passed to `claude --model` (default: opus)
#   RALPH_BRANCH   working branch (default: ralph/auto)
#
# Safety model: dedicated branch, never pushes, the agent commits only when
# `npm run verify` is green and reverts otherwise. Stop any time with:
#   touch ralph/STOP      (or Ctrl-C)
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1            # repo root
ROOT="$(pwd)"
MAX_ITERS="${1:-20}"
MODEL="${RALPH_MODEL:-opus}"
BRANCH="${RALPH_BRANCH:-ralph/auto}"
LOG_DIR="ralph/logs"
mkdir -p "$LOG_DIR"

command -v claude >/dev/null || { echo "ralph: 'claude' CLI not found on PATH" >&2; exit 1; }

# Work on an isolated branch, never on the default branch.
git rev-parse --verify "$BRANCH" >/dev/null 2>&1 \
  && git switch "$BRANCH" \
  || git switch -c "$BRANCH"
echo "ralph: on branch '$BRANCH', model '$MODEL', up to $MAX_ITERS iteration(s)"

for ((i = 1; i <= MAX_ITERS; i++)); do
  stamp="$(date +%Y%m%d-%H%M%S)"
  log="$LOG_DIR/iter-$(printf '%03d' "$i")-$stamp.log"

  [[ -e ralph/STOP ]] && { echo "ralph: STOP sentinel present — exiting."; break; }
  if ! grep -qE '^\s*-\s*\[ \]' ralph/BACKLOG.md; then
    echo "ralph: no open '- [ ]' items in BACKLOG.md — done."; break
  fi
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ralph: working tree is dirty before iteration $i — aborting to stay safe." >&2
    echo "       commit/stash your changes, then re-run." >&2; exit 1
  fi

  echo "=== ralph iteration $i/$MAX_ITERS @ $stamp ===" | tee "$log"
  before="$(git rev-parse HEAD)"

  claude -p "$(cat ralph/PROMPT.md)" \
    --model "$MODEL" \
    --permission-mode bypassPermissions \
    --dangerously-skip-permissions \
    2>&1 | tee -a "$log"

  # Belt-and-braces: if the agent left the tree dirty (verify red, forgot to
  # revert), restore cleanliness so the next amnesiac iteration starts fresh.
  if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
    echo "ralph: tree dirty after iteration $i — reverting uncommitted changes." | tee -a "$log"
    git reset --hard >/dev/null 2>&1
    git clean -fd >/dev/null 2>&1   # logs/ is gitignored, so it survives
  fi

  after="$(git rev-parse HEAD)"
  [[ "$before" == "$after" ]] \
    && echo "ralph: iteration $i made no commit (blocked or idle)." | tee -a "$log" \
    || echo "ralph: iteration $i committed $after." | tee -a "$log"

  # Usage/session limit: stop the batch immediately instead of burning the rest
  # of the cap on no-ops. The next scheduled run resumes from the clean tree.
  if grep -qiE "hit your (session|usage) limit|usage limit reached|rate limit|reset(s)? at" "$log"; then
    echo "ralph: usage/session limit reached — ending this batch; next run resumes." | tee -a "$log"
    break
  fi
done

echo "ralph: loop finished on '$BRANCH'. Review with: git log --oneline $(git rev-parse --abbrev-ref '@{u}' 2>/dev/null || echo main).."$BRANCH""
