#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host

older=$(commit "chore: scaffold")
base=$(commit "feat: released service")
main=$(commit "feat: later main work")
publish_main
git push -q origin "$base:refs/tags/2026-10-12.1"
first=$(printf 'fix: first repair\n' | git commit-tree "$base^{tree}" -p "$base")
second=$(printf 'fix: removed repair\n' | git commit-tree "$base^{tree}" -p "$first")
git push -q origin "$second:refs/heads/release/2026-10-12.1" "$first:refs/tags/2026-10-12.1.1" "$second:refs/tags/2026-10-12.1.2"
git fetch -q --tags origin

notes=$(sh "$release/notes.sh" "$second" "$first")
contains "an earlier hotfix uses rollback wording" "## Rollback to $(git rev-parse --short=8 "$first") from $(git rev-parse --short=8 "$second") (1 commits removed)" "$notes"
contains "hotfix rollback lists the removed repair" 'removed repair' "$notes"
contains "hotfix rollback lists the removed commit" "\`$(git rev-parse --short "$second")\`" "$notes"
lacks "hotfix rollback omits the retained repair" 'first repair' "$notes"
lacks "hotfix rollback does not claim a move" 'This promotion moves' "$notes"

for original in "$older" "$base"; do
    picked=$(printf 'fix: repair with an old hint\n\n(cherry picked from commit %s)\n' "$original" | git commit-tree "$base^{tree}" -p "$base")
    git push -q -f origin "$picked:refs/heads/release/2026-10-12.1"
    git fetch -q origin
    notes=$(sh "$release/notes.sh" "$base" "$picked")
    lacks "a hint at or before the base has no main hash" "main \`$(git rev-parse --short "$original")\`" "$notes"
    notes=$(sh "$release/notes.sh" "$picked" "$main")
    contains "a hint at or before the base requires confirmation" '(confirm on main)' "$notes"
    lacks "a hint at or before the base is not marked on main" '(on main)' "$notes"
done
done_testing
