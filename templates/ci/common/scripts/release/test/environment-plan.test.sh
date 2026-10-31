#!/bin/sh
. "$(dirname -- "$0")/harness.sh"

status=0
plan=$(sh "$release/environment-plan.sh" production 2>"$tmp/plan.log") || status=$?
check "a known environment can be planned" 0 "$status"
check "production requires publication rights" true "$(printf '%s' "$plan" | jq -r '.publish' 2>/dev/null || true)"
printf 'RELEASE_PUBLISH=false\n' >"$release/environments/dev.env"
plan=$(sh "$release/environment-plan.sh" dev 2>"$tmp/plan.log") || true
check "an independent environment needs no publication rights" false "$(printf '%s' "$plan" | jq -r '.publish' 2>/dev/null || true)"
check "the validated name is returned verbatim" dev "$(printf '%s' "$plan" | jq -r '.environment' 2>/dev/null || true)"
for name in absent ../production ''; do
    status=0
    sh "$release/environment-plan.sh" "$name" >"$tmp/plan.log" 2>&1 || status=$?
    check "unknown and invalid environments refuse planning" 3 "$status"
done
done_testing
