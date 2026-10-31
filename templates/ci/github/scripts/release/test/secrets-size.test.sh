#!/bin/sh
. "$(dirname -- "$0")/harness.sh"

diagnosticRuns() {
    predicate=$(printf '%s' "$diagnosticCondition" | sed \
        -e 's/failure()/$failed/g' -e 's/success()/($failed | not)/g' \
        -e 's/cancelled()/false/g' -e 's/always()/true/g' \
        -e 's/steps\.promote\.outcome/$outcome/g' \
        -e 's/steps\.promote\.outputs\.started/$started/g' \
        -e 's/&&/ and /g' -e "s/'/\"/g")
    case "$diagnosticCondition" in
        *'failure()'* | *'success()'* | *'cancelled()'* | *'always()'*) ;;
        *) predicate="(\$failed | not) and ($predicate)" ;;
    esac
    jq -nr --argjson failed "$1" --arg outcome "$2" --arg started "$3" "$predicate"
}

workflow=$release_source/../../.github/workflows/promote.yml
for job in release publish; do
    diagnosticCondition=$(awk -v job="$job" '
        $0 == "    " job ":" { inJob = 1; next }
        inJob && /^    [a-z]+:/ { exit }
        inJob && /steps.promote.outputs.started/ { sub(/^            - if: /, ""); print; exit }
    ' "$workflow")
    check "$job diagnoses a promotion that could not start" true "$(diagnosticRuns true failure '')"
    check "$job does not mislabel a started release failure" false "$(diagnosticRuns true failure true)"
    check "$job does not diagnose a successful release" false "$(diagnosticRuns false success true)"
    check "$job does not mislabel a checkout failure" false "$(diagnosticRuns true skipped '')"
    awk -v job="$job" '
        $0 == "    " job ":" { inJob = 1; next }
        inJob && /^    [a-z]+:/ { exit }
        inJob && /^            - run: make release$/ { print "make release"; exit }
        inJob && /^            - id: promote$/ { inStep = 1; next }
        inStep && /^              run: \|$/ { inRun = 1; next }
        inRun && /^                  / { sub(/^                  /, ""); print; next }
        inRun { exit }
    ' "$workflow" >"$tmp/release-step"
    awk -v job="$job" '
        $0 == "    " job ":" { inJob = 1; next }
        inJob && /^    [a-z]+:/ { exit }
        inJob && /steps.promote.outputs.started/ { inStep = 1; next }
        inStep && /^              run: \|$/ { inRun = 1; next }
        inRun && /^                  / { sub(/^                  /, ""); print; next }
        inRun { exit }
    ' "$workflow" >"$tmp/launch-failure"
    contains "$job marks a started promotion step" 'started=true' "$(cat "$tmp/release-step")"
    contains "$job guards the launch diagnostic by a failed promotion step" "steps.promote.outcome == 'failure'" "$(grep steps.promote.outcome "$workflow" || true)"
    cat >"$tmp/bin/make" <<'MAKE'
#!/bin/sh
printf 'release called\n' >>"$STATE/release-called"
MAKE
    chmod +x "$tmp/bin/make"
    GITHUB_OUTPUT=$tmp/step-output
    export GITHUB_OUTPUT
    for context in SECRETS VARS; do
        for size in 122880 122881 140000; do
            jq -njr --argjson size "$size" '{DEPLOY_VALUE: ("x" * ($size - 19))} | tojson' >"$tmp/context.json"
            check "$job $context fixture has the requested byte length" "$size" "$(wc -c <"$tmp/context.json" | tr -d ' ')"
            rm -f "$STATE/release-called" "$GITHUB_OUTPUT"
            status=0
            (
                if [ "$context" = SECRETS ]; then
                    RELEASE_DEPLOY_SECRETS_JSON=$(cat "$tmp/context.json")
                    export RELEASE_DEPLOY_SECRETS_JSON
                else
                    RELEASE_DEPLOY_VARS_JSON=$(cat "$tmp/context.json")
                    export RELEASE_DEPLOY_VARS_JSON
                fi
                cd "$release_source/../.."
                sh -e "$tmp/release-step"
            ) >"$tmp/step.log" 2>&1 || status=$?
            if [ "$size" -eq 122880 ]; then
                check "$job accepts $context at the documented bound" 0 "$status"
                check "$job runs release at the $context bound" 'release called' "$(cat "$STATE/release-called" 2>/dev/null || true)"
            elif [ "$size" -eq 122881 ]; then
                check "$job rejects oversized $context before promotion" 1 "$status"
                contains "$job explains the $context limit" '120 KiB' "$(cat "$tmp/step.log")"
                check "$job does not promote oversized $context" false "$([ -f "$STATE/release-called" ] && printf true || printf false)"
            else
                check "$job Linux refuses the oversized $context environment before the shell" false "$([ "$status" -eq 0 ] && printf true || printf false)"
                check "$job has no start marker after $context launch refusal" '' "$(cat "$GITHUB_OUTPUT" 2>/dev/null || true)"
                status=0
                sh -e "$tmp/launch-failure" >"$tmp/launch.log" 2>&1 || status=$?
                check "$job launch diagnostic fails clearly" 1 "$status"
                contains "$job launch diagnostic documents the JSON limit" '120 KiB' "$(cat "$tmp/launch.log")"
                lacks "$job launch diagnostic receives no context JSON" RELEASE_DEPLOY_ "$(cat "$tmp/launch-failure")"
            fi
        done
    done
done
done_testing
