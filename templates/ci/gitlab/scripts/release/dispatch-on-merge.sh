#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

[ "${CI_PIPELINE_SOURCE:-}" = push ] || exit 0
[ "${CI_COMMIT_BRANCH:-}" = "$RELEASE_MAIN" ] || exit 0
environments=$(sh "$here/on-merge-environments.sh")
[ "$(printf '%s' "$environments" | jq length)" -gt 0 ] || exit 0
[ -n "${CI_JOB_TOKEN:-}" ] || die "a job token is required to start on-merge promotions"
case "${CI_COMMIT_SHA:-}" in
    '' | *[!0-9a-fA-F]*) die "the gated commit must be a full commit SHA" ;;
esac
[ "${#CI_COMMIT_SHA}" -eq 40 ] || die "the gated commit must be a full commit SHA"
case "${CI_PIPELINE_ID:-}:${CI_PROJECT_ID:-}" in
    :* | *: | *[!0-9:]*) die "the originating pipeline and project IDs are required" ;;
esac

initialise_output
umask 077
dispatchDir=$(mktemp -d "$out/dispatch.XXXXXX")
trap 'rm -rf "$dispatchDir"' 0
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'JOB-TOKEN: %s\n' "$CI_JOB_TOKEN" >"$dispatchDir/headers"
: >"$dispatchDir/pending"

request() {
    method=$1
    path=$2
    shift 2
    httpStatus=$(curl -sS --connect-timeout 10 --max-time 60 -X "$method" \
        -H "@$dispatchDir/headers" -H 'Content-Type: application/json' \
        -o "$dispatchDir/response" -w '%{http_code}' "$@" \
        "${CI_API_V4_URL:?}/projects/$CI_PROJECT_ID$path") || {
        say "could not $method the on-merge pipeline at $path"
        return 1
    }
    case "$httpStatus" in
        2??) return 0 ;;
        *) say "$method $path returned HTTP $httpStatus"; return 1 ;;
    esac
}

failed=0
for name in $(printf '%s' "$environments" | jq -r '.[].environment'); do
    publish=$(printf '%s' "$environments" | jq -r --arg name "$name" '.[] | select(.environment == $name) | .publish')
    jq -n --arg name "$name" --arg ref "$RELEASE_MAIN" --argjson publish "$publish" \
        --arg runner_tag "${RELEASE_RUNNER_TAG:-release}" '
        {ref: $ref, token: env.CI_JOB_TOKEN, inputs: {
            environment: $name, sha: env.CI_COMMIT_SHA, publish: $publish,
            on_merge: true, gated_sha: env.CI_COMMIT_SHA, pipeline_sha: env.CI_COMMIT_SHA,
            gated_pipeline_id: env.CI_PIPELINE_ID, pipeline_id: env.CI_PIPELINE_ID,
            release_runner_tags: [$runner_tag]
        }}
    ' >"$dispatchDir/body"
    if request POST /trigger/pipeline --data-binary "@$dispatchDir/body"; then
        if pipelineId=$(jq -er '.id | select(type == "number" and . > 0 and . == floor)' "$dispatchDir/response"); then
            printf '%s %s\n' "$name" "$pipelineId" >>"$dispatchDir/pending"
            say "$name: started on-merge pipeline $pipelineId"
        else
            say "$name: the host did not return a pipeline ID"
            failed=1
        fi
    else
        say "$name: the on-merge pipeline could not start"
        failed=1
    fi
done

while [ -s "$dispatchDir/pending" ]; do
    : >"$dispatchDir/next"
    while IFS=' ' read -r name pipelineId; do
        if ! request GET "/pipelines/$pipelineId"; then
            say "$name: could not read on-merge pipeline $pipelineId"
            failed=1
            continue
        fi
        if ! pipelineStatus=$(jq -er --argjson id "$pipelineId" 'select(.id == $id) | .status | select(type == "string")' "$dispatchDir/response"); then
            say "$name: the host returned an invalid pipeline status"
            failed=1
            continue
        fi
        case "$pipelineStatus" in
            success) say "$name: on-merge pipeline $pipelineId succeeded" ;;
            created | waiting_for_resource | preparing | pending | running | manual | scheduled)
                printf '%s %s\n' "$name" "$pipelineId" >>"$dispatchDir/next"
                say "$name: waiting for on-merge pipeline $pipelineId ($pipelineStatus)"
                ;;
            *)
                say "$name: on-merge pipeline $pipelineId ended as $pipelineStatus"
                failed=1
                ;;
        esac
    done <"$dispatchDir/pending"
    mv "$dispatchDir/next" "$dispatchDir/pending"
    [ ! -s "$dispatchDir/pending" ] || sleep 5
done
exit "$failed"
