#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
sha=$(commit "feat: publication planning")
publish_main
fake_host
fake_tools

for setting in '' '""' false FALSE yes 1; do
    printf 'RELEASE_PUBLISH=%s\n' "$setting" >"$release/environments/dev.env"
    planned=$(sh "$release/environment-plan.sh" dev | jq -r .publish)
    check "${setting:-empty} plans without publication" false "$planned"
    : >"$STATE/calls"
    check "${setting:-empty} promotes with its unchanged publication plan" 0 "$(RELEASE_EXPECT_PUBLISH=$planned promote dev "$sha")"
    lacks "${setting:-empty} does not allocate a release version" 'host tag-list' "$(calls)"
done

printf 'RELEASE_PUBLISH=true\n' >"$release/environments/dev.env"
: >"$STATE/calls"
check "enabling publication rejects an earlier non-publishing plan" 3 "$(RELEASE_EXPECT_PUBLISH=false promote dev "$sha")"
lacks "enabling publication with the wrong lock never builds" 'docker build' "$(calls)"
lacks "enabling publication with the wrong lock never allocates" 'host tag-list' "$(calls)"

printf 'RELEASE_PUBLISH=\n' >"$release/environments/dev.env"
: >"$STATE/calls"
check "disabling publication rejects an earlier publishing plan" 3 "$(RELEASE_EXPECT_PUBLISH=true promote dev "$sha")"
lacks "disabling publication with the wrong lock never builds" 'docker build' "$(calls)"
lacks "disabling publication with the wrong lock never allocates" 'host tag-list' "$(calls)"
done_testing
