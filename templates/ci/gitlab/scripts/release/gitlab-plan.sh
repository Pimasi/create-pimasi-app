#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

verifiedUpstream() (
    [ -n "${CI_JOB_TOKEN:-}" ] && [ -n "${CI_API_V4_URL:-}" ] || exit 1
    case "${RELEASE_PIPELINE_ID:-}:${CI_PROJECT_ID:-}" in
        :* | *: | *[!0-9:]*) exit 1 ;;
    esac
    [ "${RELEASE_SHA:-}" = "${RELEASE_PIPELINE_SHA:-}" ] &&
        [ "${RELEASE_SHA:-}" = "${RELEASE_GATED_SHA:-}" ] &&
        [ "$RELEASE_PIPELINE_ID" = "${RELEASE_GATED_PIPELINE_ID:-}" ] || exit 1
    umask 077
    proofDir=$(mktemp -d)
    trap 'rm -rf "$proofDir"' 0
    trap 'exit 130' INT
    trap 'exit 143' TERM
    printf 'JOB-TOKEN: %s\n' "$CI_JOB_TOKEN" >"$proofDir/headers"
    httpStatus=$(curl -sS --connect-timeout 10 --max-time 60 \
        -H "@$proofDir/headers" -o "$proofDir/upstream" -w '%{http_code}' \
        "$CI_API_V4_URL/projects/$CI_PROJECT_ID/pipelines/$RELEASE_PIPELINE_ID") || exit 1
    [ "$httpStatus" = 200 ] || exit 1
    jq -e --argjson id "$RELEASE_PIPELINE_ID" --argjson project "$CI_PROJECT_ID" \
        --arg sha "$RELEASE_SHA" --arg main "$RELEASE_MAIN" '
        .id == $id and .project_id == $project and .sha == $sha and
        .ref == $main and .source == "push" and
        (.status == "running" or .status == "success")
    ' "$proofDir/upstream" >/dev/null
)

plan=$(sh "$here/environment-plan.sh" "${RELEASE_ENV:-production}")
name=$(printf '%s' "$plan" | jq -r '.environment')
publish=$(printf '%s' "$plan" | jq -r '.publish')
trigger=manual
reserved=false
if [ "${CI_PIPELINE_SOURCE:-}" = pipeline ] && [ "${RELEASE_BUTTON_INPUT:-false}" = true ]; then
    reserved=true
fi
pipelineSha=
pipelineId=
gatedSha=
gatedPipelineId=
if [ "${CI_PIPELINE_SOURCE:-}" = pipeline ] && [ "${RELEASE_ON_MERGE_INPUT:-false}" = true ]; then
    [ "$publish" = "${RELEASE_PLAN_PUBLISH:-}" ] || die "environment publication changed after the gate; run a new pipeline" 3
    trigger=merge
    if verifiedUpstream; then
        pipelineSha=$RELEASE_PIPELINE_SHA
        pipelineId=$RELEASE_PIPELINE_ID
        gatedSha=$RELEASE_GATED_SHA
        gatedPipelineId=$RELEASE_GATED_PIPELINE_ID
    else
        say "upstream pipeline identity is unverified; running the full gate"
    fi
fi
jq -n --indent 4 --arg environment "$name" --arg sha "${RELEASE_SHA:-}" \
    --arg publish "$publish" --arg trigger "$trigger" --arg runner_tag "${RELEASE_RUNNER_TAG:-release}" \
    --arg pipeline_sha "$pipelineSha" --arg pipeline_id "$pipelineId" \
    --arg gated_sha "$gatedSha" --arg gated_pipeline_id "$gatedPipelineId" \
    --arg reserved "$reserved" \
    '{include: [{local: ".gitlab/promote.yml", inputs: {
        environment: $environment, sha: $sha, publish: $publish, trigger: $trigger,
        pipeline_sha: $pipeline_sha, pipeline_id: $pipeline_id,
        gated_sha: $gated_sha, gated_pipeline_id: $gated_pipeline_id,
        release_runner_tags: (if $trigger == "merge" or $reserved == "true" then [$runner_tag] else [] end)
    }}]}'
