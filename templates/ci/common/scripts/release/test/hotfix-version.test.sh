#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host

base=$(commit "chore: scaffold")
first=$(COMMIT_FILE=first.txt commit "fix: first correction")
second=$(COMMIT_FILE=second.txt commit "fix: second correction")
third=$(COMMIT_FILE=third.txt commit "fix: third correction")
publish_main
git push -q origin "$base:refs/tags/2026-10-12.1"
git worktree add --quiet -b release/2026-10-12.1 "$tmp/hotfix" "$base"
git -C "$tmp/hotfix" cherry-pick -x "$first" >/dev/null
hotfix=$(git -C "$tmp/hotfix" rev-parse HEAD)
git push -q origin release/2026-10-12.1
git fetch -q origin
check "the first hotfix uses its base release and .1" 2026-10-12.1.1 "$(sh "$release/version.sh" "$hotfix")"
check "the hotfix retains its release date on another day" 2026-10-12.1.1 "$(RELEASE_NOW=1791892800 sh "$release/version.sh" "$hotfix")"
git push -q origin "$hotfix:refs/tags/2026-10-12.1.1"
git -C "$tmp/hotfix" cherry-pick -x "$second" >/dev/null
next=$(git -C "$tmp/hotfix" rev-parse HEAD)
git push -q origin release/2026-10-12.1
git fetch -q origin
check "the next hotfix takes the next patch counter" 2026-10-12.1.2 "$(sh "$release/version.sh" "$next")"
sh "$RELEASE_HOST_ADAPTER" marker-write production "$next" 2026-10-12.1.2
check "an unpublished hotfix retains its record-held version" 2026-10-12.1.2 "$(RELEASE_NOW=1791892800 sh "$release/version.sh" "$next")"
git -C "$tmp/hotfix" cherry-pick -x "$third" >/dev/null
last=$(git -C "$tmp/hotfix" rev-parse HEAD)
git push -q origin release/2026-10-12.1
git fetch -q origin
check "a record-held hotfix consumes its patch counter" 2026-10-12.1.3 "$(sh "$release/version.sh" "$last")"
git push -q origin "$next:refs/tags/2026-10-12.1.9" "$next:refs/tags/2026-10-12.1.10"
check "patch counters sort numerically" 2026-10-12.1.11 "$(sh "$release/version.sh" "$last")"
check "a published hotfix keeps its original version" 2026-10-12.1.1 "$(sh "$release/version.sh" "$hotfix")"
done_testing
