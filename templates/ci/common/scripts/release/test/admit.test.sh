#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host

first=$(commit "chore: scaffold")
second=$(commit "feat: one")
publish_main
git worktree add --quiet -b feature "$tmp/feature" HEAD
cd "$tmp/feature"
side=$(commit "feat: not merged")
cd "$tmp/repo"
local_only=$(commit "feat: not pushed")

admit() {
    status=0
    sh "$release/admit.sh" "$1" "$2" 2>"$tmp/error" || status=$?
    printf '%s' "$status"
}

check "a commit on main is admitted" "0" "$(admit production "$second")"
check "an older commit on main is admitted" "0" "$(admit production "$first")"
check "an upper-case SHA is admitted" "0" "$(admit production "$(printf '%s' "$second" | tr '[:lower:]' '[:upper:]')")"
check "a branch commit is rejected" "3" "$(admit production "$side")"
check "a commit not yet on origin is rejected" "3" "$(admit production "$local_only")"
check "a short hash is rejected" "3" "$(admit production "$(git rev-parse --short "$second")")"
contains "short hashes explain the full-SHA requirement" '40 hex characters' "$(cat "$tmp/error")"
check "a branch name is rejected" "3" "$(admit production main)"
check "an empty commit is rejected" "3" "$(admit production "")"
check "an unknown environment is rejected" "3" "$(admit uat "$second")"
check "an environment path is rejected" "3" "$(admit ../config "$second")"
check "an unknown commit is rejected" "3" "$(admit production 1111111111111111111111111111111111111111)"
git tag -a -m 'Release candidate' candidate "$second"
tag_object=$(git rev-parse refs/tags/candidate)
check "an annotated tag object's SHA is rejected" "3" "$(admit production "$tag_object")"

git worktree add --quiet -b merged-side "$tmp/merged-side" "$first"
cd "$tmp/merged-side"
merged_side=$(COMMIT_FILE=merged-side.txt commit "feat: merged side work")
cd "$tmp/repo"
git merge -q --no-ff -m 'feat: merge side work' merged-side
publish_main
git push -q origin "$first:refs/tags/2026-10-12.1" "HEAD:refs/tags/2026-10-12.2" "HEAD:refs/heads/release/2026-10-12.2"
check "a merged second-parent SHA is rejected" "3" "$(admit production "$merged_side")"

git clone -q --depth 1 "file://$tmp/remote.git" "$tmp/shallow"
status=0
(cd "$tmp/shallow" && sh "$release/admit.sh" production "$second") 2>"$tmp/error" || status=$?
check "a shallow clone is rejected" "3" "$status"
contains "the shallow error says why" "shallow clone" "$(cat "$tmp/error")"

cd "$tmp/repo"
fake_host
printf 'RELEASE_PUBLISH=false\n' >"$release/environments/uat.env"
printf 'RELEASE_PUBLISH=true\nRELEASE_AFTER=uat\n' >"$release/environments/production.env"
check "an absent prerequisite record is rejected" 3 "$(admit production "$second")"
contains "an absent prerequisite record is explained" 'has no finalised release record' "$(cat "$tmp/error")"
cp "$release/environments/uat.env" "$release/environments/INVALID.env"
check "an existing environment still needs a valid name" 3 "$(admit INVALID "$second")"

done_testing
