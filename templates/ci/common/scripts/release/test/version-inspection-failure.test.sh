#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host

base=$(commit "feat: released service")
commit "feat: work on main" >/dev/null
publish_main
git push -q origin "$base:refs/tags/2026-10-12.1"
hotfix=$(printf 'fix: repair awaiting inspection\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q origin "$hotfix:refs/heads/release/2026-10-12.1"
kind=$(sh "$release/admit.sh" production "$hotfix" --kind)
check "the candidate is admitted as a hotfix" "hotfix $base 2026-10-12.1" "$kind"
printf '#!/bin/sh\nexit 3\n' >"$release/hotfix.sh"
status=0
RELEASE_CANDIDATE_KIND=${kind%% *} sh "$release/version.sh" "$hotfix" >"$tmp/version" 2>"$tmp/version-error" || status=$?
check "failed inspection stops an admitted hotfix" 1 "$status"
check "failed hotfix inspection assigns no normal version" '' "$(cat "$tmp/version")"
contains "failed hotfix inspection names the candidate" "could not inspect hotfix $hotfix" "$(cat "$tmp/version-error")"
done_testing
