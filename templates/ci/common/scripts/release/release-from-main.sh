#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

initialise_output
tooling=$out/tooling
toolingCreated=false
stage=admit
finish() {
    status=$?
    trap - 0 INT TERM
    if [ "$status" -ne 0 ] && [ ! -f "$out/outcome.env" ]; then
        outcome=failed
        if [ "$stage" = admit ] && [ "$status" -eq 3 ]; then
            outcome=rejected
        fi
        jq -nr --arg outcome "$outcome" --arg stage "$stage" \
            --arg environment "${RELEASE_ENV:-}" --arg sha "${RELEASE_SHA:-}" '
            ($ARGS.named + {version: "", mode: "", base: "", health_url: ""}) |
            to_entries[] | .key + "=" + (.value | @sh)
        ' >"$out/outcome.env"
        sh "$here/notify.sh" || say "warning: the release summary failed"
    fi
    if [ "$toolingCreated" = true ]; then
        git worktree remove --force "$tooling" || say "warning: could not remove the tooling worktree"
    fi
    exit "$status"
}
trap finish 0
trap 'exit 130' INT
trap 'exit 143' TERM
rm -f "$out/outcome.env" "$out/summary.md"
: >"$out/notes.md"
[ "${CI_COMMIT_BRANCH:-}" = "$RELEASE_MAIN" ] || die "start the release pipeline from $RELEASE_MAIN" 3
stage=tooling
git fetch origin --tags '+refs/heads/*:refs/remotes/origin/*'
git worktree remove --force "$tooling" 2>/dev/null || true
git worktree add --quiet --detach "$tooling" "origin/$RELEASE_MAIN"
toolingCreated=true
RELEASE_OUT=$out
export RELEASE_OUT
unset RELEASE_TOOLS
make -C "$tooling" release
