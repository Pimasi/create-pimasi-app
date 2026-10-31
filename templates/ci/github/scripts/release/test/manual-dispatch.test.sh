#!/bin/sh
. "$(dirname -- "$0")/harness.sh"

workflow=$release_source/../../.github/workflows/release.yml
prepare=$(awk '
    /^    prepare:/ { inJob = 1; next }
    inJob && /^    [a-z]+:/ { exit }
    inJob { print }
' "$workflow")
lacks "manual preparation cannot silently skip another branch" "        if: github.ref == 'refs/heads/main'" "$prepare"
printf '%s\n' "$prepare" | awk '
    /^            - name: Require main$/ { inStep = 1; next }
    inStep && /^              run: \|$/ { inRun = 1; next }
    inRun && /^                  / { sub(/^                  /, ""); print; next }
    inRun { exit }
' >"$tmp/require-main"
status=0
GITHUB_REF=refs/heads/feature sh -e "$tmp/require-main" >"$tmp/branch.log" 2>&1 || status=$?
check "a dispatch from another branch fails" 3 "$status"
contains "a rejected dispatch explains the required branch" 'run the release workflow from main' "$(cat "$tmp/branch.log")"
status=0
GITHUB_REF=refs/heads/main sh -e "$tmp/require-main" >"$tmp/branch.log" 2>&1 || status=$?
check "a dispatch from main passes the branch check" 0 "$status"
done_testing
