#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
unset GITHUB_EVENT_NAME GITHUB_REF GITHUB_SHA CI_PIPELINE_SOURCE CI_COMMIT_BRANCH CI_COMMIT_SHA GITHUB_STEP_SUMMARY
cat >Makefile <<'MAKE'
release:
	@printf '%s\n' "$$(git rev-parse HEAD)" >"$$STATE/tooling-head"
	@printf '%s\n' "$$RELEASE_SHA" >"$$STATE/promoted-sha"
	@printf '%s\n' "$${RELEASE_TOOLS-unset}" >"$$STATE/release-tools"
	@printf '%s\n' "$$RELEASE_OUT" >"$$STATE/output-path"
	@if [ "$${WRITE_CORE_OUTCOME:-}" = yes ]; then cp "$$STATE/core-outcome.env" "$$RELEASE_OUT/outcome.env"; cp "$$STATE/core-summary.md" "$$RELEASE_OUT/summary.md"; fi
	@exit "$${HELPER_EXIT:-0}"
MAKE
old=$(commit "chore: add release tooling")
publish_main
git worktree add --quiet --detach "$tmp/queued" "$old"
git clone --quiet "$tmp/remote.git" "$tmp/writer"
cd "$tmp/writer"
git config user.name "Release Test"
git config user.email "release-test@example.invalid"
git config commit.gpgsign false
head=$(commit "fix: use the newest release tooling")
git push --quiet origin main
cd "$tmp/queued"

status=0
CI_COMMIT_BRANCH=topic sh "$release/release-from-main.sh" >"$tmp/helper.log" 2>&1 || status=$?
check "a release started away from main is refused" "3" "$status"
check "a non-main release records a rejected outcome" "rejected" "$(outcome outcome)"
check "a non-main release records the admission stage" "admit" "$(outcome stage)"
check "a refused helper creates no tooling worktree" "no" "$(if [ -e "$RELEASE_OUT/tooling" ]; then printf yes; else printf no; fi)"
RELEASE_SHA=$old
RELEASE_TOOLS=$tmp/outdated-tools
export RELEASE_SHA RELEASE_TOOLS
CI_COMMIT_BRANCH=main sh "$release/release-from-main.sh" >"$tmp/helper.log" 2>&1
check "a queued run fetches and uses the tip of main tooling" "$head" "$(cat "$STATE/tooling-head")"
check "tip tooling preserves the promoted application SHA" "$old" "$(cat "$STATE/promoted-sha")"
check "old tooling overrides are cleared" "unset" "$(cat "$STATE/release-tools")"
check "the outcome path stays with the caller" "$RELEASE_OUT" "$(cat "$STATE/output-path")"
check "a successful helper removes its tooling worktree" "no" "$(if [ -e "$RELEASE_OUT/tooling" ]; then printf yes; else printf no; fi)"
status=0
CI_COMMIT_BRANCH=main HELPER_EXIT=7 sh "$release/release-from-main.sh" >"$tmp/helper.log" 2>&1 || status=$?
check "a failed promotion makes the helper fail" "2" "$status"
check "a failed helper removes its tooling worktree" "no" "$(if [ -e "$RELEASE_OUT/tooling" ]; then printf yes; else printf no; fi)"
unset RELEASE_TOOLS

output=$(sh "$release/preview-main.sh")
check "manual pipelines do not print merge previews" "" "$output"
output=$(GITHUB_EVENT_NAME=pull_request GITHUB_REF=refs/heads/main GITHUB_SHA=$head sh "$release/preview-main.sh")
check "pull requests do not print merge previews" "" "$output"
output=$(GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/topic GITHUB_SHA=$head sh "$release/preview-main.sh")
check "GitHub topic pushes do not print merge previews" "" "$output"
output=$(GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/main GITHUB_SHA=$head sh "$release/preview-main.sh")
contains "GitHub main pushes print the promotion command" "Promote with commit $head" "$output"
contains "GitHub main previews include pending notes" "No trusted previous release" "$output"
output=$(CI_PIPELINE_SOURCE=push CI_COMMIT_BRANCH=topic CI_COMMIT_SHA=$head sh "$release/preview-main.sh")
check "GitLab topic pushes do not print merge previews" "" "$output"
output=$(CI_PIPELINE_SOURCE=push CI_COMMIT_BRANCH=main CI_COMMIT_SHA=$head sh "$release/preview-main.sh")
contains "GitLab main pushes print the promotion command" "Promote with commit $head" "$output"
check "both hosts show pending changes" "true" "$(printf '%s' "$output" | grep -q 'Waiting for production: 2 pending changes.' && printf true)"

REAL_GIT=$(command -v git)
export REAL_GIT
cat >"$tmp/bin/git" <<'GIT'
#!/bin/sh
case "${HELPER_GIT_FAILURE:-}:$1:${2:-}" in
    fetch:fetch:origin) exit 17 ;;
    worktree:worktree:add) : >"$STATE/tooling-add-failed"; exit 18 ;;
    *:worktree:remove) [ ! -f "$STATE/tooling-add-failed" ] || printf 'worktree removed\n' >>"$STATE/tooling-cleanups" ;;
esac
exec "$REAL_GIT" "$@"
GIT
chmod +x "$tmp/bin/git"

for failure in fetch worktree; do
    printf "outcome='succeeded'\nstage='done'\nenvironment='old'\nsha='old'\nversion='old'\nmode='same'\n" >"$RELEASE_OUT/outcome.env"
    printf 'Old successful summary\n' >"$RELEASE_OUT/summary.md"
    printf 'Old successful notes\n' >"$RELEASE_OUT/notes.md"
    rm -f "$STATE/tooling-head" "$STATE/tooling-cleanups" "$STATE/tooling-add-failed"
    status=0
    RELEASE_ENV=production CI_COMMIT_BRANCH=main HELPER_GIT_FAILURE=$failure sh "$release/release-from-main.sh" >"$tmp/helper.log" 2>&1 || status=$?
    expected=17
    [ "$failure" != worktree ] || expected=18
    check "$failure failure preserves the command status" "$expected" "$status"
    check "$failure failure records a failed outcome" "failed" "$(outcome outcome)"
    check "$failure failure identifies the tooling stage" "tooling" "$(outcome stage)"
    check "$failure failure records the requested SHA" "$old" "$(outcome sha)"
    contains "$failure failure renders the outcome summary" "failed at tooling" "$(cat "$RELEASE_OUT/summary.md")"
    lacks "$failure failure drops stale notes" "Old successful notes" "$(cat "$RELEASE_OUT/summary.md")"
    check "$failure failure never starts the app promotion" "no" "$(if [ -e "$STATE/tooling-head" ]; then printf yes; else printf no; fi)"
    check "$failure failure does not remove a worktree it never created" "no" "$(if [ -e "$STATE/tooling-cleanups" ]; then printf yes; else printf no; fi)"
done

unsafeEnvironment=$(printf 'production\047$(touch %s/helper-owned) "quoted"' "$tmp")
unsafeSha=$(printf '$(touch %s/helper-sha-owned)' "$tmp")
status=0
RELEASE_ENV=$unsafeEnvironment RELEASE_SHA=$unsafeSha CI_COMMIT_BRANCH=main HELPER_GIT_FAILURE=fetch sh "$release/release-from-main.sh" >"$tmp/helper.log" 2>&1 || status=$?
check "a failed helper preserves quoted environment input as data" "$unsafeEnvironment" "$(outcome environment)"
check "a failed helper preserves SHA input as data" "$unsafeSha" "$(outcome sha)"
check "helper outcome values cannot execute commands" "no" "$(if [ -e "$tmp/helper-owned" ] || [ -e "$tmp/helper-sha-owned" ]; then printf yes; else printf no; fi)"

printf "outcome='failed'\nstage='health'\nenvironment='production'\nsha='%s'\nversion='0.1.0'\nmode='same'\n" "$old" >"$STATE/core-outcome.env"
printf 'Core health failure summary\n' >"$STATE/core-summary.md"
status=0
RELEASE_ENV=production CI_COMMIT_BRANCH=main WRITE_CORE_OUTCOME=yes HELPER_EXIT=7 sh "$release/release-from-main.sh" >"$tmp/helper.log" 2>&1 || status=$?
check "a core failure preserves make's status" "2" "$status"
check "the helper preserves the core outcome" "$(cat "$STATE/core-outcome.env")" "$(cat "$RELEASE_OUT/outcome.env")"
check "the helper preserves the core summary" "$(cat "$STATE/core-summary.md")" "$(cat "$RELEASE_OUT/summary.md")"
check "core failure still removes the created tooling worktree" "no" "$(if [ -e "$RELEASE_OUT/tooling" ]; then printf yes; else printf no; fi)"

git worktree add --quiet --detach "$RELEASE_OUT/tooling" "$head"
rm -rf "$RELEASE_OUT/tooling"
status=0
CI_COMMIT_BRANCH=main sh "$release/release-from-main.sh" >"$tmp/helper.log" 2>&1 || status=$?
check "a missing registered tooling worktree is recovered" 0 "$status"
check "recovery uses the current main tooling" "$head" "$(cat "$STATE/tooling-head")"

done_testing
