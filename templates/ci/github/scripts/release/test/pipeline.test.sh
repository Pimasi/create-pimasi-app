#!/bin/sh
. "$(dirname -- "$0")/harness.sh"

workflows=$release_source/../../.github/workflows
ci=$(cat "$workflows/ci.yml")
manual=$(cat "$workflows/release.yml")
promotion=$(cat "$workflows/promote.yml" 2>/dev/null || true)
contains "the merge gate discovers opted-in environments" on-merge-environments.sh "$ci"
contains "empty independent targets skip their job" "needs.gate.outputs.deploy != '[]'" "$ci"
contains "empty publishing targets skip their job" "needs.gate.outputs.publish != '[]'" "$ci"
contains "one failing environment does not cancel its peers" 'fail-fast: false' "$ci"
contains "the gate passes its proven SHA" 'gated_sha: ${{ needs.gate.outputs.sha }}' "$ci"
contains "the gate runs with a clean environment" 'sh scripts/release/clean-gate.sh' "$ci"
lacks "the gate has no deployment secrets" 'toJSON(secrets)' "$ci"
contains "manual promotion plans publication permissions" environment-plan.sh "$manual"
contains "promotions hold their environment queue" 'group: release-${{ inputs.environment }}' "$promotion"
contains "publishing also holds the allocation queue" 'group: release' "$promotion"
contains "publishing environments cannot evict one another" 'queue: max' "$promotion"
check "a late older gate cannot evict a newer waiting merge" 2 "$(printf '%s\n' "$promotion" | grep -c 'queue: max' || true)"
contains "promotions attach to their own environment" 'name: ${{ inputs.environment }}' "$promotion"
contains "host attachment creates no automatic deployment" 'deployment: false' "$promotion"
contains "keyless login may request an identity token" 'id-token: write' "$promotion"
contains "on-merge proof is bound to the pipeline commit" 'RELEASE_PIPELINE_SHA: ${{ github.sha }}' "$promotion"
contains "on-merge proof uses the successful gate output" 'RELEASE_GATED_SHA: ${{ inputs.gated_sha }}' "$promotion"
contains "the gate proof belongs to this pipeline run" 'RELEASE_PIPELINE_ID: ${{ github.run_id }}' "$promotion"
contains "the gate passes its pipeline identity" 'gated_pipeline_id: ${{ needs.gate.outputs.pipeline_id }}' "$ci"
check "both permission variants attach without deployment" 2 "$(printf '%s\n' "$promotion" | grep -c 'deployment: false' || true)"
check "both promotion jobs can write release and environment branches" 2 "$(printf '%s\n' "$promotion" | grep -c '^            contents: write$' || true)"
check "no promotion job is limited to reading contents" 0 "$(printf '%s\n' "$promotion" | grep -c '^            contents: read$' || true)"
check "both promotion steps receive resolved secrets after attachment" 2 "$(printf '%s\n' "$promotion" | grep -c '^                  RELEASE_DEPLOY_SECRETS_JSON:' || true)"
check "both promotion steps receive resolved variables after attachment" 2 "$(printf '%s\n' "$promotion" | grep -c '^                  RELEASE_DEPLOY_VARS_JSON:' || true)"
check "both promotion steps read RELEASE_TOKEN after attachment, so an environment secret reaches them" 2 "$(printf '%s\n' "$promotion" | grep -c '^                  RELEASE_TOKEN: ${{ secrets.RELEASE_TOKEN }}$' || true)"
done_testing
