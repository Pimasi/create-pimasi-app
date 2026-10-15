#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
unset RELEASE_HOST_ADAPTER RELEASE_TOKEN
sandbox
one=$(commit "feat: first")
two=$(commit "feat: second")
publish_main
CI_JOB_TOKEN=job-token-never-in-arguments
export CI_JOB_TOKEN
realGit=$(command -v git)
cat >"$tmp/bin/git" <<GIT
#!/bin/sh
printf 'git %s\n' "\$*" >>"\$STATE/git-arguments"
if [ "\$1" = ls-remote ] && [ -f "\$STATE/hide-branches-once" ]; then
    rm -f "\$STATE/hide-branches-once"
    exit 0
fi
exec "$realGit" "\$@"
GIT
chmod +x "$tmp/bin/git"
cat >"$tmp/remote.git/hooks/pre-receive" <<'HOOK'
#!/bin/sh
while read -r old new ref; do
    printf '%s %s %s\n' "$ref" "$new" "${GIT_PUSH_OPTION_COUNT:-0}:${GIT_PUSH_OPTION_0:-}" >>"$STATE/received"
done
[ ! -f "$STATE/refuse-push" ]
HOOK
chmod +x "$tmp/remote.git/hooks/pre-receive"
: >"$STATE/received"
statusOf() {
    result=0
    "$@" >"$tmp/result" 2>"$tmp/error" || result=$?
    printf '%s' "$result"
}
host() {
    sh "$release/host.sh" "$@"
}
remoteBranch() {
    "$realGit" ls-remote --heads origin "refs/heads/$1" | cut -f1
}

check "an absent branch reads as empty" '' "$(host branch-read release/2026-10-12.1)"
check "an absent release branch is created" 0 "$(statusOf host branch-create release/2026-10-12.1 "$two")"
check "the created branch names the commit" "$two" "$(remoteBranch release/2026-10-12.1)"
check "the adapter reads the created branch" "$two" "$(host branch-read release/2026-10-12.1)"
check "branch creation pushes with ci.skip" "refs/heads/release/2026-10-12.1 $two 1:ci.skip" "$(cat "$STATE/received")"
: >"$STATE/received"
check "an existing branch at the commit is accepted" 0 "$(statusOf host branch-create release/2026-10-12.1 "$two")"
check "an existing branch elsewhere is refused distinctly" 4 "$(statusOf host branch-create release/2026-10-12.1 "$one")"
contains "the refusal names the existing commit" "$two" "$(cat "$tmp/error")"
check "an existing branch elsewhere is left alone" "$two" "$(remoteBranch release/2026-10-12.1)"
check "an existing release branch is never pushed" '' "$(cat "$STATE/received")"
descendant=$(printf 'fix: on top of the release\n' | "$realGit" commit-tree "$two^{tree}" -p "$two")
: >"$STATE/hide-branches-once"
check "a branch created during the read is refused distinctly" 4 "$(statusOf host branch-create release/2026-10-12.1 "$descendant")"
check "a branch created during the read is not fast-forwarded" "$two" "$(remoteBranch release/2026-10-12.1)"

: >"$STATE/received"
check "an absent environment branch is created by a move" 0 "$(statusOf host branch-move env/production "$two")"
check "the environment branch names the commit" "$two" "$(remoteBranch env/production)"
check "environment moves push with ci.skip" "refs/heads/env/production $two 1:ci.skip" "$(cat "$STATE/received")"
: >"$STATE/received"
check "an environment branch moves backwards" 0 "$(statusOf host branch-move env/production "$one")"
check "the forced move names the older commit" "$one" "$(remoteBranch env/production)"
check "the forced move pushes with ci.skip" "refs/heads/env/production $one 1:ci.skip" "$(cat "$STATE/received")"

: >"$STATE/refuse-push"
check "a refused branch creation is an error" 2 "$(statusOf host branch-create release/2026-10-12.2 "$two")"
check "a refused branch creation leaves no branch" '' "$(remoteBranch release/2026-10-12.2)"
check "a refused move is an error" 2 "$(statusOf host branch-move env/production "$two")"
check "a refused move leaves the branch" "$one" "$(remoteBranch env/production)"
rm -f "$STATE/refuse-push"
contains "release branches are pushed create-only to origin" "push --quiet -o ci.skip --force-with-lease=refs/heads/release/2026-10-12.1: origin $two:refs/heads/release/2026-10-12.1" "$(cat "$STATE/git-arguments")"
contains "environment branches are force-pushed to origin" "push --quiet -o ci.skip --force origin $one:refs/heads/env/production" "$(cat "$STATE/git-arguments")"
lacks "the job token never appears in git arguments" job-token-never-in-arguments "$(cat "$STATE/git-arguments")"
done_testing
