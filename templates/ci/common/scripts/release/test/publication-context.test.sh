#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host

base=$(commit "feat: released service")
commit "feat: later main work" >/dev/null
publish_main
git push -q origin "$base:refs/tags/2026-10-12.1"
first=$(printf 'fix: first repair\n' | git commit-tree "$base^{tree}" -p "$base")
second=$(printf 'fix: independent repair\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q origin "$second:refs/heads/release/2026-10-12.1" "$first:refs/tags/2026-10-12.1.1"
git fetch -q --tags origin
jq -n --arg first "$first" --arg second "$second" '[{id: 2, sha: $second, status: "success", version: ""}, {id: 1, sha: $first, status: "success", version: ""}]' >"$STATE/records-production.json"

status=0
RELEASE_ENV=dev RELEASE_VERSION=wrong-version sh "$release/publish.sh" production "$second" 2026-10-12.1.2 >"$tmp/publish.log" 2>&1 || status=$?
check "publication succeeds without record-held versions" 0 "$status"
notes=$(cat "$STATE/release-2026-10-12.1.2.md" 2>/dev/null || true)
contains "publication uses its environment in move wording" 'moves production from 2026-10-12.1.1' "$notes"
contains "publication uses its assigned version in move wording" 'to hotfix 2026-10-12.1.2.' "$notes"
lacks "publication does not inherit another environment" 'moves dev' "$notes"
lacks "publication does not inherit another version" 'wrong-version' "$notes"
done_testing
