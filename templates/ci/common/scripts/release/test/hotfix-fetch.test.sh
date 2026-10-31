#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
cat >Makefile <<'MAKE'
release:
	@if git cat-file -e "$$RELEASE_SHA^{commit}" 2>/dev/null; then printf present; else printf absent; fi >"$$STATE/hotfix-object"
	@git rev-parse HEAD >"$$STATE/tooling-head"
MAKE
base=$(commit "chore: release tooling")
publish_main
git worktree add --quiet -b hotfix "$tmp/hotfix" "$base"
hotfix=$(printf 'fix: repair live service\n' | git -C "$tmp/hotfix" commit-tree "$base^{tree}" -p "$base")
git push --quiet origin "$hotfix:refs/heads/release/2026-10-12.1"
git clone --quiet --single-branch --branch main --no-tags "file://$tmp/remote.git" "$tmp/runner"
cd "$tmp/runner"
check "the runner initially lacks the branch object" absent "$(if git cat-file -e "$hotfix^{commit}" 2>/dev/null; then printf present; else printf absent; fi)"
status=0
CI_COMMIT_BRANCH=main RELEASE_SHA=$hotfix sh "$release/release-from-main.sh" >"$tmp/fetch.log" 2>&1 || status=$?
check "the GitLab helper succeeds for a main pipeline" 0 "$status"
check "the helper fetches the pushed release branch" present "$(cat "$STATE/hotfix-object")"
check "the helper still uses main tooling" "$base" "$(cat "$STATE/tooling-head")"
if [ -f "$release_source/../../.github/workflows/release.yml" ]; then
    contains "GitHub release fetches full history" 'fetch-depth: 0' "$(cat "$release_source/../../.github/workflows/promote.yml")"
else
    contains "GitLab release fetches full history" 'GIT_DEPTH: "0"' "$(cat "$release_source/../../.gitlab/promote.yml")"
fi
done_testing
