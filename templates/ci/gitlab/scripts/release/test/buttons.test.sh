#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
unset RELEASE_RUNNER_TAG 2>/dev/null || true
pipeline=$release_source/../../.gitlab-ci.yml

block() {
    awk -v job="$1:" '
        $0 == job { inside = 1; next }
        inside && /^[^ ]/ { exit }
        inside { print }
    ' "$pipeline"
}

steps() {
    block "$1" | awk '
        /^    script:/ { inside = 1; next }
        inside && /^        - / { sub(/^        - /, ""); print; next }
        inside { exit }
    '
}

rules() {
    block "$1" | awk '
        /^    rules:/ { inside = 1; next }
        inside && /^        / { print; next }
        inside { exit }
    '
}

contains "release branches start pipelines" 'if: $CI_COMMIT_BRANCH =~ /^release\//' "$(block workflow)"
check "environment branches never start pipelines" 'when: never' "$(grep -F -A 1 'if: $CI_COMMIT_BRANCH =~ /^env\//' "$pipeline" | tail -n 1 | sed 's/^ *//')"
for job in prepare-buttons buttons; do
    contains "$job runs for main pushes" '- if: $RELEASE_SHA == "" && $CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "main"' "$(rules "$job")"
    contains "$job runs for release branch pushes" '- if: $RELEASE_SHA == "" && $CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH =~ /^release\//' "$(rules "$job")"
    check "$job has no other rule" 2 "$(rules "$job" | grep -c -- '- if:')"
done
bridge=$(block buttons)
contains "the bridge includes the generated child" 'artifact: .release/buttons.yml' "$bridge"
contains "the bridge reads the preparation artefact" 'job: prepare-buttons' "$bridge"
contains "the bridge starts once the list is ready" '- prepare-buttons' "$bridge"
contains "the bridge forwards no YAML variables" 'yaml_variables: false' "$bridge"
contains "the bridge forwards no pipeline variables" 'pipeline_variables: false' "$bridge"
lacks "the bridge never waits for a button" 'strategy:' "$bridge"
lacks "the bridge inherits the global variables its rules read" 'inherit:' "$bridge"
contains "promotion planning receives the button input" 'RELEASE_BUTTON_INPUT=$[[ inputs.button ]]' "$(block prepare-release)"
check "the button input defaults to false" 'type: boolean default: false' "$(sed -n '/^spec:/,/^---/p' "$pipeline" | awk '/^        button:$/ { inside = 1; next } inside && /^            / { sub(/^ +/, ""); printf "%s%s", sep, $0; sep = " "; next } inside { exit }')"

sandbox
rm -rf scripts/release
cp -R "$release" scripts/release
printf '#!/bin/sh\nprintf "stale tooling\\n"\n' >scripts/release/gitlab-buttons.sh
rm -f scripts/release/dispatch-button.sh
old=$(commit "chore: release tooling")
publish_main
git push -q origin "$old:refs/tags/2026-10-12.1" "$old:refs/heads/release/2026-10-12.1"
cp "$release/gitlab-buttons.sh" "$release/dispatch-button.sh" scripts/release/
printf 'RELEASE_PUBLISH=true\nRELEASE_HEALTH_URL=\n' >scripts/release/environments/uat.env
printf 'RELEASE_PUBLISH=false\nRELEASE_ON_MERGE=true\n' >scripts/release/environments/dev.env
printf 'RELEASE_PUBLISH=false\nRELEASE_ON_MERGE=false\n' >scripts/release/environments/qa.env
commit "chore: current release tooling" >/dev/null
publish_main
hotfix=$(printf 'fix: repair\n' | git commit-tree "$old^{tree}" -p "$old")
git push -q origin "$hotfix:refs/heads/release/2026-10-12.1"
git clone -q "file://$tmp/remote.git" "$tmp/job"
git -C "$tmp/job" checkout -q --detach "$hotfix"
check "the release commit carries stale button tooling" no "$(if [ -f "$tmp/job/scripts/release/dispatch-button.sh" ]; then printf yes; else printf no; fi)"

steps prepare-buttons >"$tmp/prepare-steps"
mkdir -p "$tmp/job-tmp"
status=0
(cd "$tmp/job" && TMPDIR=$tmp/job-tmp CI_COMMIT_SHA=$hotfix CI_COMMIT_BRANCH=release/2026-10-12.1 CI_PIPELINE_SOURCE=push sh -e "$tmp/prepare-steps") >"$tmp/prepare.log" 2>&1 || status=$?
check "buttons are prepared on a release branch" 0 "$status"
child=$tmp/job/.release/buttons.yml
check "the child lists one button per manual environment on main" 'deploy-production,deploy-qa,deploy-uat' "$(jq -r 'keys - ["default"] | join(",")' "$child" 2>/dev/null || true)"
check "every button is manual" true "$(jq '[to_entries[] | select(.key != "default") | .value.when == "manual"] | all' "$child" 2>/dev/null || true)"
lacks "on-merge environments get no button" deploy-dev "$(cat "$child" 2>/dev/null || true)"
lacks "the release commit's own generator is not used" 'stale tooling' "$(cat "$child" 2>/dev/null || true)"

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
case "$method:$url" in
    POST:https://gitlab.test/api/v4/projects/12/trigger/pipeline)
        jq -c . "$body" >>"$STATE/bodies"
        if [ -n "${BUTTON_REFUSED:-}" ]; then
            printf '{}\n' >"$output"
            printf 403
            exit 0
        fi
        jq -n '{id: 101, status: "created"}' >"$output"
        printf 201
        ;;
    GET:https://gitlab.test/api/v4/projects/12/pipelines/101)
        reads=$(cat "$STATE/reads" 2>/dev/null || printf 0)
        reads=$((reads + 1))
        printf '%s\n' "$reads" >"$STATE/reads"
        case " ${BUTTON_FAILED_READS:-} " in
            *" $reads "*)
                printf '{}\n' >"$output"
                printf 502
                exit 0
                ;;
        esac
        if [ -f "$STATE/polled" ]; then
            status=${BUTTON_END_STATUS:-success}
        else
            status=${BUTTON_WAIT_STATUS:-running}
            : >"$STATE/polled"
        fi
        jq -n --arg status "$status" '{id: 101, status: $status}' >"$output"
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
jq -r '.["deploy-uat"].script[]' "$child" >"$tmp/button-steps" 2>/dev/null || : >"$tmp/button-steps"
printf 'RELEASE_PUBLISH=true\nRELEASE_HEALTH_URL=\n' >"$release/environments/uat.env"
press() {
    rm -f "$STATE/polled" "$STATE/reads"
    : >"$STATE/calls"
    : >"$STATE/bodies"
    : >"$STATE/headers"
    status=0
    (cd "$tmp/job" && TMPDIR=$tmp/job-tmp CI_COMMIT_SHA=$hotfix CI_JOB_TOKEN=button-private-token CI_API_V4_URL=https://gitlab.test/api/v4 CI_PROJECT_ID=12 sh -e "$tmp/button-steps") >"$tmp/button.log" 2>&1 || status=$?
    printf '%s' "$status"
}
check "the uat button waits for a successful promotion" 0 "$(press)"
check "the button starts one pipeline" 1 "$(wc -l <"$STATE/bodies" | tr -d ' ')"
check "the button starts the pipeline on main" main "$(jq -r .ref "$STATE/bodies" 2>/dev/null || true)"
check "the button promotes its own pipeline's commit" "$hotfix" "$(jq -r .inputs.sha "$STATE/bodies" 2>/dev/null || true)"
check "the button names its environment" uat "$(jq -r .inputs.environment "$STATE/bodies" 2>/dev/null || true)"
check "the button starts a manual promotion" false "$(jq -r .inputs.on_merge "$STATE/bodies" 2>/dev/null || true)"
check "the button identifies itself to planning" true "$(jq -r .inputs.button "$STATE/bodies" 2>/dev/null || true)"
check "the started preparation uses the reserved runner" '["release"]' "$(jq -c .inputs.release_runner_tags "$STATE/bodies" 2>/dev/null || true)"
check "the button forwards no gate proof" 'button,environment,on_merge,release_runner_tags,sha' "$(jq -r '.inputs | keys | join(",")' "$STATE/bodies" 2>/dev/null || true)"
check "the trigger token travels in the request body" button-private-token "$(jq -r .token "$STATE/bodies" 2>/dev/null || true)"
contains "the button polls the started pipeline" '/pipelines/101' "$(cat "$STATE/calls")"
contains "polling uses the job token header" 'JOB-TOKEN: button-private-token' "$(cat "$STATE/headers")"
lacks "the token never appears in curl arguments" button-private-token "$(cat "$STATE/calls")"
lacks "the token never appears in the job log" button-private-token "$(cat "$tmp/button.log")"
uatBody=$(cat "$STATE/bodies")
jq -r '.["deploy-production"].script[]' "$child" >"$tmp/button-steps" 2>/dev/null || : >"$tmp/button-steps"
check "the production button on the same pipeline succeeds" 0 "$(press)"
check "the production button promotes the same commit as the uat button" "$(printf '%s' "$uatBody" | jq -r .inputs.sha)" "$(jq -r .inputs.sha "$STATE/bodies" 2>/dev/null || true)"
check "the production button names production" production "$(jq -r .inputs.environment "$STATE/bodies" 2>/dev/null || true)"
jq -r '.["deploy-uat"].script[]' "$child" >"$tmp/button-steps" 2>/dev/null || : >"$tmp/button-steps"
check "a promotion awaiting approval keeps the button waiting" 0 "$(BUTTON_WAIT_STATUS=manual press)"
contains "a waiting button pauses between polls" 'sleep 5' "$(cat "$STATE/calls")"
check "a failed promotion makes the button fail" 1 "$(BUTTON_END_STATUS=failed press)"
contains "a failed promotion names its pipeline" 'ended as failed' "$(cat "$tmp/button.log")"
check "a refused trigger makes the button fail" 1 "$(BUTTON_REFUSED=1 press)"
check "failed status reads keep the button waiting" 0 "$(BUTTON_FAILED_READS='1 2 3 4' press)"
contains "a failed status read is tried again after a pause" 'could not read promotion pipeline 101; reading it again' "$(cat "$tmp/button.log")"
check "each failed status read pauses before the next read" rsrsrsrsrsr "$(awk '/\/pipelines\/101/ { printf "r" } /^sleep 5$/ { printf "s" }' "$STATE/calls")"
check "only failed status reads in a row count" 0 "$(BUTTON_FAILED_READS='1 2 3 4 6 7 8 9' press)"
check "five failed status reads in a row make the button fail" 1 "$(BUTTON_FAILED_READS='1 2 3 4 5' press)"
contains "the failed button says the promotion may still be running" 'could not read promotion pipeline 101 5 times in a row; it may still be running' "$(cat "$tmp/button.log")"
status=0
(cd "$tmp/job" && CI_COMMIT_SHA=$hotfix CI_JOB_TOKEN=button-private-token CI_API_V4_URL=https://gitlab.test/api/v4 CI_PROJECT_ID=12 sh "$release/dispatch-button.sh" missing) >"$tmp/missing.log" 2>&1 || status=$?
check "an unknown environment never starts a pipeline" 3 "$status"
status=0
(cd "$tmp/job" && : >"$STATE/bodies" && CI_COMMIT_SHA=abc123 CI_JOB_TOKEN=button-private-token CI_API_V4_URL=https://gitlab.test/api/v4 CI_PROJECT_ID=12 sh "$release/dispatch-button.sh" uat) >"$tmp/short.log" 2>&1 || status=$?
check "a short commit never starts a pipeline" 1 "$status"
check "refused buttons send nothing" '' "$(cat "$STATE/bodies")"

plan() {
    RELEASE_ENV=uat RELEASE_SHA=$hotfix sh "$release/gitlab-plan.sh"
}
input() {
    printf '%s' "$1" | jq -c ".include[0].inputs.$2"
}
planned=$(CI_PIPELINE_SOURCE=pipeline RELEASE_BUTTON_INPUT=true plan)
check "a button promotion plans a manual trigger" '"manual"' "$(input "$planned" trigger)"
check "a button promotion forwards no gate proof" '""' "$(input "$planned" gated_sha)"
check "a button promotion plans the reserved runner" '["release"]' "$(input "$planned" release_runner_tags)"
check "a button promotion keeps the environment's publication" '"true"' "$(input "$planned" publish)"
planned=$(CI_PIPELINE_SOURCE=web RELEASE_BUTTON_INPUT=true plan)
check "the form cannot claim the reserved runner through the button input" '[]' "$(input "$planned" release_runner_tags)"
planned=$(CI_PIPELINE_SOURCE=pipeline RELEASE_BUTTON_INPUT=false plan)
check "other started pipelines keep untagged runners" '[]' "$(input "$planned" release_runner_tags)"
planned=$(RELEASE_RUNNER_TAG=reserved-deploy CI_PIPELINE_SOURCE=pipeline RELEASE_BUTTON_INPUT=true plan)
check "a button promotion uses the configured runner tag" '["reserved-deploy"]' "$(input "$planned" release_runner_tags)"

mkdir -p "$tmp/all-merge"
cp -R "$release/." "$tmp/all-merge/"
for file in "$tmp/all-merge/environments/"*.env; do
    printf 'RELEASE_PUBLISH=false\nRELEASE_ON_MERGE=true\n' >"$file"
done
empty=$(sh "$tmp/all-merge/gitlab-buttons.sh" 2>/dev/null || true)
check "a project with no manual environment still gets one valid job" 1 "$(printf '%s' "$empty" | jq -r 'keys - ["default"] | length' 2>/dev/null || true)"
lacks "a project with no manual environment gets no button" '"manual"' "$empty"
done_testing
