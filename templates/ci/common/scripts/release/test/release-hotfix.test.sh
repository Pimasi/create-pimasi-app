#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools

base=$(commit "feat: released service")
publish_main
check "the base release succeeds" 0 "$(promote production "$base")"
check "the base release is the first version" 2026-10-12.1 "$(outcome version)"
git fetch -q origin
check "the pipeline created the release branch" "$base" "$(git rev-parse origin/release/2026-10-12.1)"

git worktree add --quiet -b feature "$tmp/feature" "$base"
feature=$(cd "$tmp/feature" && COMMIT_FILE=feature.txt commit "feat: merged feature")
git merge -q --no-ff -m 'feat: merge the feature' feature
publish_main

git worktree add --quiet --detach "$tmp/release" origin/release/2026-10-12.1
first=$(cd "$tmp/release" && COMMIT_FILE=first.txt commit "fix(api): first repair")
git -C "$tmp/release" push -q origin HEAD:refs/heads/release/2026-10-12.1
check "the first commit on the release branch deploys" 0 "$(promote production "$first")"
check "the first hotfix is version .1" 2026-10-12.1.1 "$(outcome version)"
check "the first hotfix is tagged" "$first" "$(git ls-remote --tags origin refs/tags/2026-10-12.1.1 | cut -f1)"
notes=$(cat "$RELEASE_OUT/notes.md")
contains "first hotfix notes name the released base" '## Hotfix of 2026-10-12.1 (1 commits)' "$notes"
contains "first hotfix notes group the fix" '### Fixes' "$notes"
contains "first hotfix notes keep the subject and hash" "- api: first repair \`$(git rev-parse --short "$first")\`" "$notes"
lacks "first hotfix notes omit main work" 'merged feature' "$notes"

second=$(cd "$tmp/release" && COMMIT_FILE=second.txt commit "fix: second repair")
git -C "$tmp/release" push -q origin HEAD:refs/heads/release/2026-10-12.1
check "the next commit on the release branch deploys" 0 "$(promote production "$second")"
check "the next hotfix is version .2" 2026-10-12.1.2 "$(outcome version)"
check "the hotfixes of one version form one line" "2026-10-12.1 $first $second" "$(sh "$release/hotfix.sh" "$second" | jq -r '[.base_tag, .commits[].sha] | join(" ")')"
notes=$(cat "$RELEASE_OUT/notes.md")
contains "next hotfix notes still name the released base" '## Hotfix of 2026-10-12.1 (1 commits)' "$notes"
contains "next hotfix notes list the new repair" 'second repair' "$notes"
lacks "next hotfix notes omit the deployed repair" 'first repair' "$notes"
check "the first hotfix tag never moves" "$first" "$(git ls-remote --tags origin refs/tags/2026-10-12.1.1 | cut -f1)"

refused() {
    : >"$STATE/calls"
    check "$1 is refused" 3 "$(promote production "$2")"
    check "$1 is rejected at admission" admit "$(outcome stage)"
    check "$1 leaves the live record" "$second" "$(cat "$STATE/marker-production")"
    lacks "$1 builds nothing" 'docker build' "$(calls)"
    lacks "$1 runs no gate" 'make ' "$(calls)"
}

refused 'a merged feature commit' "$feature"
contains "the merged feature refusal directs promotion of main" 'promote the main commit that contains it' "$(cat "$tmp/promote.log")"

side=$(printf 'fix: side repair\n' | git commit-tree "$base^{tree}" -p "$second")
joined=$(printf 'fix: join the side repair\n' | git commit-tree "$base^{tree}" -p "$second" -p "$side")
git push -q origin "$joined:refs/heads/release/2026-10-12.1"
refused 'a commit off the branch first-parent line' "$side"
contains "the off-line refusal names the release branch rule" 'first-parent line of a release/<version> branch' "$(cat "$tmp/promote.log")"
check "the merge on the release line itself deploys" 0 "$(promote production "$joined")"
check "the merge on the release line is the next hotfix" 2026-10-12.1.3 "$(outcome version)"
done_testing
