#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host

if [ -f "$release_source/../../.github/workflows/release.yml" ]; then
    pipeline=$release_source/../../.github/workflows/promote.yml
    groupKey=group:
else
    pipeline=$release_source/../../.gitlab/promote.yml
    groupKey=resource_group:
fi
pipelineGroup() {
    awk -v key="$groupKey" '
        $1 == key {
            sub(/^[^:]*:[[:space:]]*/, "")
            if ($0 == "release") { found = 1; print; exit }
            if (first == "") first = $0
        }
        END { if (!found) print first }
    ' "$pipeline" |
        jq -Rr --arg environment "$1" 'split("${{ inputs.environment }}") | join($environment) | split("$[[ inputs.environment ]]") | join($environment) | split("$RELEASE_ENV") | join($environment)'
}
productionGroup=$(pipelineGroup production)
secondaryGroup=$(pipelineGroup secondary)
check "the pipeline declares a release queue" release "$productionGroup"
check "different environments share the allocation queue" "$productionGroup" "$secondaryGroup"

one=$(commit "chore: scaffold")
two=$(commit "feat: next release")
publish_main
first=$(sh "$release/version.sh" "$one")
second=
if [ "$productionGroup" != "$secondaryGroup" ]; then
    second=$(sh "$release/version.sh" "$two")
fi
sh "$RELEASE_HOST_ADAPTER" marker-write production "$one" "$first"
status=0
FAIL_TAG=1 sh "$release/publish.sh" production "$one" "$first" >"$tmp/publication.log" 2>&1 || status=$?
check "the first healthy promotion can have incomplete publication" 1 "$status"
check "the healthy record holds its assigned version" "$first" "$(sh "$RELEASE_HOST_ADAPTER" marker-list production | jq -r '.[0].version')"
if [ "$productionGroup" = "$secondaryGroup" ]; then
    second=$(sh "$release/version.sh" "$two")
fi
sh "$RELEASE_HOST_ADAPTER" marker-write secondary "$two" "$second"
sh "$release/publish.sh" secondary "$two" "$second" >"$tmp/publication.log" 2>&1
check "the next queued commit cannot take the held counter" 2026-10-12.2 "$second"
check "the first commit retains its held version after its peer publishes" "$first" "$(sh "$release/version.sh" "$one")"
status=0
sh "$release/publish.sh" production "$one" "$first" >"$tmp/publication.log" 2>&1 || status=$?
check "the first commit can retry its original publication" 0 "$status"
check "a held version is never published for another commit" "$one" "$(sh "$RELEASE_HOST_ADAPTER" tag-read "$first")"

three=$(commit "fix: next day release")
publish_main
beforeMidnight=$(RELEASE_NOW=1791849599 sh "$release/version.sh" "$three")
afterMidnight=
if [ "$productionGroup" != "$secondaryGroup" ]; then
    afterMidnight=$(RELEASE_NOW=1791849600 sh "$release/version.sh" "$three")
fi
sh "$RELEASE_HOST_ADAPTER" marker-write production "$three" "$beforeMidnight"
sh "$release/publish.sh" production "$three" "$beforeMidnight" >"$tmp/publication.log" 2>&1
if [ "$productionGroup" = "$secondaryGroup" ]; then
    afterMidnight=$(RELEASE_NOW=1791849600 sh "$release/version.sh" "$three")
fi
sh "$RELEASE_HOST_ADAPTER" marker-write secondary "$three" "$afterMidnight"
sh "$release/publish.sh" secondary "$three" "$afterMidnight" >"$tmp/publication.log" 2>&1
check "a queued promotion after midnight retains the first tag" "$beforeMidnight" "$afterMidnight"
check "one commit keeps exactly one tag across midnight" 1 "$(sh "$RELEASE_HOST_ADAPTER" tag-list | jq --arg sha "$three" '[.[] | select(.sha == $sha)] | length')"
done_testing
