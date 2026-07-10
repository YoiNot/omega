#!/usr/bin/env bash
# Shared helpers for the PROJECT OMEGA agent launcher.
# Source this from launch.sh:  source "$(dirname "${BASH_SOURCE[0]}")/lib-omega-agent.sh"
set -u

# REPO root is exported by launch.sh; defaults to the OMEGA path if unset.
REPO="${REPO:-/Users/yoi/omega}"
PR_READY="$REPO/.agent-tasks/prs-ready.txt"

# omega_vitest_secured <pkg> [timeout_sec]
# Run `npx vitest run packages/<pkg>` under a Python watchdog so a deadlocking
# test (parallelism artifact / unbounded loop) CANNOT hang the harness forever.
# Writes combined stdout/stderr to /tmp/omega_gate_test.log (same path the PR
# body reads). Returns 0 if vitest exits 0 within the timeout, 1 otherwise.
omega_vitest_secured() {
  local pkg="$1" timeout_sec="${2:-90}"
  cat >/tmp/omega_watchdog.py <<PY
import subprocess, signal, sys, time
proc = subprocess.Popen(
    ["npx", "vitest", "run", "packages/$pkg"],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
start = time.time()
while proc.poll() is None and time.time() - start < $timeout_sec:
    time.sleep(0.5)
if proc.poll() is None:
    # Hang/deadlock: kill the whole vitest tree and report.
    try:
        import os
        os.kill(proc.pid, signal.SIGKILL)
        # also reap any child workers
        import psutil  # noqa: optional
    except Exception:
        pass
    try:
        proc.kill()
    except Exception:
        pass
    proc.communicate(timeout=5)
    sys.stderr.write(f"\nWATCHDOG: vitest hung > ${timeout_sec}s (deadlock) — killed\n")
    sys.exit(2)
out, _ = proc.communicate(timeout=10)
sys.stdout.write(out)
sys.exit(proc.returncode)
PY
  python3 /tmp/omega_watchdog.py >/tmp/omega_gate_test.log 2>&1
  return $?
}

# omega_verify_gate <pkg>
# Runs the mandatory pre-PR gate. Echoes PASS/FAIL. Returns 0 iff all green.
omega_verify_gate() {
  local pkg="$1"
  echo "=== GATE: npx tsc -b packages/$pkg ==="
  if ! npx tsc -b "packages/$pkg" >/tmp/omega_gate_tsc.log 2>&1; then
    echo "GATE: FAIL (tsc packages/$pkg)"; tail -15 /tmp/omega_gate_tsc.log; return 1
  fi
  echo "=== GATE: npx tsc -b (whole repo) ==="
  if ! npx tsc -b >/tmp/omega_gate_tscw.log 2>&1; then
    echo "GATE: FAIL (tsc -b whole repo)"; tail -15 /tmp/omega_gate_tscw.log; return 1
  fi
  echo "=== GATE: npx vitest run packages/$pkg (secured, 90s watchdog) ==="
  if ! omega_vitest_secured "$pkg" 90; then
    echo "GATE: FAIL (vitest packages/$pkg — hung or red)"; tail -25 /tmp/omega_gate_test.log; return 1
  fi
  echo "GATE: PASS"
  return 0
}

# omega_rebase_main
# Best-effort rebase onto latest origin/main. Retries once after a short delay
# (concurrent agents may have just merged). Returns 0 if clean, 1 if conflict.
omega_rebase_main() {
  git fetch origin main >/dev/null 2>&1
  if git rebase origin/main >/tmp/omega_rebase.log 2>&1; then
    echo "REBASE: clean onto origin/main"; return 0
  fi
  echo "REBASE: first attempt conflict — retry once after 20s"; sleep 20
  git rebase --abort >/dev/null 2>&1
  git fetch origin main >/dev/null 2>&1
  if git rebase origin/main >/tmp/omega_rebase.log 2>&1; then
    echo "REBASE: clean on retry"; return 0
  fi
  echo "REBASE: conflict — aborted, needs manual resolution"
  git rebase --abort >/dev/null 2>&1
  return 1
}

# omega_open_pr <slug> <pkg> <title>
# Opens the PR only if one is not already open for this branch. On success, appends
# the branch to the PR-ready queue so the orchestrator does NOT have to poll.
omega_open_pr() {
  local slug="$1" pkg="$2" title="$3"
  if gh pr list --head "feat/$slug" --state open --json number 2>/dev/null | grep -q 'number'; then
    echo "PR already open for feat/$slug — skipping"; return 0
  fi
  local commits testsum
  commits="$(git log --oneline "origin/main..HEAD")"
  testsum="$(grep -E 'Test Files|Tests ' /tmp/omega_gate_test.log | tr '\n' ' ')"
  {
    echo "## Summary"
    echo "Adds @omega/$pkg (built via the agent contract + launcher harness)."
    echo
    echo "## Commits (small, one concern each)"
    echo "$commits" | sed 's/^/- /'
    echo
    echo "## Gate results"
    echo "- \`npx tsc -b packages/$pkg\` -> exit 0"
    echo "- \`npx tsc -b\` (whole repo) -> exit 0"
    echo "- \`npx vitest run packages/$pkg\` -> $testsum"
  } >/tmp/omega_pr_body.md
  if gh pr create --base main --head "feat/$slug" --title "$title" --body-file /tmp/omega_pr_body.md; then
    # Signal the orchestrator via a queue file (no polling needed).
    echo "feat/$slug" >>"$PR_READY"
    echo "QUEUED feat/$slug for merge"
    return 0
  fi
  echo "PR_OPEN_FAILED"; return 1
}

# omega_cleanup_worktree <wt-name> <slug>
# Best-effort removal of the agent's own worktree + local branch after the PR is
# open. Safe to call post-PR; the remote branch is already gone via the merge later.
omega_cleanup_worktree() {
  local wt="$1" slug="$2"
  git -C "$REPO" worktree remove "$REPO/.worktrees/$wt" --force >/dev/null 2>&1 || true
  git -C "$REPO" branch -D "feat/$slug" >/dev/null 2>&1 || true
  echo "CLEANUP: removed worktree $wt + branch feat/$slug"
}
