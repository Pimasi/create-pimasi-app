#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools

one=$(commit "feat: first release")
two=$(COMMIT_FILE=two.txt commit "feat: second release")
three=$(COMMIT_FILE=three.txt commit "fix: third release")
publish_main
printf 'RELEASE_PUBLISH=false\n' >"$release/environments/dev.env"

environment() {
    git ls-remote --heads origin "refs/heads/env/$1" | cut -f1
}

line() {
    calls | grep -n -- "$1" | head -n 1 | cut -d: -f1
}

: >"$STATE/calls"
check "a deploy succeeds" 0 "$(promote production "$two")"
check "env/production names the deployed commit" "$two" "$(environment production)"
check "the environment branch moves after the record" true "$([ "$(line 'host marker-write production')" -lt "$(line 'host branch-move env/production')" ] && printf true || printf false)"
check "the environment branch moves before publication" true "$([ "$(line 'host branch-move env/production')" -lt "$(line 'host release-publish')" ] && printf true || printf false)"
check "a deploy of another environment succeeds" 0 "$(promote dev "$three")"
check "env/dev names its own healthy commit" "$three" "$(environment dev)"
check "another environment leaves env/production alone" "$two" "$(environment production)"

check "a redeploy succeeds" 0 "$(promote production "$two")"
check "a redeploy keeps env/production at the commit" "$two" "$(environment production)"
check "a range deploy succeeds" 0 "$(promote production "$three")"
check "a range deploy moves env/production forwards" "$three" "$(environment production)"
check "a rollback succeeds" 0 "$(promote production "$one")"
check "a rollback moves env/production backwards" "$one" "$(environment production)"

check "an unhealthy deploy fails" 1 "$(STALE_DEPLOY=1 promote production "$two")"
check "an unhealthy deploy leaves env/production" "$one" "$(environment production)"
check "a failed gate fails" 1 "$(FAIL_GATE=1 promote production "$two")"
check "a failed gate leaves env/production" "$one" "$(environment production)"
check "a failed record write fails" 1 "$(FAIL_RECORD=1 promote production "$two")"
check "a failed record write leaves env/production" "$one" "$(environment production)"

check "a refused environment branch write keeps the deploy" 0 "$(FAIL_BRANCH_MOVE=1 promote production "$two")"
check "a refused environment branch write keeps the outcome succeeded" succeeded "$(outcome outcome)"
check "a refused environment branch write keeps the live record" "$two" "$(cat "$STATE/marker-production")"
check "a refused environment branch write leaves the branch" "$one" "$(environment production)"
contains "a refused environment branch write is a warning" 'warning: env/production was not moved to' "$(cat "$tmp/promote.log")"
check "the next healthy deploy moves the branch" 0 "$(promote production "$two")"
check "env/production catches up with the live record" "$two" "$(environment production)"

hotfix=$(printf 'fix: repair the first release\n' | git commit-tree "$two^{tree}" -p "$two")
git push -q origin "$hotfix:refs/heads/release/2026-10-12.1"
check "a newer release deploys" 0 "$(promote production "$three")"
check "a hotfix of the older release deploys" 0 "$(promote production "$hotfix")"
check "the hotfix receives its patch version" 2026-10-12.1.1 "$(outcome version)"
check "a hotfix line moves env/production sideways" "$hotfix" "$(environment production)"
done_testing
