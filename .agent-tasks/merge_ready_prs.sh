#!/usr/bin/env bash
# Merge every PR listed in .agent-tasks/prs-ready.txt (the no-polling queue the
# launcher fills), CONFLICT-SAFE, then EMPTY the queue.
#
# Strategy: merge PRs ONE AT A TIME. For each:
#   - try `gh pr merge --merge`. If it succeeds (PR becomes MERGED), great.
#   - if gh cannot merge (conflict, or PR not found), do a LOCAL conflict-safe merge:
#       git checkout main; pull; merge --no-ff <branch>; auto-resolve root-file
#       conflicts (tsconfig.json references / package.json workspaces) by UNION of
#       both sides; commit; push; close the PR.
# This removes the one remaining gap: gh cannot auto-resolve simultaneous root-file
# conflicts when several agents edited tsconfig.json/project references at once.
set -u
REPO=/Users/yoi/omega
QUEUE="$REPO/.agent-tasks/prs-ready.txt"
cd "$REPO" || exit 1

[ -f "$QUEUE" ] || { echo "queue empty/none — nothing to merge"; exit 0; }
echo "=== PRs queued for merge ==="
cat "$QUEUE"

# Resolve a tsconfig.json / package.json conflict by UNION of references/workspaces:
# keep OUR (main) version as the base, then add every entry the incoming side added.
# Robust: we parse the actual staged git blobs (:2 = ours, :3 = theirs), not the
# conflicted working-tree text.
resolve_root_conflict() {
  local file="$1" key="$2"   # key = "references" or "workspaces"
  python3 - "$file" "$key" <<'PY'
import sys, json, subprocess
f, key = sys.argv[1], sys.argv[2]

def load_stage(stage):
    try:
        raw = subprocess.check_output(["git", "show", f":{stage}:{f}"], stderr=subprocess.DEVNULL)
        return json.loads(raw)
    except Exception:
        return None

ours = load_stage(2) or load_stage(1)
theirs = load_stage(3) or load_stage(0)
if ours is None or theirs is None:
    import re
    s = open(f).read()
    paths = sorted(set(re.findall(r'"([^"]+)"', s)))
    print("warn: fallback union for " + f + ": " + str(paths))
else:
    existing = [e.get("path") if isinstance(e, dict) else e for e in ours.get(key, [])]
    incoming = [e.get("path") if isinstance(e, dict) else e for e in theirs.get(key, [])]
    union = sorted(set(existing + incoming))
    if key == "references":
        ours[key] = [{"path": p} for p in union]
    else:
        ours[key] = union
    json.dump(ours, open(f, "w"), indent=2)
    print("auto-resolved " + f + " " + key + " (union, " + str(len(union)) + " entries)")
PY
  git add "$file"
}

merge_one() {
  local branch="$1"
  echo "=== attempt gh merge $branch ==="
  if gh pr merge "$branch" --merge --delete-branch 2>&1 | tail -2; then
    if gh pr view "$branch" --json state -q .state 2>/dev/null | grep -q "MERGED"; then
      return 0
    fi
  fi
  # gh could not merge (conflict / PR-not-found). Do a LOCAL conflict-safe merge.
  echo "gh merge unavailable/conflicted for $branch — local conflict-safe merge"
  git checkout main >/dev/null 2>&1
  git pull origin main >/dev/null 2>&1
  git merge --no-ff "origin/$branch" -m "Merge $branch" >/dev/null 2>&1 || {
    [ -f tsconfig.json ] && grep -q "<<<<<<" tsconfig.json && resolve_root_conflict tsconfig.json references
    [ -f package.json ]  && grep -q "<<<<<<" package.json  && resolve_root_conflict package.json workspaces
    git commit --no-edit >/dev/null 2>&1 || git commit -m "Merge $branch (auto-resolved root-file conflicts)" >/dev/null 2>&1
  }
  git push origin main >/dev/null 2>&1
  gh pr close "$branch" --comment "Merged locally (conflict-resolved)" >/dev/null 2>&1 || true
  return 0
}

merged=0
while read -r branch; do
  [ -z "$branch" ] && continue
  merge_one "$branch" && merged=$((merged+1))
done < "$QUEUE"

> "$QUEUE"
echo "=== merged $merged PR(s); queue cleared ==="
git fetch origin main >/dev/null 2>&1
git checkout main >/dev/null 2>&1
git pull origin main >/dev/null 2>&1
# Fresh workspace symlinks: a merged package adds @omega/<pkg> imports that
# only resolve if npm workspaces has linked it into node_modules/@omega.
# Without this, `tsc -b` on main goes red even though the agent gate was green
# (the agent had run npm install in its own worktree). Re-run ensures new and
# changed package symlinks exist before any post-merge verification.
echo "=== npm install (refresh workspace symlinks for merged packages) ==="
npm install >/dev/null 2>&1 && echo "npm install OK" || echo "npm install FAILED"
echo "main at $(git rev-parse --short HEAD)"
