#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools

base=$(commit "feat: released service")
main=$(COMMIT_FILE=main.txt commit "feat: work on main")
publish_main
check "the base release succeeds" 0 "$(promote production "$base")"
hotfix=$(printf 'fix: branch deleted during promotion\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q origin "$hotfix:refs/heads/release/2026-10-12.1"
mv "$RELEASE_HOST_ADAPTER" "$tmp/original-host.sh"
cat >"$RELEASE_HOST_ADAPTER" <<'HOST'
#!/bin/sh
set -eu
if [ "$1" = marker-read ] && [ ! -f "$STATE/branch-deleted" ]; then
    git push -q origin :refs/heads/release/2026-10-12.1
    : >"$STATE/branch-deleted"
fi
exec sh "$(dirname -- "$0")/original-host.sh" "$@"
HOST
: >"$STATE/calls"
check "deleting the release branch after admission keeps the promotion" 0 "$(promote production "$hotfix")"
check "the deleted branch keeps the promotion to the end" 'done' "$(outcome stage)"
check "the admitted hotfix never receives a normal version" 2026-10-12.1.1 "$(outcome version)"
contains "the notes keep the base found at admission" '## Hotfix of 2026-10-12.1 (1 commits)' "$(cat "$RELEASE_OUT/notes.md")"
check "the release branch was deleted before the version was assigned" '' "$(git ls-remote --heads origin refs/heads/release/2026-10-12.1 | cut -f1)"
check "the admitted hotfix receives its hotfix tag" 2026-10-12.1.1 "$(sh "$RELEASE_HOST_ADAPTER" tag-list | jq -r --arg sha "$hotfix" '.[] | select(.sha == $sha) | .tag')"
check "the admitted hotfix becomes the live record" "$hotfix" "$(cat "$STATE/marker-production")"
check "normal admission remains a normal version" 0 "$(promote production "$main")"
check "normal admission assigns the next daily version" 2026-10-12.2 "$(outcome version)"
mv "$tmp/original-host.sh" "$RELEASE_HOST_ADAPTER"

uatHotfix=$(printf 'fix: unfetched uat repair\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q origin "$uatHotfix:refs/heads/unfetched"
git push -q origin :refs/heads/unfetched
printf 'RELEASE_PUBLISH=false\n' >"$release/environments/uat.env"
printf 'RELEASE_AFTER=uat\n' >>"$release/environments/production.env"
printf '%s\n' "$uatHotfix" >"$STATE/marker-uat"
git clone -q --single-branch --branch main "file://$tmp/remote.git" "$tmp/runner"
cd "$tmp/runner"
git config user.name 'Release Test'
git config user.email release-test@example.invalid
check "the uat live object is initially absent" no "$(if git cat-file -e "$uatHotfix^{commit}" 2>/dev/null; then printf yes; else printf no; fi)"
status=0
sh "$release/admit.sh" production "$base" >"$tmp/admit-output" 2>"$tmp/admit-error" || status=$?
check "admission fetches uat before judging a base redeploy" 0 "$status"
check "admission remains silent by default" '' "$(cat "$tmp/admit-output")"
check "the prerequisite live commit was fetched" yes "$(if git cat-file -e "$uatHotfix^{commit}" 2>/dev/null; then printf yes; else printf no; fi)"
missing=2222222222222222222222222222222222222222
printf '%s\n' "$missing" >"$STATE/marker-uat"
status=0
sh "$release/admit.sh" production "$base" >"$tmp/admit-output" 2>"$tmp/admit-error" || status=$?
check "an unavailable prerequisite still refuses promotion" 3 "$status"
contains "the refusal names the unavailable prerequisite commit" "could not fetch live commit $missing for prerequisite environment uat from origin" "$(cat "$tmp/admit-error")"
lacks "an unavailable prerequisite is not reported as an ancestry decision" 'ahead of or unrelated to' "$(cat "$tmp/admit-error")"
done_testing
