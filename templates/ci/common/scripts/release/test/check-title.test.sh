#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
unset PR_TITLE CI_MERGE_REQUEST_TITLE

title() {
    status=0
    PR_TITLE=$1 sh "$release/check-title.sh" 2>/dev/null || status=$?
    printf '%s' "$status"
}

check "no request title skips the check" "0" "$(title "")"
for type in feat fix perf refactor docs test build ci chore revert; do
    check "$type is accepted" "0" "$(title "$type: update the service")"
done
check "a scope is accepted" "0" "$(title "fix(api): handle an empty payload")"
check "a scoped breaking change is accepted" "0" "$(title "feat(web)!: replace the cookie")"
check "an unscoped breaking change is accepted" "0" "$(title "feat!: replace the cookie")"
check "a bare sentence fails" "1" "$(title "Add export")"
check "an unknown type fails" "1" "$(title "feature: add export")"
check "a missing summary fails" "1" "$(title "feat: ")"
check "a blank summary fails" "1" "$(title "feat:   ")"
check "an empty scope fails" "1" "$(title "feat(): add export")"
check "multiline titles fail" "1" "$(title "$(printf 'feat: first\nignored')")"
check "a merge request title is read from its environment" "0" "$(CI_MERGE_REQUEST_TITLE='fix: handle a reset' sh "$release/check-title.sh" >/dev/null && printf 0)"

PR_TITLE=$(printf 'fix(api): keep $(touch %s/title-owned) "quotes"; `touch %s/backtick-owned`' "$tmp" "$tmp")
export PR_TITLE
status=0
RELEASE_TOOLS=$release make -s -f "$release/../../release.mk" ci-title >"$tmp/title.log" 2>&1 || status=$?
check "a quoted title passes through make as data" "0" "$status"
check "command substitution in a title never executes" "no" "$(if [ -e "$tmp/title-owned" ]; then printf yes; else printf no; fi)"
check "backticks in a title never execute" "no" "$(if [ -e "$tmp/backtick-owned" ]; then printf yes; else printf no; fi)"

for marker in 'Draft:' '[Draft]' '(Draft)' 'WIP:' '[WIP]' 'dRaFt:' '[wIp]'; do
    for space in '' ' '; do
        check "draft marker $marker is ignored" 0 "$(title "${marker}${space}feat(api): add export")"
        check "draft marker $marker still validates the title" 1 "$(title "${marker}${space}Add export")"
    done
done

done_testing
