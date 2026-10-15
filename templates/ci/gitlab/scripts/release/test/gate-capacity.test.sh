#!/bin/sh
. "$(dirname -- "$0")/harness.sh"

pipeline=$release_source/../../.gitlab-ci.yml
promotion=$release_source/../../.gitlab/promote.yml
job_setting() {
    awk -v job="$2:" -v key="$3:" '
        $0 == job { selected = 1; next }
        selected && /^[^[:space:]]/ { exit }
        selected && $1 == key { sub(/^[[:space:]]*[^:]*:[[:space:]]*/, ""); print; exit }
    ' "$1"
}
RELEASE_ENV=dev
RELEASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
RELEASE_ON_MERGE_INPUT=true
RELEASE_PLAN_PUBLISH=false
CI_PIPELINE_SOURCE=pipeline
export RELEASE_ENV RELEASE_SHA RELEASE_ON_MERGE_INPUT RELEASE_PLAN_PUBLISH CI_PIPELINE_SOURCE
unset RELEASE_RUNNER_TAG 2>/dev/null || true
printf 'RELEASE_PUBLISH=false\nRELEASE_ON_MERGE=true\n' >"$release/environments/dev.env"
plan=$(sh "$release/gitlab-plan.sh")
runnerTags=$(printf '%s' "$plan" | jq -c '.include[0].inputs.release_runner_tags // []')
reserved_capacity() {
    expression=$(job_setting "$1" "$2" tags)
    if [ "$expression" = '$[[ inputs.release_runner_tags ]]' ] && printf '%s' "$runnerTags" | jq -e 'index("release") != null' >/dev/null; then
        printf 1
    else
        printf 0
    fi
}
check "two occupied gate runners leave preparation capacity" 1 "$(reserved_capacity "$pipeline" prepare-release)"
check "two occupied gate runners leave promotion capacity" 1 "$(reserved_capacity "$promotion" .promotion)"
check "main and merge-request gates keep their runner selection" '' "$(job_setting "$pipeline" gate tags)"
check "no opt-in does not serialise ordinary main gates" '' "$(job_setting "$pipeline" gate resource_group)"
check "merge deployments use the reserved runner tag" '["release"]' "$runnerTags"
plan=$(CI_PIPELINE_SOURCE=web sh "$release/gitlab-plan.sh")
check "manual promotions keep untagged runner selection" '[]' "$(printf '%s' "$plan" | jq -c '.include[0].inputs.release_runner_tags')"
check "the environment lock retains its separate namespace" 'release-$RELEASE_ENV' "$(job_setting "$pipeline" release resource_group)"
done_testing
