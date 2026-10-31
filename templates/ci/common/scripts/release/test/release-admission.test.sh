#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host

base=$(commit "feat: released service")
git worktree add --quiet -b feature "$tmp/feature" "$base"
side=$(cd "$tmp/feature" && COMMIT_FILE=side.txt commit "feat: side work merged after the release")
git merge -q --no-ff -m 'feat: merge side work' feature
merged=$(git rev-parse HEAD)
publish_main
git push -q origin "$base:refs/tags/2026-10-12.1"

admit() {
    status=0
    sh "$release/admit.sh" production "$1" 2>"$tmp/error" || status=$?
    printf '%s' "$status"
}

check "a merged side commit without a branch is refused" 3 "$(admit "$side")"
git push -q origin "$merged:refs/heads/hotfix/from-main"
check "a hotfix/ branch cut from main's tip no longer admits a merged side commit" 3 "$(admit "$side")"
contains "the refusal directs promotion of the main commit" 'promote the main commit that contains it' "$(cat "$tmp/error")"
git push -q origin "$merged:refs/heads/release/2026-10-12.1"
check "a release branch holding main's tip does not admit a merged side commit" 3 "$(admit "$side")"
contains "the release-branch refusal directs promotion of the main commit" 'promote the main commit that contains it' "$(cat "$tmp/error")"
check "main's tip on the release branch stays a normal release" normal "$(sh "$release/admit.sh" production "$merged" --kind)"

repair=$(printf 'fix: repair\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q -f origin "$repair:refs/heads/release/2026-10-12.1"
check "a commit on the release line above its tag is a hotfix" "hotfix $base 2026-10-12.1" "$(sh "$release/admit.sh" production "$repair" --kind)"
check "the release branch names the hotfix base" "$base" "$(sh "$release/hotfix.sh" "$repair" | jq -r '.base_sha')"
check "the release branch names the hotfix base tag" 2026-10-12.1 "$(sh "$release/hotfix.sh" "$repair" | jq -r '.base_tag')"
git push -q -f origin "$base:refs/heads/release/2026-10-12.1"
check "a commit no longer on the release line is refused" 3 "$(admit "$repair")"
contains "the refusal names the configured prefix" 'release/<version>' "$(cat "$tmp/error")"
git push -q origin "$repair:refs/heads/hotfix/repair"
check "a hotfix/ branch admits nothing" 3 "$(admit "$repair")"

git push -q -f origin "$repair:refs/heads/release/2026-10-12.1"
later=$(printf 'fix: later repair\n' | git commit-tree "$base^{tree}" -p "$repair")
git push -q origin "$later:refs/tags/2026-10-12.2" "$later:refs/heads/release/2026-10-12.2"
deeper=$(printf 'fix: deeper repair\n' | git commit-tree "$base^{tree}" -p "$later")
git push -q -f origin "$deeper:refs/heads/release/2026-10-12.1" "$deeper:refs/heads/release/2026-10-12.2"
check "a nearer release tag off main cannot name a base" 2026-10-12.1 "$(sh "$release/hotfix.sh" "$deeper" | jq -r '.base_tag')"
git push -q origin :refs/tags/2026-10-12.2 :refs/heads/release/2026-10-12.2
git push -q origin "$side:refs/tags/2026-10-12.3" "$side:refs/heads/release/2026-10-12.3"
check "the tagged commit of a release branch is not above its own version" 3 "$(admit "$side")"
git push -q origin :refs/tags/2026-10-12.3 :refs/heads/release/2026-10-12.3

second=$(COMMIT_FILE=second.txt commit "feat: second release")
publish_main
git push -q origin "$second:refs/tags/2026-10-12.2"
stacked=$(printf 'fix: stacked repair\n' | git commit-tree "$second^{tree}" -p "$second")
git push -q origin "$stacked:refs/heads/release/2026-10-12.2"
check "each release branch names its own base" "$second" "$(sh "$release/hotfix.sh" "$stacked" | jq -r '.base_sha')"
git push -q -f origin "$stacked:refs/heads/release/2026-10-12.1"
check "a commit on two release lines takes the nearest base" 2026-10-12.2 "$(sh "$release/hotfix.sh" "$stacked" | jq -r '.base_tag')"
git push -q origin :refs/heads/release/2026-10-12.2
check "a release line holding a later release keeps its own base" 2026-10-12.1 "$(sh "$release/hotfix.sh" "$stacked" | jq -r '.base_tag')"

tagged=$(printf 'fix: tagged repair\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q origin "$tagged:refs/tags/2026-10-12.1.4"
check "a commit carrying a hotfix tag stays admissible without a branch" "hotfix $base 2026-10-12.1" "$(sh "$release/admit.sh" production "$tagged" --kind)"
check "the hotfix tag names its base" 2026-10-12.1 "$(sh "$release/hotfix.sh" "$tagged" | jq -r '.base_tag')"
check "the carried tag is its version" 2026-10-12.1.4 "$(sh "$release/hotfix.sh" "$tagged" | jq -r '.version')"

offMain=$(printf 'feat: released off main\n' | git commit-tree "$base^{tree}" -p "$base")
carriedOff=$(printf 'fix: repair of a release off main\n' | git commit-tree "$base^{tree}" -p "$offMain")
git push -q origin "$offMain:refs/tags/2026-10-12.3" "$carriedOff:refs/tags/2026-10-12.3.1"
check "a hotfix tag whose base is off main admits nothing" 3 "$(admit "$carriedOff")"
unrelated=$(printf 'fix: repair outside the release history\n' | git commit-tree "$base^{tree}")
git push -q origin "$unrelated:refs/tags/2026-10-12.1.5"
check "a hotfix tag whose base is not an ancestor admits nothing" 3 "$(admit "$unrelated")"
git merge -q --no-ff -m 'fix: bring the tagged repair back' "$tagged"
publish_main
aboveTagged=$(printf 'fix: repair above a hotfix tag\n' | git commit-tree "$base^{tree}" -p "$tagged")
git push -q origin "$aboveTagged:refs/heads/release/2026-10-12.1.4"
check "a release branch named after a hotfix version admits nothing" 3 "$(admit "$aboveTagged")"
stray=$(printf 'fix: repair without a release line\n' | git commit-tree "$base^{tree}" -p "$base")
status=0
RELEASE_HOTFIX_SHA=$stray RELEASE_HOTFIX_BASE=$base RELEASE_HOTFIX_TAG=2026-10-12.1 sh "$release/admit.sh" production "$stray" 2>"$tmp/error" || status=$?
check "admission ignores a hotfix base carried in the environment" 3 "$status"
done_testing
