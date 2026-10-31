#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
cat >Makefile <<'MAKE'
release:
	@git rev-parse HEAD >"$$STATE/tooling-head"
MAKE
one=$(commit "chore: release tooling")
publish_main
mkdir -p "$tmp/physical/out"
ln -s "$tmp/physical" "$tmp/linked"
RELEASE_OUT=$tmp/linked/out
export RELEASE_OUT
git worktree add --quiet --detach "$tmp/physical/out/tooling" "$one"
contains "the stale tooling worktree uses its physical path" "worktree $tmp/physical/out/tooling" "$(git worktree list --porcelain)"
status=0
CI_COMMIT_BRANCH=main RELEASE_SHA=$one sh "$release/release-from-main.sh" >"$tmp/tooling.log" 2>&1 || status=$?
check "a symlinked output path replaces the stale tooling worktree" 0 "$status"
check "the replacement runs current main tooling" "$one" "$(cat "$STATE/tooling-head" 2>/dev/null || true)"
lacks "the tooling worktree is unregistered after the run" "worktree $tmp/physical/out/tooling" "$(git worktree list --porcelain)"
done_testing
