#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools

base=$(commit "feat: released service")
main=$(COMMIT_FILE=main.txt commit "feat: work on main")
publish_main
check "the base release succeeds" 0 "$(promote production "$base")"
first=$(printf 'fix: repair the live service\n' | git commit-tree "$base^{tree}" -p "$base")
second=$(printf 'fix: an independent repair\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q origin "$first:refs/heads/release/2026-10-12.1"
git fetch -q origin
check "a new hotfix without a trailer is admitted" 0 "$(promote production "$first")"
check "the first branch receives patch one" 2026-10-12.1.1 "$(outcome version)"
check "the new hotfix is recorded" "$first" "$(cat "$STATE/marker-production")"
check "the new hotfix is tagged" "$first" "$(sh "$RELEASE_HOST_ADAPTER" tag-read 2026-10-12.1.1)"
git push -q -f origin "$second:refs/heads/release/2026-10-12.1"
check "a rewritten release line admits an unrelated repair" 0 "$(promote production "$second")"
check "the rewritten line receives patch two" 2026-10-12.1.2 "$(outcome version)"
contains "a promotion from another line names its environment and versions" 'moves production from 2026-10-12.1.1 to hotfix 2026-10-12.1.2' "$(cat "$RELEASE_OUT/notes.md")"
contains "a promotion from another line lists its own commits" 'an independent repair' "$(cat "$RELEASE_OUT/notes.md")"
lacks "a promotion from another line omits the previous line" 'repair the live service' "$(cat "$RELEASE_OUT/notes.md")"
check "main can replace an unpicked hotfix" 0 "$(promote production "$main")"
contains "returning to main names the live hotfix" '### Hotfix 2026-10-12.1.2 was live' "$(cat "$RELEASE_OUT/notes.md")"
contains "a fix without a trailer asks the team to confirm it" 'an independent repair' "$(cat "$RELEASE_OUT/notes.md")"
contains "a fix without a trailer is informational" 'confirm on main' "$(cat "$RELEASE_OUT/notes.md")"
check "a hotfix of an older release remains deployable" 0 "$(promote production "$first")"
contains "moving back from main is explicit" 'moves production from 2026-10-12.2 to hotfix 2026-10-12.1.1' "$(cat "$RELEASE_OUT/notes.md")"
git push -q origin :refs/heads/release/2026-10-12.1
git update-ref -d refs/remotes/origin/release/2026-10-12.1
check "a tagged hotfix survives deletion of its branch" 0 "$(promote production "$first")"

foreign=$(printf 'fix: ordinary feature branch\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q origin "$foreign:refs/heads/feature/repair"
git fetch -q origin
check "an untagged branch outside the prefix is refused" 3 "$(promote production "$foreign")"
contains "the branch refusal explains the configured prefix" 'release/<version>' "$(cat "$tmp/promote.log")"
printf 'RELEASE_BRANCH_PREFIX=feature/\n' >>"$release/config.sh"
git push -q origin "$foreign:refs/heads/feature/2026-10-12.1"
check "the configured prefix admits the matching remote branch" 0 "$(promote production "$foreign")"
check "a third branch takes the next available counter" 2026-10-12.1.3 "$(outcome version)"

missing=1111111111111111111111111111111111111111
jq -n --arg sha "$missing" '[{id: 50, sha: $sha, status: "success", version: "2026-10-12.1.8"}]' >"$STATE/records-removed.json"
check "an absent historical hotfix cannot block admission" 0 "$(promote production "$foreign")"
next=$(printf 'fix: another independent repair\n' | git commit-tree "$base^{tree}" -p "$foreign")
git push -q origin "$next:refs/heads/feature/2026-10-12.1"
git fetch -q origin
check "missing historical records still reserve their patch counter" 2026-10-12.1.9 "$(sh "$release/version.sh" "$next")"
done_testing
