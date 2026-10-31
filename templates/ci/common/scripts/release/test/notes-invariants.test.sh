#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host

base=$(commit "feat: released service")
commit "feat: later main work" >/dev/null
publish_main
git push -q origin "$base:refs/tags/2026-10-12.1"
first=$(printf 'fix: first repair\n' | git commit-tree "$base^{tree}" -p "$base")
second=$(printf 'fix: second repair\n' | git commit-tree "$base^{tree}" -p "$first")
git push -q origin "$second:refs/heads/release/2026-10-12.1" "$first:refs/tags/2026-10-12.1.1"
git fetch -q --tags origin

notes=$(sh "$release/notes.sh" "$base" "$first")
contains "an ancestor baseline keeps hotfix wording" '## Hotfix of 2026-10-12.1 (1 commits)' "$notes"
lacks "an ancestor baseline does not claim a move" 'This promotion moves' "$notes"
notes=$(sh "$release/notes.sh" "$first" "$second")
contains "an ancestor hotfix baseline lists the new repair" 'second repair' "$notes"
lacks "an ancestor hotfix baseline does not claim a move" 'This promotion moves' "$notes"
lacks "an ancestor hotfix baseline omits the earlier repair" 'first repair' "$notes"
notes=$(sh "$release/notes.sh" "$first" "$first")
contains "a hotfix redeploy retains the redeploy heading" "## Redeploy of $(git rev-parse --short=8 "$first")" "$notes"
contains "a hotfix redeploy states that no code changed" 'Same commit as the current release. No code changes.' "$notes"
lacks "a hotfix redeploy does not claim a new hotfix" '## Hotfix of' "$notes"
done_testing
