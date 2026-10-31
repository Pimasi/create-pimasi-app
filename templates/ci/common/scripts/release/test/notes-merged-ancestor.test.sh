#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host

base=$(commit "feat: released service")
commit "feat: work on main" >/dev/null
publish_main
git push -q origin "$base:refs/tags/2026-10-12.1"
mergedHotfix=$(printf 'fix: repair returned to main\n' | git commit-tree "$base^{tree}" -p "$base")
liveHotfix=$(printf 'fix: repair still separate\n' | git commit-tree "$base^{tree}" -p "$mergedHotfix")
git push -q origin "$liveHotfix:refs/tags/2026-10-12.1.1"
git merge -q --no-ff -m 'fix: merge the first repair' "$mergedHotfix"
candidate=$(git rev-parse HEAD)
publish_main

notes=$(sh "$release/notes.sh" "$liveHotfix" "$candidate")
contains "main notes name the live hotfix" 'Hotfix 2026-10-12.1.1 was live' "$notes"
contains "the merged hotfix commit is confirmed on main" "- fix: repair returned to main \`$(git rev-parse --short "$mergedHotfix")\` (on main)" "$notes"
contains "an unmerged hotfix commit still needs confirmation" "- fix: repair still separate \`$(git rev-parse --short "$liveHotfix")\` (confirm on main)" "$notes"
done_testing
