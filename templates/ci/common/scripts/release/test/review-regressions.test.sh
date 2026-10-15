#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools
one=$(commit 'feat: first release')
two=$(commit 'fix: candidate')
publish_main
printf 'RELEASE_PUBLISH=false\nRELEASE_ON_MERGE=true\n' >"$release/environments/dev.env"
check 'missing pipeline identities cannot reuse a gate' 1 "$(RELEASE_TRIGGER=merge RELEASE_PIPELINE_SHA=$two RELEASE_GATED_SHA=$two RELEASE_PIPELINE_ID= RELEASE_GATED_PIPELINE_ID= FAIL_GATE=1 promote dev "$two")"
contains 'missing identities run a gate' 'make -C' "$(calls)"
check 'a merge initially succeeds' 0 "$(RELEASE_TRIGGER=merge RELEASE_PIPELINE_SHA=$two RELEASE_GATED_SHA=$two RELEASE_PIPELINE_ID=1 RELEASE_GATED_PIPELINE_ID=1 promote dev "$two")"
: >"$STATE/calls"
check 'a merge already live can run again' 0 "$(RELEASE_TRIGGER=merge RELEASE_PIPELINE_SHA=$two RELEASE_GATED_SHA=$two RELEASE_PIPELINE_ID=1 RELEASE_GATED_PIPELINE_ID=1 promote dev "$two")"
check 'a merge already live is a redeploy' same "$(outcome mode)"
contains 'a merge already live still builds' 'docker build' "$(calls)"
contains 'a merge already live writes its record' "host marker-write dev $two" "$(calls)"
check 'invalid secret names cannot break deployment' 0 "$(RELEASE_DEPLOY_SECRETS_JSON='{"BAD-NAME":"value","9INVALID":"value","VALID_NAME":"value"}' promote dev "$two")"

invalid=2026-02-30.1
git push -q origin "$one:refs/tags/$invalid"
check 'an impossible calendar date is not a release version' 2026-10-12.1 "$(sh "$release/version.sh" "$one")"
unset RELEASE_NOW
before=$(TZ=UTC date +%Y-%m-%d)
clockVersion=$(sh "$release/version.sh" "$two")
after=$(TZ=UTC date +%Y-%m-%d)
case "$clockVersion" in "$before.1" | "$after.1") actual=valid ;; *) actual=$clockVersion ;; esac
check 'the real clock supplies the release date when RELEASE_NOW is absent' valid "$actual"
RELEASE_NOW=1791806400
export RELEASE_NOW

git push -q origin "$one:refs/tags/2026-10-12.1"
printf 'another commit owns this release\n' >"$STATE/release-2026-10-12.1.md"
: >"$STATE/calls"
status=0
sh "$release/publish.sh" production "$two" 2026-10-12.1 >"$tmp/publish.log" 2>&1 || status=$?
check 'tag ownership is checked even when a release object exists' 4 "$status"
lacks 'ownership failure does not inspect the release object' 'host release-exists' "$(calls)"
done_testing
