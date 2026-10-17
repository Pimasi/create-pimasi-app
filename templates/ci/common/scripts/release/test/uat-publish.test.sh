#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools

printf 'RELEASE_PUBLISH=false\nRELEASE_ON_MERGE=true\n' >"$release/environments/dev.env"
printf 'RELEASE_PUBLISH=true\nRELEASE_HEALTH_URL=\n' >"$release/environments/uat.env"
first=$(commit "feat: first change")
second=$(COMMIT_FILE=second.txt commit "feat: second change")
publish_main

branch() {
    git ls-remote --heads origin "refs/heads/$1" | cut -f1
}

check "dev deploys the commit" 0 "$(promote dev "$first")"
check "dev assigns no version" '' "$(outcome version)"
check "dev creates no version tag" 0 "$(sh "$RELEASE_HOST_ADAPTER" tag-list | jq '[.[] | select(.tag | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.[1-9][0-9]*(\\.[1-9][0-9]*)?$"))] | length')"
check "env/dev names the merged commit" "$first" "$(branch env/dev)"

: >"$STATE/calls"
check "uat deploys the commit" 0 "$(promote uat "$first")"
check "uat creates the version" 2026-10-12.1 "$(outcome version)"
check "uat completes publication" succeeded "$(outcome outcome)"
check "uat tags the commit" "$first" "$(git ls-remote --tags origin refs/tags/2026-10-12.1 | cut -f1)"
check "uat creates the release branch" "$first" "$(branch release/2026-10-12.1)"
check "env/uat names the commit" "$first" "$(branch env/uat)"
contains "uat builds with the version" 'APP_VERSION=2026-10-12.1' "$(calls)"

: >"$STATE/calls"
check "production deploys the same commit" 0 "$(promote production "$first")"
check "production reuses the version" 2026-10-12.1 "$(outcome version)"
check "production completes publication" succeeded "$(outcome outcome)"
lacks "production creates no second tag or release" 'host release-publish' "$(calls)"
lacks "production creates no second release branch" 'host created release/' "$(calls)"
check "the commit keeps one version tag" 1 "$(sh "$RELEASE_HOST_ADAPTER" tag-list | jq --arg sha "$first" '[.[] | select(.sha == $sha and (.tag | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.[1-9][0-9]*(\\.[1-9][0-9]*)?$")))] | length')"
check "env/production names the commit" "$first" "$(branch env/production)"
check "production records the reused version" 2026-10-12.1 "$(sh "$RELEASE_HOST_ADAPTER" marker-list production | jq -r '.[0].version')"
contains "production builds with the reused version" 'APP_VERSION=2026-10-12.1' "$(calls)"
check "uat keeps its own live record" "$first" "$(cat "$STATE/marker-uat")"

check "production may deploy before uat" 0 "$(promote production "$second")"
check "production creates the next version when it goes first" 2026-10-12.2 "$(outcome version)"
check "uat then deploys that commit" 0 "$(promote uat "$second")"
check "uat reuses the version production created" 2026-10-12.2 "$(outcome version)"
check "uat leaves env/production alone" "$second" "$(branch env/production)"
done_testing
