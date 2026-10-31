#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

name=${1:-}
sh "$here/environment-plan.sh" "$name" >/dev/null || exit "$?"
[ -n "${CI_JOB_TOKEN:-}" ] || die "a job token is required to start a promotion"
case "${CI_COMMIT_SHA:-}" in
    '' | *[!0-9a-fA-F]*) die "the commit must be a full commit SHA" ;;
esac
[ "${#CI_COMMIT_SHA}" -eq 40 ] || die "the commit must be a full commit SHA"
case "${CI_PROJECT_ID:-}" in
    '' | *[!0-9]*) die "the project ID is required" ;;
esac

initialise_output
umask 077
buttonDir=$(mktemp -d "$out/button.XXXXXX")
trap 'rm -rf "$buttonDir"' 0
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'JOB-TOKEN: %s\n' "$CI_JOB_TOKEN" >"$buttonDir/headers"

request() {
    method=$1
    path=$2
    shift 2
    httpStatus=$(curl -sS --connect-timeout 10 --max-time 60 -X "$method" \
        -H "@$buttonDir/headers" -H 'Content-Type: application/json' \
        -o "$buttonDir/response" -w '%{http_code}' "$@" \
        "${CI_API_V4_URL:?}/projects/$CI_PROJECT_ID$path") || return 1
    case "$httpStatus" in
        2??) return 0 ;;
        *) say "$method $path returned HTTP $httpStatus"; return 1 ;;
    esac
}

jq -n --arg name "$name" --arg ref "$RELEASE_MAIN" --arg runner_tag "${RELEASE_RUNNER_TAG:-release}" '
    {ref: $ref, token: env.CI_JOB_TOKEN, inputs: {
        environment: $name, sha: env.CI_COMMIT_SHA, on_merge: false, button: true,
        release_runner_tags: [$runner_tag]
    }}
' >"$buttonDir/body"
request POST /trigger/pipeline --data-binary "@$buttonDir/body" || die "$name: the promotion pipeline could not start"
pipelineId=$(jq -er '.id | select(type == "number" and . > 0 and . == floor)' "$buttonDir/response") || die "$name: the host did not return a pipeline ID"
pipelineUrl=$(jq -r '.web_url // "" | select(type == "string")' "$buttonDir/response")
say "$name: promoting $CI_COMMIT_SHA in pipeline $pipelineId${pipelineUrl:+ $pipelineUrl}"
failedReads=0
while :; do
    if ! request GET "/pipelines/$pipelineId"; then
        failedReads=$((failedReads + 1))
        [ "$failedReads" -lt 5 ] || die "$name: could not read promotion pipeline $pipelineId $failedReads times in a row; it may still be running"
        say "$name: could not read promotion pipeline $pipelineId; reading it again"
        sleep 5
        continue
    fi
    failedReads=0
    pipelineStatus=$(jq -er --argjson id "$pipelineId" 'select(.id == $id) | .status | select(type == "string")' "$buttonDir/response") || die "$name: the host returned an invalid pipeline status"
    case "$pipelineStatus" in
        success)
            say "$name: promotion pipeline $pipelineId succeeded"
            exit 0
            ;;
        created | waiting_for_resource | preparing | pending | running | manual | scheduled)
            say "$name: waiting for promotion pipeline $pipelineId ($pipelineStatus)"
            sleep 5
            ;;
        *) die "$name: promotion pipeline $pipelineId ended as $pipelineStatus" ;;
    esac
done
