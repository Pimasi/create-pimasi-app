#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
unset RELEASE_RUNNER_TAG 2>/dev/null || true

: >"$STATE/header-files"
CI_JOB_TOKEN=plan-private-token
CI_API_V4_URL=https://gitlab.test/api/v4
CI_PROJECT_ID=12
export CI_JOB_TOKEN CI_API_V4_URL CI_PROJECT_ID
cat >"$tmp/bin/curl" <<'CURL'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$STATE/calls"
output=
while [ "$#" -gt 0 ]; do
    case "$1" in
        -o) output=$2; shift 2 ;;
        -H)
            case "$2" in @*) cat "${2#@}" >>"$STATE/headers"; printf '%s\n' "${2#@}" >>"$STATE/header-files" ;; esac
            shift 2
            ;;
        *) shift ;;
    esac
done
[ -z "${PLAN_NETWORK_FAILURE:-}" ] || exit 7
cat "$STATE/upstream.json" >"$output"
printf '%s' "${PLAN_HTTP_STATUS:-200}"
CURL
chmod +x "$tmp/bin/curl"
RELEASE_ENV=production
RELEASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export RELEASE_ENV RELEASE_SHA
status=0
plan=$(sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log") || status=$?
check "manual production planning succeeds" 0 "$status"
check "manual production holds publication rights" true "$(printf '%s' "$plan" | jq -r '.include[0].inputs.publish' 2>/dev/null || true)"
check "manual promotions do not claim a passed gate" manual "$(printf '%s' "$plan" | jq -r '.include[0].inputs.trigger' 2>/dev/null || true)"
check "manual promotions keep their runner selection" '[]' "$(printf '%s' "$plan" | jq -c '.include[0].inputs.release_runner_tags')"
printf 'RELEASE_PUBLISH=false\nRELEASE_ON_MERGE=true\n' >"$release/environments/dev.env"
RELEASE_ENV=dev
RELEASE_ON_MERGE_INPUT=true
RELEASE_PLAN_PUBLISH=false
RELEASE_PIPELINE_SHA=$RELEASE_SHA
RELEASE_GATED_SHA=$RELEASE_SHA
RELEASE_PIPELINE_ID=71
RELEASE_GATED_PIPELINE_ID=71
CI_PIPELINE_SOURCE=pipeline
DEPLOY_PASSWORD=must-not-be-forwarded
export RELEASE_ENV RELEASE_ON_MERGE_INPUT RELEASE_PLAN_PUBLISH RELEASE_PIPELINE_SHA RELEASE_GATED_SHA RELEASE_PIPELINE_ID RELEASE_GATED_PIPELINE_ID CI_PIPELINE_SOURCE DEPLOY_PASSWORD
jq -n --arg sha "$RELEASE_SHA" '{id: 71, project_id: 12, sha: $sha, ref: "main", source: "push", status: "running"}' >"$STATE/upstream.json"
status=0
plan=$(sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log") || status=$?
check "merge planning succeeds" 0 "$status"
check "the environment name is unchanged" dev "$(printf '%s' "$plan" | jq -r '.include[0].inputs.environment' 2>/dev/null || true)"
check "merge planning preserves the gated SHA" "$RELEASE_SHA" "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_sha' 2>/dev/null || true)"
check "merge planning preserves the originating SHA" "$RELEASE_SHA" "$(printf '%s' "$plan" | jq -r '.include[0].inputs.pipeline_sha' 2>/dev/null || true)"
check "merge planning preserves the gate identity" 71 "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_pipeline_id' 2>/dev/null || true)"
check "merge planning preserves the originating identity" 71 "$(printf '%s' "$plan" | jq -r '.include[0].inputs.pipeline_id' 2>/dev/null || true)"
check "a non-publishing merge needs no publication" false "$(printf '%s' "$plan" | jq -r '.include[0].inputs.publish' 2>/dev/null || true)"
check "merge promotions select reserved capacity" '["release"]' "$(printf '%s' "$plan" | jq -c '.include[0].inputs.release_runner_tags')"
lacks "project secrets are not forwarded" "$DEPLOY_PASSWORD" "$plan"
check "only explicit promotion metadata enters the child" 'environment,gated_pipeline_id,gated_sha,pipeline_id,pipeline_sha,publish,release_runner_tags,sha,trigger' "$(printf '%s' "$plan" | jq -r '.include[0].inputs | keys | join(",")' 2>/dev/null || true)"
plan=$(RELEASE_RUNNER_TAG='reserved"deploy' sh "$release/gitlab-plan.sh")
check "configured runner tags are escaped as JSON data" '["reserved\"deploy"]' "$(printf '%s' "$plan" | jq -c '.include[0].inputs.release_runner_tags')"
status=0
RELEASE_PLAN_PUBLISH=true sh "$release/gitlab-plan.sh" >"$tmp/plan.log" 2>&1 || status=$?
check "a changed publishing setting refuses the old plan" 3 "$status"
plan=$(CI_PIPELINE_SOURCE=web sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log") || true
check "manual input cannot claim the push gate" manual "$(printf '%s' "$plan" | jq -r '.include[0].inputs.trigger' 2>/dev/null || true)"
check "manual input cannot forward a gate proof" '' "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_sha' 2>/dev/null || true)"
check "manual input cannot select the reserved merge runner" '[]' "$(printf '%s' "$plan" | jq -c '.include[0].inputs.release_runner_tags')"
contains "merge proof reads the upstream pipeline identity" '/projects/12/pipelines/71' "$(calls)"
contains "upstream identity uses the job token header" 'JOB-TOKEN: plan-private-token' "$(cat "$STATE/headers" 2>/dev/null || true)"
lacks "the token stays out of curl arguments" plan-private-token "$(calls)"
cp "$STATE/upstream.json" "$STATE/upstream-valid.json"
for alteration in '.id = 72' '.project_id = 13' '.sha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"' '.ref = "feature"' '.source = "web"' '.status = "failed"'; do
    jq "$alteration" "$STATE/upstream-valid.json" >"$STATE/upstream.json"
    plan=$(sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log")
    check "a mismatched upstream identity clears the gate proof: $alteration" '' "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_pipeline_id')"
    check "a mismatched identity retains merge stale checks: $alteration" merge "$(printf '%s' "$plan" | jq -r '.include[0].inputs.trigger')"
    contains "a mismatched upstream identity explains the full gate" 'running the full gate' "$(cat "$tmp/plan.log")"
done
cp "$STATE/upstream-valid.json" "$STATE/upstream.json"
for statusCode in 403 404 500; do
    plan=$(PLAN_HTTP_STATUS=$statusCode sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log")
    check "an unreadable upstream pipeline forces the full gate: $statusCode" '' "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_pipeline_id')"
done
plan=$(PLAN_NETWORK_FAILURE=1 sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log")
check "a network error forces the full gate" '' "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_sha')"
printf '{}\n' >"$STATE/upstream.json"
plan=$(sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log")
check "a malformed upstream response forces the full gate" '' "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_sha')"
cp "$STATE/upstream-valid.json" "$STATE/upstream.json"
plan=$(CI_JOB_TOKEN= sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log")
check "no token means the full gate" '' "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_sha')"
plan=$(CI_API_V4_URL= sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log")
check "no API endpoint means the full gate" '' "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_sha')"
plan=$(RELEASE_PIPELINE_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log")
check "the claimed pipeline SHA must match the candidate" '' "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_sha')"
plan=$(RELEASE_PIPELINE_ID= RELEASE_GATED_PIPELINE_ID= sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log")
check "empty caller identities cannot supply a gate proof" '' "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_sha')"
plan=$(RELEASE_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log")
check "another candidate cannot reuse the upstream gate" '' "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_sha')"
plan=$(RELEASE_GATED_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log")
check "the gated SHA must match the upstream identity" '' "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_sha')"
plan=$(RELEASE_GATED_PIPELINE_ID=72 sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log")
check "the gated pipeline must match the upstream identity" '' "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_sha')"
jq '.status = "success"' "$STATE/upstream-valid.json" >"$STATE/upstream.json"
plan=$(sh "$release/gitlab-plan.sh" 2>"$tmp/plan.log")
check "a completed upstream pipeline retains its gate proof" 71 "$(printf '%s' "$plan" | jq -r '.include[0].inputs.gated_pipeline_id')"
while IFS= read -r header; do
    [ ! -e "$header" ] || failures=$((failures + 1))
done <"$STATE/header-files"
done_testing
