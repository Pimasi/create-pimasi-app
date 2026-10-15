#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host

older=$(commit "chore: scaffold")
base=$(commit "feat: released feature")
feature=$(COMMIT_FILE=feature.txt commit "feat(web): future feature")
original=$(COMMIT_FILE=fix.txt commit "fix(api): retain the session")
performance=$(COMMIT_FILE=performance.txt commit "perf: cache the tenant lookup")
tip=$(COMMIT_FILE=guide.txt commit "docs: explain the session")
publish_main
git push -q origin "$base:refs/tags/2026-10-12.1"
git fetch -q --tags origin
git worktree add --quiet -b release/2026-10-12.1 "$tmp/hotfix" "$base"
git -C "$tmp/hotfix" cherry-pick -x -s "$original" >/dev/null
first=$(git -C "$tmp/hotfix" rev-parse HEAD)
git push -q origin release/2026-10-12.1
git fetch -q origin

notes=$(sh "$release/notes.sh" "$base" "$first")
contains "hotfix notes name the released base" "## Hotfix of 2026-10-12.1" "$notes"
contains "hotfix notes group the picked fix" "### Fixes" "$notes"
contains "hotfix notes retain the subject" "- api: retain the session" "$notes"
contains "hotfix notes name the picked commit" "\`$(git rev-parse --short "$first")\`" "$notes"
contains "hotfix notes name the original main commit" "main \`$(git rev-parse --short "$original")\`" "$notes"
lacks "hotfix notes omit unpicked changes" "future feature" "$notes"
check "hotfix notes list each pick once" 1 "$(printf '%s\n' "$notes" | grep -c '^- ')"

git push -q origin "$first:refs/tags/2026-10-12.1.1"
git fetch -q --tags origin
check "live hotfix classifies from its main base" "range $base $tip" "$(sh "$release/classify.sh" "$first" "$tip")"
notes=$(sh "$release/notes.sh" "$first" "$tip")
contains "next main notes compare from the base release" "## Changes $(git rev-parse --short=8 "$base")..$(git rev-parse --short=8 "$tip") (4 commits)" "$notes"
contains "next main notes identify the hotfix" "### Hotfix 2026-10-12.1.1 was live" "$notes"
fresh=$(printf '%s\n' "$notes" | sed '/^### Hotfix /,$d')
contains "main notes retain the full main range" "retain the session" "$fresh"
contains "unpicked work is still new" "future feature" "$fresh"
already=$(printf '%s\n' "$notes" | sed -n '/^### Hotfix /,$p')
contains "already-live changes retain their subjects" "retain the session" "$already"
contains "a signed cherry-pick trailer is recognised" "(on main)" "$already"
check "the main range lists each main change once" 4 "$(printf '%s\n' "$fresh" | grep -c '^- ')"

status=0
sh "$release/classify.sh" "$first" "$feature" >"$tmp/refusal" 2>&1 || status=$?
check "a main candidate without the hotfix is accepted" 0 "$status"
notes=$(sh "$release/notes.sh" "$first" "$feature")
contains "an unpicked fix gets an informational reminder" 'confirm on main' "$notes"

notes=$(sh "$release/notes.sh" "$first" "$base")
contains "rollback to the release is explicit" "## Rollback to $(git rev-parse --short=8 "$base")" "$notes"
contains "rollback to the release removes its hotfix" "also removes hotfix 2026-10-12.1.1" "$notes"
contains "rollback lists the removed fix" "retain the session" "$notes"
notes=$(sh "$release/notes.sh" "$first" "$older")
contains "rollback to an older release removes the hotfix" "also removes hotfix 2026-10-12.1.1" "$notes"
contains "rollback to an older release lists earlier removals" "released feature" "$notes"

git -C "$tmp/hotfix" cherry-pick -x "$performance" >/dev/null
second=$(git -C "$tmp/hotfix" rev-parse HEAD)
git push -q origin release/2026-10-12.1
git fetch -q origin
status=0
sh "$release/classify.sh" "$second" "$feature" >"$tmp/refusal" 2>&1 || status=$?
check "a main candidate missing several picks is accepted" 0 "$status"
notes=$(sh "$release/notes.sh" "$second" "$feature")
check "each missing pick is marked for confirmation" 2 "$(printf '%s\n' "$notes" | grep -c 'confirm on main')"
notes=$(sh "$release/notes.sh" "$first" "$second")
contains "the next hotfix still names the base release" "## Hotfix of 2026-10-12.1" "$notes"
contains "the next hotfix groups new picks by type" "### Performance" "$notes"
contains "the next hotfix names its original main commit" "main \`$(git rev-parse --short "$performance")\`" "$notes"
lacks "the next hotfix omits previously deployed picks" "retain the session" "$notes"
jq -n --arg sha "$second" '[{id: 1, sha: $sha, status: "success", version: "2026-10-12.1.2"}]' >"$STATE/records-production.json"
recorded=$(sh "$release/notes.sh" "$second" "$tip")
contains "a record-held version labels already-live changes" "### Hotfix 2026-10-12.1.2 was live" "$recorded"
git push -q origin "$second:refs/tags/2026-10-12.1.2"
git fetch -q --tags origin
check "publishing the held tag does not change the notes" "$recorded" "$(sh "$release/notes.sh" "$second" "$tip")"

git -C "$tmp/hotfix" cherry-pick -x "$tip" >/dev/null
untagged=$(git -C "$tmp/hotfix" rev-parse HEAD)
git push -q origin release/2026-10-12.1
git fetch -q origin
notes=$(sh "$release/notes.sh" "$untagged" "$tip")
contains "an untagged live hotfix keeps its trusted main baseline" "## Changes $(git rev-parse --short=8 "$base")..$(git rev-parse --short=8 "$tip")" "$notes"
contains "an untagged hotfix is identified without assigning a version" "### Hotfix of 2026-10-12.1 ($(git rev-parse --short=8 "$untagged")) was live" "$notes"
check "main changes and all hotfix reminders remain listed" 7 "$(printf '%s\n' "$notes" | grep -c '^- ')"

done_testing
