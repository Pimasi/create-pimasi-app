#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools

baseRelease=2026-10-12.1
baseCommit=$(commit "feat: released service")
COMMIT_FILE=feature.txt
export COMMIT_FILE
feature=$(commit "feat: unreleased dashboard")
COMMIT_FILE=fix.txt
fix=$(commit "fix(api): repair live requests")
COMMIT_FILE=second.txt
secondFix=$(commit "fix: repair retries")
publish_main
git worktree add --quiet -b release/2026-10-12.1 "$tmp/hotfix" "$baseCommit"
git -C "$tmp/hotfix" cherry-pick -x "$fix" >/dev/null
hotfix=$(git -C "$tmp/hotfix" rev-parse HEAD)
git -C "$tmp/hotfix" cherry-pick -x "$secondFix" >/dev/null
secondHotfix=$(git -C "$tmp/hotfix" rev-parse HEAD)

check "release the hotfix base" 0 "$(promote production "$baseCommit")"
check "base receives a daily version" "$baseRelease" "$(outcome version)"
git push --quiet origin release/2026-10-12.1
git fetch --quiet origin
printf 'RELEASE_PUBLISH=false\nRELEASE_HEALTH_URL=\n' >"$release/environments/uat.env"
printf 'RELEASE_PUBLISH=false\nRELEASE_HEALTH_URL=\n' >"$release/environments/dev.env"
check "uat starts at the released base" 0 "$(promote uat "$baseCommit")"
check "dev starts at a different main commit" 0 "$(promote dev "$feature")"
printf 'RELEASE_AFTER=uat\n' >>"$release/environments/production.env"

: >"$STATE/calls"
check "production waits for the hotfix in uat" 3 "$(promote production "$hotfix")"
lacks "waiting for uat builds nothing" 'docker build' "$(calls)"
check "uat admits a valid hotfix" 0 "$(promote uat "$hotfix")"
check "uat assigns no hotfix version" '' "$(outcome version)"
check "uat records the exact hotfix" "$hotfix" "$(cat "$STATE/marker-uat")"
contains "uat uses a commit build label" "APP_VERSION=sha-$(printf '%.12s' "$hotfix")" "$(calls)"
check "uat creates no hotfix tag" '' "$(sh "$RELEASE_HOST_ADAPTER" tag-read "$baseRelease.1")"

: >"$STATE/calls"
check "an independent environment accepts a different released base" 0 "$(promote dev "$hotfix")"
contains "the move names the previous live commit" "$(git rev-parse --short=8 "$feature")" "$(cat "$RELEASE_OUT/notes.md")"
check "the independent promotion preserves production" "$baseCommit" "$(cat "$STATE/marker-production")"
check "dev can roll back to the base" 0 "$(promote dev "$baseCommit")"
check "dev then admits the hotfix independently" 0 "$(promote dev "$hotfix")"
check "independent hotfix assigns no version" '' "$(outcome version)"

: >"$STATE/calls"
check "production accepts the exact hotfix proven in uat" 0 "$(FAIL_TAG=1 promote production "$hotfix")"
check "a refused hotfix publication stays successful" 'succeeded, publication incomplete' "$(outcome outcome)"
check "first hotfix receives the base patch version" "$baseRelease.1" "$(outcome version)"
check "refused publication still records the hotfix" "$hotfix" "$(cat "$STATE/marker-production")"
contains "gate worktree uses the exact hotfix" "ci at $hotfix" "$(calls)"
check "build worktree is at the exact hotfix" "$hotfix" "$(git -C "$RELEASE_OUT/src" rev-parse HEAD)"
contains "build uses the hotfix worktree" "$RELEASE_OUT/src" "$(calls)"
contains "build receives the exact hotfix" "GIT_SHA=$hotfix" "$(calls)"
contains "hotfix notes identify their base" "Hotfix of $baseRelease" "$(cat "$RELEASE_OUT/notes.md")"
contains "hotfix notes include the picked commit" "$(git rev-parse --short "$hotfix")" "$(cat "$RELEASE_OUT/notes.md")"
contains "hotfix notes include the main original" "$(git rev-parse --short "$fix")" "$(cat "$RELEASE_OUT/notes.md")"
lacks "hotfix notes exclude the unreleased feature" 'unreleased dashboard' "$(cat "$RELEASE_OUT/notes.md")"
originalNotes=$(cat "$RELEASE_OUT/publication.md" 2>/dev/null || true)
check "hotfix publication retry succeeds" 0 "$(promote production "$hotfix")"
check "hotfix retry keeps its patch version" "$baseRelease.1" "$(outcome version)"
check "hotfix retry creates the immutable tag" "$hotfix" "$(sh "$RELEASE_HOST_ADAPTER" tag-read "$baseRelease.1")"
check "hotfix retry preserves publication notes" "$originalNotes" "$(cat "$STATE/release-$baseRelease.1.md" 2>/dev/null || true)"
check "hotfix has exactly one tag" 1 "$(sh "$RELEASE_HOST_ADAPTER" tag-list | jq --arg sha "$hotfix" '[.[] | select(.sha == $sha)] | length')"

check "uat advances to the second hotfix" 0 "$(promote uat "$secondHotfix")"
check "production accepts an ancestor of uat" 0 "$(promote production "$hotfix")"
check "production accepts the second hotfix" 0 "$(promote production "$secondHotfix")"
check "second hotfix receives the next patch" "$baseRelease.2" "$(outcome version)"
check "first hotfix tag never moves" "$hotfix" "$(sh "$RELEASE_HOST_ADAPTER" tag-read "$baseRelease.1")"
check "second hotfix tag points at its commit" "$secondHotfix" "$(sh "$RELEASE_HOST_ADAPTER" tag-read "$baseRelease.2")"

printf 'RELEASE_PUBLISH=true\nRELEASE_HEALTH_URL=\n' >"$release/environments/production.env"
: >"$STATE/calls"
check "a main candidate without the live fixes is permitted" 0 "$(promote production "$feature")"
contains "the notes ask the team to confirm the fixes" "confirm on main" "$(cat "$RELEASE_OUT/notes.md")"
check "the permitted candidate becomes live" "$feature" "$(cat "$STATE/marker-production")"
check "restore the latest hotfix before rollback" 0 "$(promote production "$secondHotfix")"

check "rollback over the hotfix is permitted" 0 "$(promote production "$baseCommit")"
check "rollback reuses the base version" "$baseRelease" "$(outcome version)"
contains "rollback wording names the hotfix" 'hotfix' "$(cat "$RELEASE_OUT/notes.md")"
contains "rollback is explicit" 'Rollback' "$(cat "$RELEASE_OUT/notes.md")"
check "restore the latest hotfix after rollback" 0 "$(promote production "$secondHotfix")"
check "the next normal main release succeeds" 0 "$(promote production "$secondFix")"
check "hotfixes do not consume daily release numbers" 2026-10-12.3 "$(outcome version)"
contains "next normal release separates already-live fixes" "Hotfix $baseRelease.2 was live" "$(cat "$RELEASE_OUT/notes.md")"
contains "next normal release includes the pending feature" 'unreleased dashboard' "$(cat "$RELEASE_OUT/notes.md")"
check "normal release moves only production" "$hotfix" "$(cat "$STATE/marker-dev")"
check "normal release records main's tip" "$secondFix" "$(cat "$STATE/marker-production")"
done_testing
