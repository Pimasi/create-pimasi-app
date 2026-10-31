#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host

older=$(commit "chore: scaffold")
base=$(COMMIT_FILE=base.txt commit "feat: released service")
first=$(COMMIT_FILE=first.txt commit "fix: first correction")
second=$(COMMIT_FILE=second.txt commit "fix: second correction")
publish_main
git push -q origin "$base:refs/tags/2026-10-12.1"
git worktree add --quiet -b release/2026-10-12.1 "$tmp/hotfix" "$base"
git -C "$tmp/hotfix" cherry-pick -x -s "$first" >/dev/null
hotfix=$(git -C "$tmp/hotfix" rev-parse HEAD)
git -C "$tmp/hotfix" cherry-pick -x "$second" >/dev/null
next=$(git -C "$tmp/hotfix" rev-parse HEAD)
git push -q origin release/2026-10-12.1
git fetch -q origin
printf '%s\n' "$base" >"$STATE/marker-production"

admit() {
    status=0
    sh "$release/admit.sh" "$1" "$2" 2>"$tmp/error" || status=$?
    printf '%s' "$status"
}

check "a signed cherry-pick on a release branch is admitted" 0 "$(admit production "$hotfix")"
check "a candidate reachable below the remote branch tip is admitted" 0 "$(admit production "$hotfix")"
check "a descendant hotfix is admitted" 0 "$(admit production "$next")"
no_trailer=$(printf 'fix: new correction\n' | git commit-tree "$base^{tree}" -p "$next")
git push -q origin "$no_trailer:refs/heads/release/2026-10-12.1"
git fetch -q origin
check "a brand-new commit on the release branch is admitted" 0 "$(admit production "$no_trailer")"
git push -q origin :refs/heads/release/2026-10-12.1
git update-ref refs/remotes/origin/release/2026-10-12.1 "$no_trailer"
check "a stale tracking branch cannot admit an untagged hotfix" 3 "$(admit production "$no_trailer")"
git push -q origin "$no_trailer:refs/heads/release/2026-10-12.1"
merged=$(printf 'fix: merged repair\n' | git commit-tree "$second^{tree}" -p "$no_trailer" -p "$first")
git push -q origin "$merged:refs/heads/release/2026-10-12.1"
git fetch -q origin
check "hotfix content may include a merge" 0 "$(admit production "$merged")"
unreleased=$(printf 'fix: release descendant\n' | git commit-tree "$second^{tree}" -p "$first")
git push -q -f origin "$unreleased:refs/heads/release/2026-10-12.1"
git fetch -q origin
check "a release line through an untagged main commit is admitted" 0 "$(admit production "$unreleased")"
check "the release branch names the hotfix base" "$base" "$(sh "$release/hotfix.sh" "$unreleased" | jq -r '.base_sha')"
git push -q origin "$first:refs/tags/2026-10-12.2"
check "a newer release on the line does not change the branch's base" "$base" "$(sh "$release/hotfix.sh" "$unreleased" | jq -r '.base_sha')"
git push -q origin "$unreleased:refs/heads/release/2026-10-12.2"
check "the nearest release branch holding the commit names its base" "$first" "$(sh "$release/hotfix.sh" "$unreleased" | jq -r '.base_sha')"
git push -q origin :refs/heads/release/2026-10-12.2
git push -q -f origin "$merged:refs/heads/release/2026-10-12.1"

early=$(printf 'fix: no released ancestor\n' | git commit-tree "$older^{tree}" -p "$older")
git push -q origin "$early:refs/heads/release/2026-02-30.1" "$older:refs/tags/2026-02-30.1"
git fetch -q origin
check "an invalid calendar date cannot establish a release base" 3 "$(admit production "$early")"
contains "an invalid date still requires a released tag" 'released tag' "$(cat "$tmp/error")"
printf '%s\n' "$second" >"$STATE/marker-production"
check "a release which is no longer live can be hotfixed" 0 "$(admit production "$next")"
: >"$STATE/marker-production"
check "an environment without a live record can accept a hotfix" 0 "$(admit production "$next")"

printf 'RELEASE_PUBLISH=false\n' >"$release/environments/uat.env"
printf 'RELEASE_PUBLISH=true\nRELEASE_AFTER=uat\n' >"$release/environments/production.env"
printf '%s\n' "$base" >"$STATE/marker-production"
printf '%s\n' "$base" >"$STATE/marker-uat"
check "production waits until uat has accepted the hotfix" 3 "$(admit production "$hotfix")"
contains "the prerequisite refusal names uat" uat "$(cat "$tmp/error")"
check "uat accepts the valid hotfix first" 0 "$(admit uat "$hotfix")"
printf '%s\n' "$next" >"$STATE/marker-uat"
check "production accepts an ancestor of uat's hotfix" 0 "$(admit production "$hotfix")"
printf 'RELEASE_PUBLISH=false\n' >"$release/environments/dev.env"
printf '%s\n' "$second" >"$STATE/marker-dev"
check "an independent environment can accept any admitted hotfix" 0 "$(admit dev "$hotfix")"
done_testing
