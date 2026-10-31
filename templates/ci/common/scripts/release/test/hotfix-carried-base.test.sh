#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools

first=$(commit "feat: first release")
publish_main
check "the first release succeeds" 0 "$(promote production "$first")"
second=$(COMMIT_FILE=second.txt commit "feat: second release")
publish_main
check "the second release succeeds" 0 "$(promote production "$second")"
firstFix=$(printf 'fix: repair the first release\n' | git commit-tree "$first^{tree}" -p "$first")
secondFix=$(printf 'fix: repair the second release\n' | git commit-tree "$second^{tree}" -p "$second")
side=$(printf 'fix: unreleased side commit\n' | git commit-tree "$first^{tree}" -p "$first")
git push -q origin "$firstFix:refs/heads/release/2026-10-12.1" "$secondFix:refs/heads/release/2026-10-12.2"
git push -q origin :refs/heads/release/2026-10-12.2

inspect() {
    RELEASE_HOTFIX_SHA=$secondFix RELEASE_HOTFIX_BASE=$second RELEASE_HOTFIX_TAG=2026-10-12.2 sh "$release/hotfix.sh" "$1" --historical
}
check "the candidate takes the carried base after its branch is deleted" 2026-10-12.2 "$(inspect "$secondFix" | jq -r .base_tag)"
check "another hotfix keeps its own base while a base is carried" 2026-10-12.1 "$(inspect "$firstFix" | jq -r .base_tag)"
check "another hotfix keeps its own base commit while a base is carried" "$first" "$(inspect "$firstFix" | jq -r .base_sha)"
status=0
inspect "$side" >/dev/null 2>&1 || status=$?
check "a commit that is no hotfix gains no carried base" 3 "$status"
git push -q origin "$secondFix:refs/heads/release/2026-10-12.2"

printf 'RELEASE_PUBLISH=false\nRELEASE_HEALTH_URL=\n' >"$release/environments/dev.env"
again=$(printf 'fix: repair the first release again\n' | git commit-tree "$first^{tree}" -p "$firstFix")
git push -q origin "$again:refs/heads/release/2026-10-12.1"
check "dev runs the first fix" 0 "$(promote dev "$firstFix")"
check "dev runs the next fix on that line" 0 "$(promote dev "$again")"
git push -q -f origin "$firstFix:refs/heads/release/2026-10-12.1"
check "dev returns to the first fix after its line is rewritten" 0 "$(promote dev "$firstFix")"
check "the return to the first fix is a rollback" rollback "$(outcome mode)"
lacks "a live commit rewritten off its line is not named a hotfix" 'also removes hotfix' "$(cat "$RELEASE_OUT/notes.md")"

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
upper=$(printf '%s' "$secondFix" | tr '[:lower:]' '[:upper:]')
printf ':refs/heads/release/2026-10-12.2\n' >"$STATE/lose-branch"
check "an upper-case hotfix SHA whose branch is deleted after admission succeeds" 0 "$(promote production "$upper")"
check "the branch was deleted during the run" '' "$(git ls-remote --heads origin refs/heads/release/2026-10-12.2 | cut -f1)"
check "the promotion records the lower-case SHA" "$secondFix" "$(outcome sha)"
check "the upper-case request completes publication" succeeded "$(outcome outcome)"
check "the upper-case request keeps its hotfix version" 2026-10-12.2.1 "$(outcome version)"
contains "the published notes keep the carried hotfix base" '## Hotfix of 2026-10-12.2 (1 commits)' "$(cat "$STATE/release-2026-10-12.2.1.md" 2>/dev/null || true)"
done_testing
