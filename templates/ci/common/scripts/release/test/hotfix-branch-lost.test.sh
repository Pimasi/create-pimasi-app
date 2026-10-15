#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools

base=$(commit "feat: released service")
later=$(COMMIT_FILE=later.txt commit "feat: later release")
publish_main
check "the base release succeeds" 0 "$(promote production "$base")"
check "the later release succeeds" 0 "$(promote production "$later")"
mv "$RELEASE_HOST_ADAPTER" "$tmp/original-host.sh"
cat >"$RELEASE_HOST_ADAPTER" <<'HOST'
#!/bin/sh
set -eu
if [ "$1" = marker-write ] && [ -f "$STATE/lose-branch" ]; then
    git push -q -f origin "$(cat "$STATE/lose-branch")"
    rm -f "$STATE/lose-branch"
fi
exec sh "$(dirname -- "$0")/original-host.sh" "$@"
HOST

branch() {
    git ls-remote --heads origin refs/heads/release/2026-10-12.1 | cut -f1
}

hotfix=$(printf 'fix: repair the first release\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q origin "$hotfix:refs/heads/release/2026-10-12.1"
printf ':refs/heads/release/2026-10-12.1\n' >"$STATE/lose-branch"
check "a hotfix whose branch is deleted after admission succeeds" 0 "$(promote production "$hotfix")"
check "the branch was deleted during the run" '' "$(branch)"
check "the deleted-branch hotfix completes publication" succeeded "$(outcome outcome)"
check "the deleted-branch hotfix keeps its hotfix version" 2026-10-12.1.1 "$(outcome version)"
check "the deleted-branch hotfix is tagged at its commit" "$hotfix" "$(git ls-remote --tags origin refs/tags/2026-10-12.1.1 | cut -f1)"
published=$(cat "$STATE/release-2026-10-12.1.1.md" 2>/dev/null || true)
contains "the published notes keep the hotfix base after deletion" '## Hotfix of 2026-10-12.1 (1 commits)' "$published"
contains "the published notes say what the hotfix replaces after deletion" 'This promotion moves production from 2026-10-12.2 to hotfix 2026-10-12.1.1.' "$published"
lacks "the published notes never fall back to a normal release after deletion" '## Release of' "$published"
contains "the summary notes keep the hotfix base after deletion" '## Hotfix of 2026-10-12.1 (1 commits)' "$(cat "$RELEASE_OUT/notes.md")"

second=$(printf 'fix: repair the first release again\n' | git commit-tree "$base^{tree}" -p "$hotfix")
other=$(printf 'fix: rewritten release line\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q origin "$second:refs/heads/release/2026-10-12.1"
printf '%s:refs/heads/release/2026-10-12.1\n' "$other" >"$STATE/lose-branch"
check "a hotfix whose branch is rewritten after admission succeeds" 0 "$(promote production "$second")"
check "the branch was rewritten off the hotfix during the run" "$other" "$(branch)"
check "the rewritten-branch hotfix completes publication" succeeded "$(outcome outcome)"
check "the rewritten-branch hotfix keeps its hotfix version" 2026-10-12.1.2 "$(outcome version)"
published=$(cat "$STATE/release-2026-10-12.1.2.md" 2>/dev/null || true)
contains "the published notes keep the hotfix base after a rewrite" '## Hotfix of 2026-10-12.1 (1 commits)' "$published"
contains "the published notes list the repair after a rewrite" 'repair the first release again' "$published"
lacks "the published notes never fall back to a normal range after a rewrite" '## Changes' "$published"

third=$(printf 'fix: repair published on retry\n' | git commit-tree "$base^{tree}" -p "$second")
git push -q -f origin "$third:refs/heads/release/2026-10-12.1"
printf ':refs/heads/release/2026-10-12.1\n' >"$STATE/lose-branch"
check "a refused release object after the branch is deleted keeps the deployment" 0 "$(FAIL_PUBLISH=1 promote production "$third")"
check "the refused release object leaves publication incomplete" 'succeeded, publication incomplete' "$(outcome outcome)"
check "the refused release object still tags the hotfix" "$third" "$(git ls-remote --tags origin refs/tags/2026-10-12.1.3 | cut -f1)"
check "a retry of the tagged hotfix without its branch succeeds" 0 "$(promote production "$third")"
check "the retry completes publication" succeeded "$(outcome outcome)"
check "the retry keeps the hotfix version" 2026-10-12.1.3 "$(outcome version)"
contains "the retry finds the hotfix base through its tag" '## Hotfix of 2026-10-12.1 (1 commits)' "$(cat "$STATE/release-2026-10-12.1.3.md" 2>/dev/null || true)"

fourth=$(printf 'fix: repair whose tag is refused\n' | git commit-tree "$base^{tree}" -p "$third")
git push -q origin "$fourth:refs/heads/release/2026-10-12.1"
printf ':refs/heads/release/2026-10-12.1\n' >"$STATE/lose-branch"
check "a refused tag after the branch is deleted keeps the deployment" 0 "$(FAIL_TAG=1 promote production "$fourth")"
check "the refused tag leaves publication incomplete" 'succeeded, publication incomplete' "$(outcome outcome)"
: >"$STATE/calls"
check "a retry of the untagged hotfix without its branch is refused" 3 "$(promote production "$fourth")"
check "the untagged retry stops at admission" admit "$(outcome stage)"
lacks "the untagged retry builds nothing" 'docker build' "$(calls)"
lacks "the untagged retry runs no gate" 'make ' "$(calls)"

status=0
RELEASE_CANDIDATE_KIND=hotfix sh "$release/notes.sh" "$third" "$fourth" >"$tmp/lost-notes.md" 2>"$tmp/lost-notes.log" || status=$?
check "notes for a hotfix whose base cannot be found fail" 1 "$status"
lacks "notes for a hotfix whose base cannot be found never read as a normal range" '## Changes' "$(cat "$tmp/lost-notes.md")"
contains "the notes failure names the hotfix" "could not inspect hotfix $fourth" "$(cat "$tmp/lost-notes.log")"
done_testing
