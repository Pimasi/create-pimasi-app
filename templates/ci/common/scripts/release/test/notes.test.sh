#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox

base=$(commit "chore: scaffold")
commit "feat(api): paginate the list (#21)" >/dev/null
commit "fix(db): retry on connection reset" "Retries three times.

See merge request group/project!34" >/dev/null
commit "feat(web)!: replace the session cookie" "BREAKING CHANGE: clients must send a bearer token." >/dev/null
commit "Update dependencies" >/dev/null
commit "perf: cache the tenant lookup" >/dev/null
reverted=$(commit "feat: add CSV export")
commit "Revert \"feat: add CSV export\"" "This reverts commit $reverted." >/dev/null
mid=$(git rev-parse HEAD)
head=$(commit "docs: say \"hello\" \\ back")

notes=$(sh "$release/notes.sh" "$base" "$head")
contains "range heading" "## Changes $(git rev-parse --short=8 "$base")..$(git rev-parse --short=8 "$head") (8 commits)" "$notes"
contains "feature with scope" "- api: paginate the list (#21) \`" "$notes"
contains "merge request number" "- db: retry on connection reset (!34) \`" "$notes"
contains "breaking change" "- **BREAKING** web: replace the session cookie \`" "$notes"
contains "unconventional subject is kept" "- Update dependencies \`" "$notes"
contains "revert" "- Revert \"feat: add CSV export\" \`" "$notes"
contains "performance" "- cache the tenant lookup \`" "$notes"

order=$(printf '%s\n' "$notes" | sed -n 's/^### //p' | tr '\n' ' ')
check "group order" "Features Fixes Performance Reverts Maintenance " "$order"

for commit in $(git rev-list --first-parent "$base..$head"); do
    hits=$(printf '%s\n' "$notes" | grep -c "\`$(git rev-parse --short "$commit")\`$")
    check "commit $commit is listed once" "1" "$hits"
done
lacks "the base commit is not listed" "\`$(git rev-parse --short "$base")\`" "$notes"
check "bullet count equals the range" "8" "$(printf '%s\n' "$notes" | grep -c '^- ')"

notes=$(sh "$release/notes.sh" "$head" "$head")
contains "redeploy wording" "## Redeploy of $(git rev-parse --short=8 "$head")" "$notes"
contains "redeploy states no changes" "No code changes." "$notes"
check "redeploy lists no commits" "0" "$(printf '%s\n' "$notes" | grep -c '^- ')"

notes=$(sh "$release/notes.sh" "$head" "$mid")
contains "rollback wording" "## Rollback to $(git rev-parse --short=8 "$mid") from $(git rev-parse --short=8 "$head") (1 commits removed)" "$notes"
contains "rollback lists what is removed" "say \"hello\" \\ back" "$notes"

notes=$(sh "$release/notes.sh" "" "$head")
contains "missing baseline wording" "No trusted previous release to compare against." "$notes"
check "missing baseline lists no commits" "0" "$(printf '%s\n' "$notes" | grep -c '^- ')"

commit "revert(api)!: undo export" >/dev/null
commit "Revert the invalid update" >/dev/null
body_breaking=$(commit "Update environment" "BREAKING-CHANGE: replace the previous setting.")
notes=$(sh "$release/notes.sh" "$head" "$body_breaking")
contains "a typed revert keeps scope and breaking marker" "- **BREAKING** api: undo export" "$notes"
contains "any subject beginning Revert belongs to Reverts" "### Reverts
- **BREAKING** api: undo export" "$notes"
contains "a plain subject keeps the body's breaking marker" "- **BREAKING** Update environment" "$notes"
check "every unusual change is retained" "3" "$(printf '%s\n' "$notes" | grep -c '^- ')"

git worktree add --quiet -b merged-side "$tmp/merged-side" "$body_breaking"
cd "$tmp/merged-side"
side=$(COMMIT_FILE=side.txt commit "feat: side work must not appear twice")
cd "$tmp/repo"
git merge -q --no-ff -m "feat: merge side work" merged-side
merged=$(git rev-parse HEAD)
notes=$(sh "$release/notes.sh" "$body_breaking" "$merged")
check "a merge contributes one first-parent change" "1" "$(printf '%s\n' "$notes" | grep -c '^- ')"
contains "the merge subject is listed" "merge side work" "$notes"
lacks "the second-parent commit is not duplicated" "\`$(git rev-parse --short "$side")\`" "$notes"

mergeBase=$(git rev-parse HEAD)
commit "Merge branch 'feature' into 'main'" 'feat(api): export reports

More detail.

See merge request group/project!45' >/dev/null
commit 'Merge pull request #67 from owner/fix' 'fix(web): retain the session

More detail.' >/dev/null
commit "Merge branch 'unknown' into 'main'" 'See merge request group/project!46' >/dev/null
mergeHead=$(git rev-parse HEAD)
mergeNotes=$(sh "$release/notes.sh" "$mergeBase" "$mergeHead")
contains "GitLab merge body supplies the title" '- api: export reports (!45)' "$mergeNotes"
contains "GitHub merge body supplies the title and reference" '- web: retain the session (#67)' "$mergeNotes"
contains "missing merge title retains the subject" "- Merge branch 'unknown' into 'main' (!46)" "$mergeNotes"
check "every first-parent merge is listed once" 3 "$(printf '%s\n' "$mergeNotes" | grep -c '^- ')"

done_testing
