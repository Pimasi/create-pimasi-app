#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
one=$(commit "feat: first merge")
two=$(commit "fix: second merge")
publish_main
fake_host
fake_tools
RELEASE_PIPELINE_ID=pipeline-1
RELEASE_GATED_PIPELINE_ID=pipeline-1
export RELEASE_PIPELINE_ID RELEASE_GATED_PIPELINE_ID

check "the shipped environment does not deploy on merge" '[]' "$(sh "$release/on-merge-environments.sh" | jq -c .)"
printf 'RELEASE_PUBLISH=false\nRELEASE_ON_MERGE=true\n' >"$release/environments/dev.env"
printf "RELEASE_PUBLISH=true\nRELEASE_ON_MERGE='true'\n" >"$release/environments/uat.env"
check "listing accepts literal opt-ins and preserves publication" '[{"environment":"dev","publish":false},{"environment":"uat","publish":true}]' "$(sh "$release/on-merge-environments.sh" | jq -c .)"
printf 'RELEASE_PUBLISH=false\n' >"$release/environments/qa.env"
printf 'RELEASE_PUBLISH=false\nRELEASE_ON_MERGE=false\n' >"$release/environments/test.env"
check "an absent key never inherits the previous opt-in" 'dev,uat' "$(sh "$release/on-merge-environments.sh" | jq -r 'map(.environment) | join(",")')"

: >"$STATE/calls"
check "a same-pipeline gated merge promotes" 0 "$(RELEASE_TRIGGER=merge RELEASE_PIPELINE_SHA=$two RELEASE_GATED_SHA=$two FAIL_GATE=1 promote dev "$two")"
lacks "the same merge never runs a second gate" 'make -C' "$(calls)"
check "the merge records dev" "$two" "$(cat "$STATE/marker-dev" 2>/dev/null || true)"
check "the merge leaves production untouched" no "$(if [ -f "$STATE/marker-production" ]; then printf yes; else printf no; fi)"
lacks "non-publishing dev never allocates a version" 'host tag-list' "$(calls)"

three=$(commit "feat: third merge")
sh "$RELEASE_HOST_ADAPTER" marker-write dev "$three" ''
: >"$STATE/calls"
check "an older waiting merge is skipped successfully" 0 "$(RELEASE_TRIGGER=merge RELEASE_PIPELINE_SHA=$two RELEASE_GATED_SHA=$two promote dev "$two")"
check "an older merge never replaces the newest record" "$three" "$(cat "$STATE/marker-dev")"
check "an older merge has an honest outcome" skipped "$(outcome outcome)"
lacks "an older merge never deploys" 'docker build' "$(calls)"
contains "the summary explains the skipped merge" 'newer commit is already live' "$(cat "$RELEASE_OUT/summary.md")"
check "manual rollback remains supported" 0 "$(promote dev "$one")"
check "manual rollback moves only its own record" "$one" "$(cat "$STATE/marker-dev")"

publish_main
: >"$STATE/calls"
check "a superseded main commit is skipped before the newer gate finishes" 0 "$(RELEASE_TRIGGER=merge RELEASE_PIPELINE_SHA=$two RELEASE_GATED_SHA=$two promote dev "$two")"
check "a superseded merge keeps the last healthy record" "$one" "$(cat "$STATE/marker-dev")"
check "a superseded merge reports a skip" skipped "$(outcome outcome)"
lacks "a superseded merge never builds" 'docker build' "$(calls)"
contains "the summary explains a superseded main commit" 'newer commit has reached main' "$(cat "$RELEASE_OUT/summary.md")"

for proof in missing other-commit other-pipeline-commit other-pipeline-id missing-pipeline-id; do
    gated=$three
    pipeline=$three
    pipelineId=pipeline-1
    case "$proof" in
        missing) gated= ;;
        other-commit) gated=$two ;;
        other-pipeline-commit) pipeline=$two ;;
        other-pipeline-id) pipelineId=pipeline-2 ;;
        missing-pipeline-id) pipelineId= ;;
    esac
    : >"$STATE/calls"
    check "$proof must pass a fresh gate" 1 "$(RELEASE_TRIGGER=merge RELEASE_PIPELINE_ID=$pipelineId RELEASE_PIPELINE_SHA=$pipeline RELEASE_GATED_SHA=$gated FAIL_GATE=1 promote dev "$three")"
    contains "$proof runs the gate at the candidate" "make -C $RELEASE_OUT/src -f $release/../../release.mk ci at $three" "$(calls)"
    lacks "$proof does not build after a failed gate" 'docker build' "$(calls)"
done

: >"$STATE/calls"
check "manual promotion cannot reuse a merge gate" 1 "$(RELEASE_PIPELINE_SHA=$three RELEASE_GATED_SHA=$three FAIL_GATE=1 promote dev "$three")"
contains "manual promotion runs its own gate" 'make -C' "$(calls)"

check "the next merge can attempt deployment" 1 "$(RELEASE_TRIGGER=merge RELEASE_PIPELINE_SHA=$three RELEASE_GATED_SHA=$three FAIL_DEPLOY=1 promote dev "$three")"
check "failed merge deployment leaves its record unchanged" "$one" "$(cat "$STATE/marker-dev")"
four=$(commit "fix: next attempt")
publish_main
check "the following merge succeeds after a failed deployment" 0 "$(RELEASE_TRIGGER=merge RELEASE_PIPELINE_SHA=$four RELEASE_GATED_SHA=$four promote dev "$four")"
check "a successful merge advances the record" "$four" "$(cat "$STATE/marker-dev")"

: >"$STATE/calls"
check "changed publication settings reject an outdated lock plan" 3 "$(RELEASE_EXPECT_PUBLISH=true promote dev "$three")"
lacks "an outdated lock plan performs no build" 'docker build' "$(calls)"
printf 'RELEASE_PUBLISH=false\n' >"$release/environments/dev.env"
check "removing the opt-in prevents an already queued merge promotion" 3 "$(RELEASE_TRIGGER=merge RELEASE_PIPELINE_SHA=$four RELEASE_GATED_SHA=$four promote dev "$four")"

printf 'RELEASE_PUBLISH=false\nRELEASE_ON_MERGE=true\nRELEASE_AFTER=uat\n' >"$release/environments/dev.env"
check "merge promotion still enforces its prerequisite" 3 "$(RELEASE_TRIGGER=merge RELEASE_PIPELINE_SHA=$four RELEASE_GATED_SHA=$four promote dev "$four")"

printf 'RELEASE_PUBLISH=false\nRELEASE_ON_MERGE=true\n' >"$release/environments/dev.env"
git clone -q "$tmp/remote.git" "$tmp/other"
git -C "$tmp/other" config user.name "Release Test"
git -C "$tmp/other" config user.email "release-test@example.invalid"
git -C "$tmp/other" config commit.gpgsign false
printf 'a remote-only merge\n' >>"$tmp/other/history.txt"
git -C "$tmp/other" add history.txt
git -C "$tmp/other" commit -q -m "fix: a remote-only merge"
git -C "$tmp/other" push -q origin main
remoteTip=$(git -C "$tmp/other" rev-parse HEAD)
check "a remote-only merge leaves local origin/main stale" "$four" "$(git rev-parse origin/main)"
: >"$STATE/calls"
check "a merge superseded only on the remote is skipped successfully" 0 "$(RELEASE_TRIGGER=merge RELEASE_PIPELINE_SHA=$four RELEASE_GATED_SHA=$four promote dev "$four")"
check "promotion refreshes origin/main from the remote" "$remoteTip" "$(git rev-parse origin/main)"
check "a remote-only newer merge reports a skip" skipped "$(outcome outcome)"
check "a remote-only newer merge keeps the healthy record" "$four" "$(cat "$STATE/marker-dev")"
lacks "a remote-only newer merge prevents a build" 'docker build' "$(calls)"
lacks "a remote-only newer merge prevents a new deployment record" 'host marker-write' "$(calls)"
done_testing
