#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host

one=$(commit "chore: scaffold")
two=$(commit "feat: add login")
printf '%s\n' "$one" >"$STATE/marker-production"

sh "$release/preview.sh" "$two" >"$tmp/preview" 2>/dev/null
summary=$(cat "$tmp/preview")
contains "names the environment and pending count" "## Waiting for production: 1 pending changes" "$summary"
contains "gives the commit to promote" "Promote with commit $two" "$summary"
contains "lists what is waiting" "- add login \`" "$summary"
lacks "preview assigns no version" "version" "$summary"
lacks "skips what is live" "scaffold" "$summary"

: >"$tmp/preview"
status=0
FAIL_READ=1 sh "$release/preview.sh" "$two" >"$tmp/preview" 2>/dev/null || status=$?
check "an unreadable record does not fail the merge pipeline" "0" "$status"

mkdir -p "$tmp/alt"
cp -R "$release/." "$tmp/alt/"
printf 'RELEASE_PUBLISH=false\n' >"$tmp/alt/environments/uat.env"
printf '%s\n' "$two" >"$STATE/marker-uat"
GITHUB_STEP_SUMMARY=$tmp/summary sh "$tmp/alt/preview.sh" "$two" >"$tmp/preview"
summary=$(cat "$tmp/preview")
contains "a preview names every environment" "Waiting for uat: 0 pending changes" "$summary"
contains "each environment uses its own baseline" "Redeploy of" "$summary"
contains "production still has its pending range" "add login" "$summary"
check "the job summary matches stdout" "$summary" "$(cat "$tmp/summary")"
done_testing
