#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools

base=$(commit "feat: released service")
main=$(COMMIT_FILE=main.txt commit "feat: work on main")
publish_main
check "the base release succeeds" 0 "$(promote production "$base")"
hotfix=$(printf 'fix: merged repair\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q origin "$hotfix:refs/heads/release/2026-10-12.1"
check "the hotfix is released before merging" 0 "$(promote production "$hotfix")"
check "the hotfix receives its patch version" 2026-10-12.1.1 "$(outcome version)"
git merge -q --no-ff -m 'fix: merge released repair' "$hotfix"
merged=$(git rev-parse HEAD)
publish_main
git push -q origin :refs/heads/release/2026-10-12.1
check "a merged tagged hotfix can be redeployed without its branch" 0 "$(promote production "$hotfix")"
check "redeployment keeps the hotfix version" 2026-10-12.1.1 "$(outcome version)"
check "redeployment keeps the same baseline" same "$(outcome mode)"
contains "redeployment retains its wording" 'Redeploy of' "$(cat "$RELEASE_OUT/notes.md")"
check "the merge commit is a normal release" 0 "$(promote production "$merged")"
check "the merge commit receives a normal version" 2026-10-12.2 "$(outcome version)"
check "main notes use the hotfix release base" "$base" "$(outcome base)"
contains "main notes name the previously live hotfix" 'Hotfix 2026-10-12.1.1 was live' "$(cat "$RELEASE_OUT/notes.md")"
contains "main notes include work since the release base" 'work on main' "$(cat "$RELEASE_OUT/notes.md")"
check "rollback from the merge commit to its hotfix succeeds" 0 "$(promote production "$hotfix")"
check "rollback from the merge keeps the patch version" 2026-10-12.1.1 "$(outcome version)"
check "rollback from the merge is classified as rollback" rollback "$(outcome mode)"
contains "rollback from the merge keeps rollback wording" 'Rollback to' "$(cat "$RELEASE_OUT/notes.md")"
later=$(COMMIT_FILE=later.txt commit "feat: later main release")
publish_main
check "a later main release succeeds" 0 "$(promote production "$later")"
check "rollback from a later main release to the hotfix succeeds" 0 "$(promote production "$hotfix")"
check "later rollback keeps the original hotfix version" 2026-10-12.1.1 "$(outcome version)"
check "later rollback is classified as rollback" rollback "$(outcome mode)"
contains "later rollback lists the removed main work" 'later main release' "$(cat "$RELEASE_OUT/notes.md")"

uatHotfix=$(printf 'fix: repair proven in uat\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q origin "$uatHotfix:refs/heads/release/2026-10-12.1"
printf 'RELEASE_PUBLISH=false\n' >"$release/environments/uat.env"
check "uat proves an untagged hotfix" 0 "$(promote uat "$uatHotfix")"
git merge -q --no-ff -m 'fix: merge repair proven in uat' "$uatHotfix"
uatMerge=$(git rev-parse HEAD)
publish_main
printf 'RELEASE_AFTER=uat\n' >>"$release/environments/production.env"
check "a hotfix proven in uat remains promotable after its merge" 0 "$(promote production "$uatHotfix")"
check "the merged uat hotfix receives the next patch" 2026-10-12.1.2 "$(outcome version)"
check "production records the exact merged uat hotfix" "$uatHotfix" "$(cat "$STATE/marker-production")"
printf 'RELEASE_PUBLISH=true\n' >"$release/environments/production.env"
git push -q -f origin "$uatMerge:refs/heads/release/2026-10-12.1"
check "a first-parent commit stays normal despite a release branch" 0 "$(promote production "$uatMerge")"
check "a first-parent commit receives a normal version" 2026-10-12.4 "$(outcome version)"
status=0
sh "$release/hotfix.sh" "$uatMerge" --historical >"$tmp/identity" 2>&1 || status=$?
check "historical inspection never calls a first-parent commit a hotfix" 3 "$status"

squashedHotfix=$(printf 'fix: repair returned by squash\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q -f origin "$squashedHotfix:refs/heads/release/2026-10-12.1"
check "a hotfix intended for squash can be released" 0 "$(promote production "$squashedHotfix")"
git merge -q --squash "$squashedHotfix"
git commit -q --allow-empty -m 'fix: squash released repair'
squashedMain=$(git rev-parse HEAD)
publish_main
check "a squash-merged hotfix remains promotable" 0 "$(promote production "$squashedHotfix")"
check "a squash-merged hotfix keeps its patch" 2026-10-12.1.3 "$(outcome version)"
check "the squash commit remains a normal release" 0 "$(promote production "$squashedMain")"
check "the squash commit receives a daily version" 2026-10-12.5 "$(outcome version)"

foreignBase=$(printf 'feat: unrelated released service\n' | git commit-tree "$base^{tree}")
foreignHotfix=$(printf 'fix: unrelated repair\n' | git commit-tree "$base^{tree}" -p "$foreignBase")
git push -q origin "$foreignBase:refs/tags/2026-10-11.1" "$foreignHotfix:refs/heads/release/2026-10-11.1"
status=0
sh "$release/hotfix.sh" "$foreignHotfix" --admit >"$tmp/foreign-error" 2>&1 || status=$?
check "a hotfix release base must be on main" 3 "$status"
contains "the foreign-base refusal identifies the required ancestry" 'released tag on main' "$(cat "$tmp/foreign-error")"
done_testing
