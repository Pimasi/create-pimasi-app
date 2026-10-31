#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
CI_PIPELINE_SOURCE=push
CI_COMMIT_BRANCH=main
CI_COMMIT_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
CI_PIPELINE_ID=77
CI_PROJECT_ID=12
CI_API_V4_URL=https://gitlab.test/api/v4
CI_JOB_TOKEN=dispatch-private-token
export CI_PIPELINE_SOURCE CI_COMMIT_BRANCH CI_COMMIT_SHA CI_PIPELINE_ID CI_PROJECT_ID CI_API_V4_URL CI_JOB_TOKEN
unset RELEASE_RUNNER_TAG 2>/dev/null || true

cat >"$tmp/bin/curl" <<'CURL'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$STATE/calls"
method=GET
output=
body=
url=
while [ "$#" -gt 0 ]; do
    case "$1" in
        -X) method=$2; shift 2 ;;
        -o) output=$2; shift 2 ;;
        --data-binary) body=${2#@}; shift 2 ;;
        -H)
            case "$2" in @*) cat "${2#@}" >>"$STATE/headers" ;; esac
            shift 2
            ;;
        -w | --connect-timeout | --max-time) shift 2 ;;
        -sS) shift ;;
        *) url=$1; shift ;;
    esac
done
[ -z "${DISPATCH_NETWORK_FAILURE:-}" ] || exit 7
case "$method:$url" in
    POST:*/trigger/pipeline)
        jq -c . "$body" >>"$STATE/bodies"
        name=$(jq -r '.inputs.environment' "$body")
        if [ "$name" = "${DISPATCH_REFUSED_ENV:-}" ]; then
            printf '{}\n' >"$output"
            printf 403
            exit 0
        fi
        id=$(cat "$STATE/sequence" 2>/dev/null || printf 100)
        id=$((id + 1))
        printf '%s' "$id" >"$STATE/sequence"
        printf '%s' "$name" >"$STATE/pipeline-$id"
        if [ -n "${DISPATCH_INVALID_REPLY:-}" ]; then
            printf '{}\n' >"$output"
        else
            jq -n --argjson id "$id" '{id: $id, status: "created"}' >"$output"
        fi
        printf 201
        ;;
    GET:*/pipelines/*)
        id=${url##*/}
        name=$(cat "$STATE/pipeline-$id")
        if [ -n "${DISPATCH_READ_REFUSED:-}" ]; then
            printf '{}\n' >"$output"
            printf 403
            exit 0
        fi
        if [ -f "$STATE/polled-$id" ]; then
            status=success
            [ "$name" != "${DISPATCH_FAILED_ENV:-}" ] || status=${DISPATCH_END_STATUS:-failed}
        else
            status=${DISPATCH_WAIT_STATUS:-running}
            : >"$STATE/polled-$id"
        fi
        jq -n --argjson id "$id" --arg status "$status" '{id: $id, status: $status}' >"$output"
        printf 200
        ;;
    *) exit 9 ;;
esac
CURL
cat >"$tmp/bin/sleep" <<'SLEEP'
#!/bin/sh
printf 'sleep %s\n' "$*" >>"$STATE/calls"
SLEEP
chmod +x "$tmp/bin/curl" "$tmp/bin/sleep"

dispatch() {
    status=0
    sh "$release/dispatch-on-merge.sh" >"$tmp/dispatch.log" 2>&1 || status=$?
    printf '%s' "$status"
}
reset_dispatch() {
    rm -f "$STATE/sequence" "$STATE"/pipeline-* "$STATE"/polled-*
    : >"$STATE/calls"
    : >"$STATE/bodies"
    : >"$STATE/headers"
}
reset_dispatch
check "no opt-in needs no token or extra pipeline" 0 "$(CI_JOB_TOKEN= dispatch)"
check "no opt-in makes no host request" '' "$(calls)"
printf 'RELEASE_PUBLISH=false\nRELEASE_ON_MERGE=true\n' >"$release/environments/dev.env"
printf 'RELEASE_PUBLISH=true\nRELEASE_ON_MERGE=true\n' >"$release/environments/uat.env"
check "merge requests never dispatch" 0 "$(CI_PIPELINE_SOURCE=merge_request_event dispatch)"
check "a downstream pipeline never dispatches recursively" 0 "$(CI_PIPELINE_SOURCE=pipeline dispatch)"
check "other branches never dispatch" 0 "$(CI_COMMIT_BRANCH=feature dispatch)"
check "release branch pushes deploy no on-merge environment" 0 "$(CI_COMMIT_BRANCH=release/2026-10-12.1 dispatch)"
check "excluded events make no host request" '' "$(calls)"

check "all opted-in environments finish successfully" 0 "$(HOST_ENVIRONMENT_SECRET=never-forward-this dispatch)"
check "one downstream pipeline starts per opted-in environment" 'dev,uat' "$(jq -sr 'map(.inputs.environment) | join(",")' "$STATE/bodies")"
check "each pipeline receives the gated commit and origin identity" true "$(jq -s --arg sha "$CI_COMMIT_SHA" 'all(.[]; .ref == "main" and .inputs.sha == $sha and .inputs.gated_sha == $sha and .inputs.pipeline_sha == $sha and .inputs.gated_pipeline_id == "77" and .inputs.pipeline_id == "77" and .inputs.on_merge == true)' "$STATE/bodies")"
check "publication permissions follow each environment" '[false,true]' "$(jq -sc 'map(.inputs.publish)' "$STATE/bodies")"
check "merge preparations select reserved runner capacity" true "$(jq -s 'all(.[]; .inputs.release_runner_tags == ["release"])' "$STATE/bodies")"
check "the trigger token travels in the JSON body" true "$(jq -s 'all(.[]; .token == "dispatch-private-token")' "$STATE/bodies")"
check "host variables are not forwarded into child scope" true "$(jq -s 'all(.[]; has("variables") | not)' "$STATE/bodies")"
lacks "unrelated secrets never enter trigger inputs" never-forward-this "$(cat "$STATE/bodies")"
lacks "tokens never appear in curl arguments" dispatch-private-token "$(calls)"
lacks "tokens never appear in job output" dispatch-private-token "$(cat "$tmp/dispatch.log")"
contains "polling uses the job token header" 'JOB-TOKEN: dispatch-private-token' "$(cat "$STATE/headers")"
check "both pipelines start before either is polled" 'POST,POST,GET,GET' "$(sed -n '1,4p' "$STATE/calls" | sed -n 's/.*-X \([^ ]*\).*/\1/p' | paste -sd, -)"

for failure in failed canceled skipped; do
    reset_dispatch
    check "$failure downstream makes the original pipeline red" 1 "$(DISPATCH_FAILED_ENV=dev DISPATCH_END_STATUS=$failure dispatch)"
    check "$failure still attempts the other environment" 'dev,uat' "$(jq -sr 'map(.inputs.environment) | join(",")' "$STATE/bodies")"
    contains "$failure still waits for the other environment" '/pipelines/102' "$(calls)"
done
reset_dispatch
check "one refused trigger makes the original pipeline red" 1 "$(DISPATCH_REFUSED_ENV=dev dispatch)"
check "one refused trigger does not prevent the other attempt" 'dev,uat' "$(jq -sr 'map(.inputs.environment) | join(",")' "$STATE/bodies")"
contains "trigger refusal names the environment" dev "$(cat "$tmp/dispatch.log")"
reset_dispatch
check "unreadable downstream state fails visibly" 1 "$(DISPATCH_READ_REFUSED=1 dispatch)"
reset_dispatch
check "invalid trigger replies fail visibly" 1 "$(DISPATCH_INVALID_REPLY=1 dispatch)"
reset_dispatch
check "network failure is not mistaken for success" 1 "$(DISPATCH_NETWORK_FAILURE=1 dispatch)"
reset_dispatch
check "protected manual jobs remain pending until released" 0 "$(DISPATCH_WAIT_STATUS=manual dispatch)"
reset_dispatch
check "an unknown host status is not treated as success" 1 "$(DISPATCH_WAIT_STATUS=unknown dispatch)"
reset_dispatch
check "the next merge still dispatches after a failed attempt" 0 "$(dispatch)"
reset_dispatch
check "a project can choose its reserved runner tag" 0 "$(RELEASE_RUNNER_TAG=reserved-deploy dispatch)"
check "the configured tag travels as structured input" true "$(jq -s 'all(.[]; .inputs.release_runner_tags == ["reserved-deploy"])' "$STATE/bodies")"
done_testing
