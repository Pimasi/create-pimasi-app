#!/bin/sh
. "$(dirname -- "$0")/harness.sh"

pipeline=$(cat "$release_source/../../.gitlab-ci.yml")
promotion=$(cat "$release_source/../../.gitlab/promote.yml" 2>/dev/null || true)
contains "the gate runs with a clean environment" 'sh scripts/release/clean-gate.sh' "$pipeline"
contains "dispatch uses the existing gate job" 'sh scripts/release/dispatch-on-merge.sh' "$pipeline"
contains "promotion pipelines never repeat the push gate" 'if: $RELEASE_SHA == ""' "$pipeline"
contains "the environment lock covers the child promotion" 'resource_group: release-$RELEASE_ENV' "$pipeline"
contains "the parent mirrors deployment failure" 'strategy: mirror' "$pipeline"
contains "inherited variables cannot shadow the environment" 'yaml_variables: false' "$pipeline"
contains "pipeline variables cannot shadow the environment" 'pipeline_variables: false' "$pipeline"
contains "the promotion attaches to its environment" 'name: $RELEASE_ENV' "$promotion"
contains "deployment approvals apply to the promotion" 'action: start' "$promotion"
contains "publishing uses the shared allocation lock" 'resource_group: release' "$promotion"
contains "publication needs the publishing job" 'if: $RELEASE_EXPECT_PUBLISH == "true"' "$promotion"
contains "keyless authentication requests a token" 'id_tokens:' "$promotion"
contains "the token audience can be set through a host variable" 'aud: $RELEASE_ID_TOKEN_AUDIENCE' "$promotion"
contains "the candidate SHA remains the originating pipeline SHA" 'RELEASE_PIPELINE_SHA: $[[ inputs.pipeline_sha ]]' "$promotion"
contains "the candidate pipeline identity remains the originating identity" 'RELEASE_PIPELINE_ID: $[[ inputs.pipeline_id ]]' "$promotion"
lacks "the child does not dispatch recursively" 'dispatch-on-merge' "$promotion"
awk '
    /^gate:/ { inJob = 1; next }
    inJob && /^[^ ]/ { exit }
    inJob && /^    script:/ { inScript = 1; next }
    inScript && /^        - / { sub(/^        - /, ""); print }
' "$release_source/../../.gitlab-ci.yml" >"$tmp/gate-steps"
mkdir -p "$tmp/gate-project/scripts/release"
cat >"$tmp/gate-project/scripts/release/clean-gate.sh" <<'GATE'
#!/bin/sh
printf 'gate\n' >>"$STATE/order"
exit "${GATE_STATUS:-0}"
GATE
cat >"$tmp/gate-project/scripts/release/dispatch-on-merge.sh" <<'DISPATCH'
#!/bin/sh
printf 'dispatch\n' >>"$STATE/order"
DISPATCH
cat >"$tmp/bin/make" <<'MAKE'
#!/bin/sh
printf 'preview\n' >>"$STATE/order"
MAKE
chmod +x "$tmp/bin/make"
status=0
(cd "$tmp/gate-project"; sh -e "$tmp/gate-steps") >"$tmp/gate.log" 2>&1 || status=$?
check "the gate completes before preview and dispatch" 'gate,preview,dispatch' "$(paste -sd, "$STATE/order")"
check "a successful gate permits dispatch" 0 "$status"
: >"$STATE/order"
status=0
(cd "$tmp/gate-project"; GATE_STATUS=42 sh -e "$tmp/gate-steps") >"$tmp/gate.log" 2>&1 || status=$?
check "a failed gate fails the job" 42 "$status"
check "a failed gate never dispatches a promotion" gate "$(cat "$STATE/order")"
done_testing
