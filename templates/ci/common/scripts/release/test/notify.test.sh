#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
. "$(dirname -- "$0")/http-stub.sh"
start_http_stub
REAL_CURL=$(command -v curl)
export REAL_CURL
cat >"$tmp/bin/curl" <<'CURL'
#!/bin/sh
printf '%s\n' "$*" >>"$STATE/curl-arguments"
exec "$REAL_CURL" "$@"
CURL
chmod +x "$tmp/bin/curl"
mkdir -p "$RELEASE_OUT"
unset RELEASE_WEBHOOK_URL
GITHUB_STEP_SUMMARY=$STATE/summary
export GITHUB_STEP_SUMMARY

record() {
    {
        printf "outcome='%s'\nstage='%s'\n" "$1" "$2"
        printf "environment='production'\nsha='abc123def456'\nversion='0.4.0'\nmode='range'\nbase='def456abc123'\nhealth_url='%s'\n" "${3:-}"
    } >"$RELEASE_OUT/outcome.env"
    printf '## Changes def456abc123..abc123def456 (1 commits)\n\n### Fixes\n- say "hi" \\ there\t`abc123def456`\n' >"$RELEASE_OUT/notes.md"
    : >"$STATE/summary"
}

notify() {
    sh "$release/notify.sh" >"$tmp/notify.stdout" 2>"$tmp/notify.stderr"
}

record succeeded "done"
status=0
notify || status=$?
check "no webhook does not fail notification" "0" "$status"
contains "no webhook is logged" "no webhook is configured" "$(cat "$tmp/notify.stderr")"
contains "smoke wording states there is no target" "Published 0.4.0: images pushed and smoke-tested; no deploy target is configured" "$(cat "$STATE/summary")"
lacks "smoke wording makes no live deployment claim" "Released 0.4.0 to production" "$(cat "$STATE/summary")"
check "stdout and the summary file match" "$(cat "$RELEASE_OUT/summary.md")" "$(cat "$tmp/notify.stdout")"
check "the job summary contains the same block" "$(cat "$RELEASE_OUT/summary.md")" "$(cat "$STATE/summary")"
contains "the environment is included" "Environment: production" "$(cat "$STATE/summary")"
contains "the SHA is included" 'SHA: `abc123def456`' "$(cat "$STATE/summary")"
contains "the version is included" "Version: 0.4.0" "$(cat "$STATE/summary")"
contains "the mode is included" "Mode: range" "$(cat "$STATE/summary")"
contains "the notes are included" "### Fixes" "$(cat "$STATE/summary")"
contains "nothing is posted without a webhook" "GET /ready" "$(cat "$STATE/http-headers")"

record succeeded "done" https://target.invalid/ping
notify
contains "a real target gets the released wording" "Released 0.4.0 to production" "$(cat "$STATE/summary")"
record "succeeded, publication incomplete" publication
notify
contains "publication failure has an honest outcome" "Outcome: succeeded, publication incomplete" "$(cat "$STATE/summary")"
contains "publication failure explains the retry" "Promote this SHA again to retry publication." "$(cat "$STATE/summary")"
for host in github gitlab; do
    record "succeeded, publication incomplete" publication
    printf "publication_failure='page'\n" >>"$RELEASE_OUT/outcome.env"
    GITLAB_CI=false
    [ "$host" != gitlab ] || GITLAB_CI=true
    export GITLAB_CI
    notify
    summary=$(cat "$STATE/summary")
    contains "$host page failure names the missed update" 'The environment page was not updated.' "$summary"
    contains "$host page failure names the artefact for manual addition" 'job artefact `env-page.md`, to add by hand' "$summary"
    lacks "$host page failure never advises a same-SHA retry" 'Promote this SHA again' "$summary"
    if [ "$host" = gitlab ]; then
        contains "GitLab page failure names protected-tag permissions" "The promotion's user may not create \`changelog/*\` tags" "$summary"
    else
        contains "GitHub page failure names a host error" 'The host reported an error.' "$summary"
    fi
done
unset GITLAB_CI
record "succeeded, publication incomplete" publication
printf "publication_failure='both'\n" >>"$RELEASE_OUT/outcome.env"
notify
contains "both failures limit the same-SHA retry to version publication" 'Promote this SHA again to retry version publication only.' "$(cat "$STATE/summary")"
contains "both failures retain manual recovery for the page" 'job artefact `env-page.md`, to add by hand' "$(cat "$STATE/summary")"
record failed health
notify
contains "failure names the stage" "Promotion to production failed at health" "$(cat "$STATE/summary")"
contains "failure states the record did not move" "The live record is unchanged." "$(cat "$STATE/summary")"
record rejected admit
notify
contains "rejection names the outcome" "Promotion to production rejected" "$(cat "$STATE/summary")"

record succeeded "done"
printf 'Existing summary\n' >"$STATE/summary"
RELEASE_WEBHOOK_URL=$HTTP_STUB_URL/webhook
export RELEASE_WEBHOOK_URL
notify
contains "summary appends existing text" "Existing summary" "$(cat "$STATE/summary")"
contains "the webhook endpoint is used" "POST /webhook" "$(cat "$STATE/http-headers")"
check "the webhook has exactly one text field" "text" "$(jq -r 'keys | join(",")' "$STATE/http-body")"
check "the webhook text is the complete summary" "$(cat "$RELEASE_OUT/summary.md")" "$(jq -r .text "$STATE/http-body")"

printf '500\n' >"$STATE/http-status"
status=0
notify || status=$?
check "a failed webhook does not fail notification" "0" "$status"
contains "a failed webhook warns" "the webhook post failed" "$(cat "$tmp/notify.stderr")"
status=0
sh "$release/notify.sh" --test >"$tmp/test.stdout" 2>"$tmp/test.stderr" || status=$?
check "the strict test fails for HTTP errors" "1" "$status"
RELEASE_WEBHOOK_URL=http://127.0.0.1:1
status=0
sh "$release/notify.sh" --test >"$tmp/test.stdout" 2>"$tmp/test.stderr" || status=$?
check "the strict test fails for network errors" "1" "$status"
unset RELEASE_WEBHOOK_URL
status=0
sh "$release/notify.sh" --test >"$tmp/test.stdout" 2>"$tmp/test.stderr" || status=$?
check "the strict test fails without a URL" "1" "$status"
printf '200\n' >"$STATE/http-status"
RELEASE_WEBHOOK_URL=$HTTP_STUB_URL/webhook
export RELEASE_WEBHOOK_URL
status=0
sh "$release/notify.sh" --test >"$tmp/test.stdout" 2>"$tmp/test.stderr" || status=$?
check "the strict test succeeds when received" "0" "$status"
contains "the strict test is labelled" "TEST ONLY" "$(jq -r .text "$STATE/http-body")"
unset GITHUB_STEP_SUMMARY RELEASE_WEBHOOK_URL
notify
check "notification needs no host summary file" "$(cat "$RELEASE_OUT/summary.md")" "$(cat "$tmp/notify.stdout")"
rm "$RELEASE_OUT/outcome.env"
status=0
notify || status=$?
check "a missing outcome is harmless" "0" "$status"
lacks "credentials never appear in curl arguments" "$HTTP_STUB_URL/webhook" "$(cat "$STATE/curl-arguments")"
done_testing
