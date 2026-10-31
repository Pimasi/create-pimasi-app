#!/bin/sh
if [ "$#" -eq 0 ]; then
    status=0
    sh "$0" empty || status=$?
    sh "$0" real || status=$?
    exit "$status"
fi
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools

base=$(commit "feat: released service")
COMMIT_FILE=main.txt commit "feat: other main work" >/dev/null
first=$(printf 'feat: first feature change\n' | git commit-tree "$base^{tree}" -p "$base")
second=$(printf 'feat: second feature change\n' | git commit-tree "$base^{tree}" -p "$first")
git merge -q --no-ff -m 'feat: merge feature changes' "$second"
merged=$(git rev-parse HEAD)
publish_main
check "the first release succeeds" 0 "$(promote production "$base")"
check "the feature merge is released" 0 "$(promote production "$merged")"
check "the merge receives the second daily version" 2026-10-12.2 "$(outcome version)"

refuseFeature() {
    : >"$STATE/calls"
    check "$1 refuses the merged feature commit" 3 "$(promote production "$first")"
    check "$1 rejects at admission" admit "$(outcome stage)"
    check "$1 leaves the live record unchanged" "$2" "$(cat "$STATE/marker-production")"
    lacks "$1 builds nothing" 'docker build' "$(calls)"
    check "$1 creates no feature tag" '' "$(sh "$RELEASE_HOST_ADAPTER" tag-list | jq -r --arg sha "$first" '.[] | select(.sha == $sha) | .tag')"
    contains "$1 explains the commit is already merged" 'already part of main through a merge' "$(cat "$tmp/promote.log")"
    contains "$1 directs promotion to the containing main commit" 'promote the main commit that contains it' "$(cat "$tmp/promote.log")"
}

refuseFeature 'the release branches the pipeline created' "$merged"
if [ "$1" = empty ]; then
    git push -q -f origin "$merged:refs/heads/release/2026-10-12.1"
    refuseFeature 'an older release branch holding the merge' "$merged"
else
    hotfix=$(printf 'fix: repair the second release\n' | git commit-tree "$merged^{tree}" -p "$merged")
    git push -q origin "$hotfix:refs/heads/release/2026-10-12.2"
    refuseFeature 'a release branch with its own commit' "$merged"
    check "the branch's own hotfix is admitted" 0 "$(promote production "$hotfix")"
    check "the branch's own hotfix uses its release base" 2026-10-12.2.1 "$(outcome version)"
    check "the branch's own hotfix receives its tag" "$hotfix" "$(sh "$RELEASE_HOST_ADAPTER" tag-read 2026-10-12.2.1)"
    refuseFeature 'the released hotfix line' "$hotfix"
fi
done_testing
