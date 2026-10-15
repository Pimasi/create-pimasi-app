#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host

base=$(commit "feat: released service")
commit "feat: work on main" >/dev/null
publish_main
git push -q origin "$base:refs/tags/2026-10-12.1"
candidate=$(printf 'fix: repair without a branch\n' | git commit-tree "$base^{tree}" -p "$base")
unset RELEASE_CANDIDATE_KIND
notes=$(sh "$release/notes.sh" "$base" "$candidate")
contains "standalone notes retain the ordinary range" "## Changes $(git rev-parse --short=8 "$base")..$(git rev-parse --short=8 "$candidate") (1 commits)" "$notes"
contains "standalone notes retain the candidate change" 'repair without a branch' "$notes"
lacks "standalone notes do not invent hotfix admission" '## Hotfix of' "$notes"
done_testing
