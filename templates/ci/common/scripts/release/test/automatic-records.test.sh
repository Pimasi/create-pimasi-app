#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
unset RELEASE_HOST_ADAPTER RELEASE_TOKEN
mkdir -p "$STATE/api"
cp "$release/test/stateful-curl.sh" "$tmp/bin/curl"
chmod +x "$tmp/bin/curl"
old=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
tip=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
if grep -q GITHUB_REPOSITORY "$release/host.sh"; then
    ADAPTER_HOST=github
else
    ADAPTER_HOST=gitlab
fi
GITHUB_TOKEN=contract-token
GITHUB_REPOSITORY=Acme/Shop
GITHUB_GRAPHQL_URL=https://api.github.test/graphql
GITHUB_API_URL=https://api.github.test
CI_JOB_TOKEN=contract-token
CI_API_V4_URL=https://gitlab.test/api/v4
CI_PROJECT_ID=12
export ADAPTER_HOST GITHUB_TOKEN GITHUB_REPOSITORY GITHUB_GRAPHQL_URL GITHUB_API_URL
export CI_JOB_TOKEN CI_API_V4_URL CI_PROJECT_ID
if [ "$ADAPTER_HOST" = github ]; then
    jq -n --arg old "$old" --arg tip "$tip" '[
        {id: 1, sha: $old, task: "release", environment: "dev", status: "success"},
        {id: 2, sha: $tip, task: "deploy", environment: "dev", status: "success"}
    ]' >"$STATE/api/deployments.json"
else
    jq -n --arg old "$old" --arg tip "$tip" '[
        {id: 1, sha: $old, ref: $old, deployable: null, tag: false, environment: {name: "dev"}, status: "success"},
        {id: 2, sha: $tip, ref: "main", deployable: {id: 9}, tag: false, environment: {name: "dev"}, status: "success"}
    ]' >"$STATE/api/deployments.json"
fi
check "an automatic main-tip record cannot replace the promoted baseline" "$old" "$(sh "$release/host.sh" marker-read dev)"
check "automatic host deployments do not enter environment history" 1 "$(sh "$release/host.sh" marker-list dev | jq length)"
check "automatic host deployments do not enter hotfix history" "$old" "$(sh "$release/host.sh" marker-history | jq -r 'map(.sha) | join(",")')"
jq 'map(select(.id == 2))' "$STATE/api/deployments.json" >"$STATE/api/next"
mv "$STATE/api/next" "$STATE/api/deployments.json"
check "a failed first promotion has no baseline despite an automatic record" '' "$(sh "$release/host.sh" marker-read dev)"
done_testing
