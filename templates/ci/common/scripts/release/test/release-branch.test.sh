#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools

base=$(commit "feat: released service")
second=$(COMMIT_FILE=second.txt commit "feat: second release")
third=$(COMMIT_FILE=third.txt commit "fix: third release")
publish_main

branch() {
    git ls-remote --heads origin "refs/heads/$1" | cut -f1
}

line() {
    calls | grep -n -- "$1" | head -n 1 | cut -d: -f1
}

: >"$STATE/calls"
check "the first tagging deploy succeeds" 0 "$(promote production "$base")"
check "the first tagging deploy completes publication" succeeded "$(outcome outcome)"
check "the first tagging deploy assigns the version" 2026-10-12.1 "$(outcome version)"
check "the version tag names the deployed commit" "$base" "$(git ls-remote --tags origin refs/tags/2026-10-12.1 | cut -f1)"
check "the release branch names the same commit" "$base" "$(branch release/2026-10-12.1)"
check "the branch is created after the release is published" true "$([ "$(line 'host release-publish')" -lt "$(line 'host branch-create release/2026-10-12.1')" ] && printf true || printf false)"
check "the tag is confirmed after publication and before the branch" true "$([ "$(line 'host release-publish')" -lt "$(calls | grep -n 'host tag-read 2026-10-12.1' | tail -n 1 | cut -d: -f1)" ] && [ "$(calls | grep -n 'host tag-read 2026-10-12.1' | tail -n 1 | cut -d: -f1)" -lt "$(line 'host branch-create')" ] && printf true || printf false)"

: >"$STATE/calls"
check "a later deploy of the version succeeds" 0 "$(promote production "$base")"
check "a later deploy keeps publication complete" succeeded "$(outcome outcome)"
lacks "a later deploy creates no tag" 'host release-publish' "$(calls)"
lacks "a later deploy creates no branch" 'host created release/2026-10-12.1' "$(calls)"
check "a later deploy leaves the branch at the commit" "$base" "$(branch release/2026-10-12.1)"

git push -q origin :refs/heads/release/2026-10-12.1
: >"$STATE/calls"
check "a deploy of the version after branch deletion succeeds" 0 "$(promote production "$base")"
contains "the missing branch is recreated" 'host created release/2026-10-12.1' "$(calls)"
check "the recreated branch names the tagged commit" "$base" "$(branch release/2026-10-12.1)"
check "recreation leaves publication complete" succeeded "$(outcome outcome)"
lacks "recreation creates no tag" 'host release-publish' "$(calls)"

unrelated=$(printf 'chore: unrelated history\n' | git commit-tree "$base^{tree}")
offLine=$(printf 'chore: merge the release from the side\n' | git commit-tree "$base^{tree}" -p "$unrelated" -p "$base")
git push -q -f origin "$offLine:refs/heads/release/2026-10-12.1"
: >"$STATE/calls"
check "an existing branch elsewhere does not fail the deploy" 0 "$(promote production "$base")"
check "an existing branch elsewhere keeps the outcome" succeeded "$(outcome outcome)"
check "an existing branch elsewhere is left alone" "$offLine" "$(branch release/2026-10-12.1)"
contains "an existing branch elsewhere is a warning" 'warning: release/2026-10-12.1 does not hold 2026-10-12.1 on its first-parent line and is left unchanged' "$(cat "$tmp/promote.log")"
git push -q -f origin "$base:refs/heads/release/2026-10-12.1"

git clone -q "file://$tmp/remote.git" "$tmp/elsewhere"
advanced=$(printf 'fix: hotfix pushed from another clone\n' | git -C "$tmp/elsewhere" -c user.name='Release Test' -c user.email=release-test@example.invalid commit-tree "$base^{tree}" -p "$base")
git -C "$tmp/elsewhere" push -q origin "$advanced:refs/heads/release/2026-10-12.1"
check "the advancing hotfix is not yet in the runner's clone" no "$(if git cat-file -e "$advanced^{commit}" 2>/dev/null; then printf yes; else printf no; fi)"
check "a branch advanced by a hotfix does not fail the deploy" 0 "$(promote production "$base")"
check "a branch advanced by a hotfix keeps the outcome" succeeded "$(outcome outcome)"
check "a branch advanced by a hotfix is left alone" "$advanced" "$(branch release/2026-10-12.1)"
lacks "a branch advanced by a hotfix is not a warning" 'warning: release/2026-10-12.1' "$(cat "$tmp/promote.log")"
git push -q -f origin "$base:refs/heads/release/2026-10-12.1"

check "a refused branch write keeps the deployment" 0 "$(FAIL_BRANCH_CREATE=1 promote production "$second")"
check "a refused branch write ends with publication incomplete" 'succeeded, publication incomplete' "$(outcome outcome)"
check "a refused branch write keeps the version" 2026-10-12.2 "$(outcome version)"
check "a refused branch write keeps the live record" "$second" "$(cat "$STATE/marker-production")"
check "a refused branch write keeps the tag" "$second" "$(git ls-remote --tags origin refs/tags/2026-10-12.2 | cut -f1)"
check "a refused branch write creates no branch" '' "$(branch release/2026-10-12.2)"
contains "a refused branch write asks for another promotion" 'Promote this SHA again to retry publication.' "$(cat "$RELEASE_OUT/summary.md")"
check "the next deploy of the version creates the branch" 0 "$(promote production "$second")"
check "the next deploy completes publication" succeeded "$(outcome outcome)"
check "the branch names the tagged commit after the retry" "$second" "$(branch release/2026-10-12.2)"

check "a refused tag leaves the deployment" 0 "$(FAIL_TAG=1 promote production "$third")"
check "a refused tag creates no release branch" '' "$(branch release/2026-10-12.3)"
check "a refused release object leaves the deployment" 0 "$(FAIL_PUBLISH=1 promote production "$third")"
check "a tag without a release object creates no release branch" '' "$(branch release/2026-10-12.3)"
check "a published retry creates the branch" 0 "$(promote production "$third")"
check "the published retry names the tagged commit" "$third" "$(branch release/2026-10-12.3)"

fourth=$(COMMIT_FILE=fourth.txt commit "feat: fourth release")
publish_main
printf 'A release object whose tag is missing\n' >"$STATE/release-2026-10-12.4.md"
check "a release object without its tag keeps the deployment" 0 "$(promote production "$fourth")"
check "a release object without its tag leaves publication incomplete" 'succeeded, publication incomplete' "$(outcome outcome)"
check "a release object without its tag creates no release branch" '' "$(branch release/2026-10-12.4)"

hotfix=$(printf 'fix: repair the first release\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q origin "$hotfix:refs/heads/release/2026-10-12.1"
check "a hotfix deploy succeeds" 0 "$(promote production "$hotfix")"
check "the hotfix receives a patch version" 2026-10-12.1.1 "$(outcome version)"
check "a hotfix version gets no release branch" '' "$(branch release/2026-10-12.1.1)"
check "a hotfix deploy leaves its release branch" "$hotfix" "$(branch release/2026-10-12.1)"

printf 'RELEASE_PUBLISH=false\n' >"$release/environments/dev.env"
: >"$STATE/calls"
check "a non-publishing deploy succeeds" 0 "$(promote dev "$third")"
lacks "a non-publishing deploy creates no release branch" 'host branch-create' "$(calls)"
done_testing
