#!/usr/bin/env bash
# Generic PROJECT OMEGA agent launcher (the "finish" harness).
#
# Usage: launch.sh <task-md> <worktree-name> <slug> <pkg> <title> <log>
#   task-md       task prompt, relative to repo root (e.g. .agent-tasks/time-core.md)
#   worktree-name dir name under .worktrees/      (e.g. agent-time)
#   slug          branch slug -> feat/<slug>      (e.g. time-core)
#   pkg           package dir name -> packages/<x> (e.g. time)
#   title         PR title                        (e.g. "feat(time): deterministic fixed-timestep clock")
#   log           log file path
#
# What it does:
#   1. creates a FRESH worktree from latest origin/main (no stale base -> fewer conflicts)
#   2. injects CONTRACT.md before the task prompt
#   3. runs the hermes agent
#   4. POST-RUN (no human polling needed): rebase onto origin/main -> run the gate
#      (vitest under a watchdog so a deadlock can't hang the harness) -> push ->
#      auto-open the PR (which queues feat/<slug> into .agent-tasks/prs-ready.txt)
#      -> self-cleanup of the worktree. If the gate fails or rebase conflicts, it
#      reports and STOPS (never opens a red/broken PR).
set -u
export REPO=/Users/yoi/omega
TASK="$1"; WT_NAME="$2"; SLUG="$3"; PKG="$4"; TITLE="$5"
# LOG must be absolute: launch.sh cd's into the worktree (line ~40), and
# .agent-tasks/ is untracked in main (never committed), so a relative path
# resolves to a non-existent dir inside the worktree and every >>"$LOG"
# redirect fails once we've cd'd — hermes still spawns as an orphan but the
# launcher thinks the agent step failed. Force an absolute log path.
case "$6" in
  /*) LOG="$6" ;;
  *)  LOG="$REPO/$6" ;;
esac
WT="$REPO/.worktrees/$WT_NAME"
BRANCH="feat/$SLUG"
CONTRACT="$REPO/.agent-tasks/CONTRACT.md"
LIB="$REPO/.agent-tasks/lib-omega-agent.sh"
TASK_PATH="$REPO/$TASK"
PR_READY="$REPO/.agent-tasks/prs-ready.txt"

: > "$LOG"
source "$LIB"

# 1. fresh worktree from latest main
git -C "$REPO" worktree remove "$WT" --force >/dev/null 2>&1 || true
git -C "$REPO" branch -D "$BRANCH" >/dev/null 2>&1 || true
git -C "$REPO" fetch origin main >/dev/null 2>&1
git -C "$REPO" worktree add "$WT" -b "$BRANCH" origin/main >>"$LOG" 2>&1

cd "$WT" || { echo "cd failed" >>"$LOG"; exit 1; }
echo "PWD=$(pwd)" >>"$LOG"

# 2. assemble prompt: CONTRACT (rules) first, then the task
PROMPT="$(cat "$CONTRACT"; printf '\n\n==== TASK ====\n'; cat "$TASK_PATH")"

# 3. run the agent
hermes chat -q "$PROMPT" --max-turns 120 -Q >>"$LOG" 2>&1
echo "AGENT_EXIT=$?" >>"$LOG"

# 4. POST-RUN: rebase + gate + open PR + self-cleanup
echo "=== POST-RUN: rebase onto origin/main ===" >>"$LOG"
if omega_rebase_main >>"$LOG" 2>&1; then
  echo "=== POST-RUN: verify gate ===" >>"$LOG"
  if omega_verify_gate "$PKG" >>"$LOG" 2>&1; then
    echo "=== POST-RUN: push + open PR ===" >>"$LOG"
    git push --force-with-lease -u origin "$BRANCH" >>"$LOG" 2>&1
    if omega_open_pr "$SLUG" "$PKG" "$TITLE" >>"$LOG" 2>&1; then
      echo "PR_OPENED" >>"$LOG"
      omega_cleanup_worktree "$WT_NAME" "$SLUG" >>"$LOG" 2>&1
    else
      echo "PR_OPEN_FAILED" >>"$LOG"
    fi
  else
    echo "GATE_FAIL: not opening PR" >>"$LOG"
  fi
else
  echo "REBASE_CONFLICT: PR not opened; manual resolution needed" >>"$LOG"
fi
echo "LAUNCHER_DONE" >>"$LOG"
