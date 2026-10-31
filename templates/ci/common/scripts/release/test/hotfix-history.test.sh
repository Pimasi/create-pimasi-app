#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
unset RELEASE_HOST_ADAPTER RELEASE_TOKEN
sandbox
fake_tools
mkdir -p "$STATE/api/tags" "$STATE/api/releases" "$STATE/api/statuses"
printf '[]\n' >"$STATE/api/deployments.json"
cp "$release/test/stateful-curl.sh" "$tmp/bin/curl"
chmod +x "$tmp/bin/curl"
if grep -q GITHUB_REPOSITORY "$release/host.sh"; then
    ADAPTER_HOST=github
else
    ADAPTER_HOST=gitlab
fi
GITHUB_TOKEN=contract-token
GITHUB_REPOSITORY=Acme/Shop
GITHUB_GRAPHQL_URL=https://api.github.test/graphql
GITHUB_API_URL=https://api.github.test
GITHUB_ACTOR=contract
CI_JOB_TOKEN=contract-token
CI_API_V4_URL=https://gitlab.test/api/v4
CI_PROJECT_ID=12
CI_REGISTRY_IMAGE=registry.gitlab.test/Acme/Shop
CI_REGISTRY=registry.gitlab.test
CI_REGISTRY_USER=gitlab-ci-token
CI_REGISTRY_PASSWORD=contract-password
export ADAPTER_HOST GITHUB_TOKEN GITHUB_REPOSITORY GITHUB_GRAPHQL_URL GITHUB_API_URL GITHUB_ACTOR
export CI_JOB_TOKEN CI_API_V4_URL CI_PROJECT_ID CI_REGISTRY_IMAGE CI_REGISTRY CI_REGISTRY_USER CI_REGISTRY_PASSWORD
base=$(commit "feat: first released base")
first=$(COMMIT_FILE=first.txt commit "fix: first correction")
second=$(COMMIT_FILE=second.txt commit "fix: second correction")
other_base=$(COMMIT_FILE=next.txt commit "feat: next released base")
third=$(COMMIT_FILE=third.txt commit "fix: third correction")
fourth=$(COMMIT_FILE=fourth.txt commit "fix: fourth correction")
publish_main
check "the first base is published" 0 "$(promote production "$base")"
git fetch -q origin
git worktree add --quiet --detach "$tmp/first" origin/release/2026-10-12.1
git -C "$tmp/first" cherry-pick -x "$first" >/dev/null
hotfix=$(git -C "$tmp/first" rev-parse HEAD)
git -C "$tmp/first" cherry-pick -x "$second" >/dev/null
successor=$(git -C "$tmp/first" rev-parse HEAD)
git -C "$tmp/first" push -q origin HEAD:refs/heads/release/2026-10-12.1
git fetch -q origin
printf 'RELEASE_PUBLISH=false\n' >"$release/environments/dev.env"
check "dev accepts the first base" 0 "$(promote dev "$base")"
check "a non-publishing hotfix finalises without a version" 0 "$(promote dev "$hotfix")"
check "the non-publishing hotfix remains unversioned" '' "$(outcome version)"
check "dev can roll back over its unversioned hotfix" 0 "$(promote dev "$base")"
rm "$release/environments/dev.env"
check "a removed environment cannot restrict the release line" 0 "$(promote production "$successor")"
check "the next line commit becomes production's live commit" "$successor" "$(sh "$release/host.sh" marker-read production)"
printf 'RELEASE_PUBLISH=false\n' >"$release/environments/dev.env"
check "the original unversioned hotfix can be restored" 0 "$(promote dev "$hotfix")"
check "restoring a non-publishing hotfix assigns nothing" '' "$(outcome version)"

check "a different base release remains independent" 0 "$(promote production "$other_base")"
git fetch -q origin
git worktree add --quiet --detach "$tmp/next" origin/release/2026-10-12.2
git -C "$tmp/next" cherry-pick -x "$third" >/dev/null
next_hotfix=$(git -C "$tmp/next" rev-parse HEAD)
git -C "$tmp/next" cherry-pick -x "$fourth" >/dev/null
next_successor=$(git -C "$tmp/next" rev-parse HEAD)
descendant=$(printf 'fix: fifth correction\n' | git commit-tree "$next_successor^{tree}" -p "$next_successor")
git push -q origin "$descendant:refs/heads/release/2026-10-12.2"
git fetch -q origin
check "publication refusal preserves the first hotfix record" 0 "$(REFUSE_RELEASE=1 promote production "$next_hotfix")"
check "the first hotfix reports publication incomplete" 'succeeded, publication incomplete' "$(outcome outcome)"
check "the refused hotfix tag is absent" no "$(test -f "$STATE/api/tags/2026-10-12.2.1" && printf yes || printf no)"
check "production can roll back over its unpublished hotfix" 0 "$(promote production "$other_base")"
check "an unpublished hotfix permits the next line commit after rollback" 0 "$(promote production "$next_successor")"
check "production can return to the base after the next line commit" 0 "$(promote production "$other_base")"
check "the original unpublished hotfix can be restored and published" 0 "$(promote production "$next_hotfix")"
restoredPatch=1
[ "$ADAPTER_HOST" != gitlab ] || restoredPatch=2
check "the original hotfix receives its available patch tag" "$next_hotfix" "$(cat "$STATE/api/tags/2026-10-12.2.$restoredPatch" 2>/dev/null || true)"
check "a descendant continues the first hotfix" 0 "$(promote production "$descendant")"
check "the descendant receives the third patch tag" "$descendant" "$(cat "$STATE/api/tags/2026-10-12.2.3" 2>/dev/null || true)"
check "production can roll back after the second hotfix" 0 "$(promote production "$other_base")"
check "a previously finalised ancestor hotfix can be restored" 0 "$(promote production "$next_hotfix")"
check "restoring the ancestor keeps its assigned patch version" "2026-10-12.2.$restoredPatch" "$(outcome version)"
ignored=1111111111111111111111111111111111111111
jq --arg sha "$ignored" --arg host "$ADAPTER_HOST" '
    length as $count |
    . + ([range(1; 5)] | map(. as $index |
        {id: ($count + $index), sha: $sha, ref: $sha, status: "success", tag: false, deployable: null} +
        (if $host == "github" then
            {environment: "removed", task: "release"} +
            (if $index == 1 then {status: "pending"} else {task: "deploy"} end)
        else
            {environment: {name: "removed"}} +
            (if $index == 1 then {status: "running"} elif $index == 2 then {ref: "main"} elif $index == 3 then {deployable: {id: 1}} else {tag: true} end)
        end)))
' "$STATE/api/deployments.json" >"$STATE/api/filtered.json"
mv "$STATE/api/filtered.json" "$STATE/api/deployments.json"
history=$(sh "$release/host.sh" marker-history 2>"$tmp/history-error" || true)
check "history excludes incomplete and non-release deployments" 0 "$(printf '%s\n' "$history" | jq --arg sha "$ignored" '[.[] | select(.sha == $sha)] | length')"
check "history retains removed-environment hotfixes" true "$(printf '%s\n' "$history" | jq --arg sha "$hotfix" 'any(.[]; .sha == $sha and .environment == "dev")')"
check "ignored historical records do not prevent a valid descendant" 0 "$(promote production "$descendant")"
missing=2222222222222222222222222222222222222222
sh "$release/host.sh" marker-write removed "$missing" ''
status=0
sh "$release/admit.sh" production "$descendant" 2>"$tmp/history-error" || status=$?
check "a missing finalised historical commit does not restrict admission" 0 "$status"
check "admission does not read global finalised history" 0 "$(tail -n 1 "$STATE/calls" | grep -c marker-history || true)"
done_testing
