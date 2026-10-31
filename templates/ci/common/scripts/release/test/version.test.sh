#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
first=$(commit "chore: scaffold")
second=$(commit "feat: add login")
third=$(commit "fix: handle empty payload")
publish_main
check "first release of a day gets .1" "2026-10-12.1" "$(sh "$release/version.sh" "$first")"
git push -q origin "$first:refs/tags/2026-10-12.1"
check "second release of a day gets .2 from remote tags" "2026-10-12.2" "$(sh "$release/version.sh" "$second")"
check "redeploy reuses its commit tag" "2026-10-12.1" "$(sh "$release/version.sh" "$first")"
git push -q origin "$second:refs/tags/2026-10-12.9" "$second:refs/tags/2026-10-12.10"
check "the tenth sorts after the ninth" "2026-10-12.11" "$(sh "$release/version.sh" "$third")"
check "a new day restarts at .1" "2026-10-13.1" "$(RELEASE_NOW=1791892800 sh "$release/version.sh" "$third")"
check "rollback retains the original day and counter" "2026-10-12.1" "$(RELEASE_NOW=1791892800 sh "$release/version.sh" "$first")"
git push -q origin "$first:refs/tags/2026-10-12.90.1" "$first:refs/tags/v0.99.0" "$first:refs/tags/2026-10-12.099" "$first:refs/tags/unrelated"
check "hotfix-shaped and unrelated tags do not consume counters" "2026-10-12.11" "$(sh "$release/version.sh" "$third")"
sh "$RELEASE_HOST_ADAPTER" marker-write production "$third" 2026-10-12.11
check "a finalised record preserves an unpublished version" "2026-10-12.11" "$(sh "$release/version.sh" "$third")"
fourth=$(commit "fix: another change")
check "a finalised record consumes its counter" "2026-10-12.12" "$(sh "$release/version.sh" "$fourth")"
FAIL_STATUS=1 sh "$RELEASE_HOST_ADAPTER" marker-write production "$fourth" 2026-10-12.12 || true
check "an unfinalised record consumes nothing" "2026-10-12.12" "$(sh "$release/version.sh" "$fourth")"
printf 'RELEASE_TIMEZONE=Europe/London\n' >"$release/config.sh"
for entry in '1782860399 2026-06-30' '1782860400 2026-07-01' '1767225599 2025-12-31' '1767225600 2026-01-01'; do
    set -- $entry
    check "London midnight at epoch $1" "$2.1" "$(RELEASE_NOW=$1 sh "$release/version.sh" "$fourth")"
done
printf 'RELEASE_TIMEZONE=Unknown/Nowhere\n' >"$release/config.sh"
status=0
sh "$release/version.sh" "$fourth" >"$tmp/version" 2>"$tmp/error" || status=$?
check "an unresolvable timezone fails" 1 "$status"
contains "timezone failure is clear" RELEASE_TIMEZONE "$(cat "$tmp/error")"
printf 'RELEASE_TIMEZONE=UTC\n' >"$release/config.sh"
git clone -q --depth 1 "file://$tmp/remote.git" "$tmp/shallow"
status=0
(cd "$tmp/shallow" && sh "$release/version.sh" HEAD) >/dev/null 2>&1 || status=$?
check "a shallow clone is refused" 3 "$status"
status=0
sh "$release/version.sh" 0000000000000000000000000000000000000000 >/dev/null 2>&1 || status=$?
check "an unknown commit is refused" 3 "$status"
done_testing
