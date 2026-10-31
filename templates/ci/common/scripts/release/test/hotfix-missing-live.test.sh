#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools

base=$(commit "feat: released service")
candidate=$(COMMIT_FILE=main.txt commit "feat: next release")
publish_main
git push -q origin "$base:refs/tags/2026-10-12.1"
live=$(printf 'fix: untagged repair\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q origin "$live:refs/heads/release/2026-10-12.1"
git push -q origin :refs/heads/release/2026-10-12.1
printf '%s\n' "$live" >"$STATE/marker-production"
jq -n --arg sha "$live" '[{id: 1, sha: $sha, status: "success", version: "2026-10-12.1.1"}]' >"$STATE/records-production.json"
git clone -q --single-branch --branch main "file://$tmp/remote.git" "$tmp/runner"
cd "$tmp/runner"
git config user.name "Release Test"
git config user.email "release-test@example.invalid"
check "the live object is initially absent" no "$(if git cat-file -e "$live^{commit}" 2>/dev/null; then printf yes; else printf no; fi)"
check "main can follow a deleted untagged release branch" 0 "$(promote production "$candidate")"
check "the missing live commit is fetched by SHA" yes "$(if git cat-file -e "$live^{commit}" 2>/dev/null; then printf yes; else printf no; fi)"
contains "an untagged commit whose release branch is gone has no trusted baseline" 'No trusted previous release' "$(cat "$RELEASE_OUT/notes.md")"
lacks "an untagged commit whose release branch is gone is not named as a hotfix" 'was live' "$(cat "$RELEASE_OUT/notes.md")"

kept=$(printf 'fix: kept repair\n' | git -C "$tmp/repo" commit-tree "$base^{tree}" -p "$base")
git -C "$tmp/repo" push -q origin "$kept:refs/heads/release/2026-10-12.1"
printf '%s\n' "$kept" >"$STATE/marker-production"
jq -n --arg sha "$kept" '[{id: 2, sha: $sha, status: "success", version: "2026-10-12.1.1"}]' >"$STATE/records-production.json"
check "the kept live object is initially absent" no "$(if git cat-file -e "$kept^{commit}" 2>/dev/null; then printf yes; else printf no; fi)"
check "main can follow an unfetched live hotfix" 0 "$(promote production "$candidate")"
check "the kept live commit is fetched by SHA" yes "$(if git cat-file -e "$kept^{commit}" 2>/dev/null; then printf yes; else printf no; fi)"
contains "the fetched live hotfix contributes its reminder" 'Hotfix 2026-10-12.1.1 was live' "$(cat "$RELEASE_OUT/notes.md")"
contains "the fetched live hotfix keeps its subject" 'kept repair' "$(cat "$RELEASE_OUT/notes.md")"

missing=2222222222222222222222222222222222222222
printf '%s\n' "$missing" >"$STATE/marker-production"
check "an unavailable live SHA does not prevent main promotion" 0 "$(promote production "$candidate")"
contains "an unavailable live SHA is disclosed" "Previous live commit $missing is unavailable" "$(cat "$RELEASE_OUT/notes.md")"
contains "an unavailable live SHA has an unknown baseline" 'baseline is unknown' "$(cat "$RELEASE_OUT/notes.md")"
next=$(printf 'fix: independent later repair\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q -f origin "$next:refs/heads/release/2026-10-12.1"
git fetch -q origin refs/heads/release/2026-10-12.1:refs/remotes/origin/release/2026-10-12.1
printf '%s\n' "$missing" >"$STATE/marker-production"
check "an unavailable live SHA does not prevent hotfix promotion" 0 "$(promote production "$next")"
contains "an unknown hotfix baseline is disclosed" 'baseline is unknown' "$(cat "$RELEASE_OUT/notes.md")"
contains "an unknown hotfix baseline lists the branch from its release" 'independent later repair' "$(cat "$RELEASE_OUT/notes.md")"
done_testing
