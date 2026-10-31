#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
mkdir -p "$RELEASE_OUT"
sha=$(commit "feat: environment page limits")
publish_main
printf 'Plain promotion notes.\n' >"$RELEASE_OUT/notes-plain.md"

write_page() {
    status=0
    sh "$release/env-page.sh" dev "$sha" '' range >"$tmp/page.log" 2>&1 || status=$?
    printf '%s' "$status"
}

page() {
    cat "$STATE/env-page-dev.md" 2>/dev/null || true
}

jq -nr '[range(1; 106) | "## sha-abcdef123456 · 12-10-2026 12:00 UTC\n\nOld entry \(.)\n\n"] | join("")' >"$STATE/env-page-dev.md"
check "entry trimming succeeds" 0 "$(write_page)"
check "the page keeps exactly the newest 100 entries" 100 "$(page | grep -c '^## .* · .* UTC$' || true)"
contains "entry trimming keeps the newest old entry" 'Old entry 1' "$(page)"
lacks "entry trimming drops the oldest entry" 'Old entry 100' "$(page)"

for provider in github gitlab; do
    case "$provider" in
        github) GITLAB_CI=false; size=60000; limit=125000 ;;
        gitlab) GITLAB_CI=true; size=450000; limit=1000000 ;;
    esac
    export GITLAB_CI
    jq -nr --argjson size "$size" '[range(1; 4) | "## sha-abcdef123456 · 12-10-2026 12:00 UTC\n\nOld entry \(.)\n" + ("é" * $size) + "\n\n"] | join("")' >"$STATE/env-page-dev.md"
    check "$provider size trimming succeeds" 0 "$(write_page)"
    check "$provider retains the newest entries within its character limit" 3 "$(page | grep -c '^## .* · .* UTC$' || true)"
    check "$provider body fits its character limit" true "$(jq -Rrs --argjson limit "$limit" 'length <= $limit' "$STATE/env-page-dev.md")"
    contains "$provider retains the newer old entry" 'Old entry 2' "$(page | head -c 2000000)"
    lacks "$provider drops the oldest complete entry" 'Old entry 3' "$(page | head -c 2000000)"
done

for provider in github gitlab; do
    case "$provider" in
        github) GITLAB_CI=false; limit=125000 ;;
        gitlab) GITLAB_CI=true; limit=1000000 ;;
    esac
    export GITLAB_CI
    jq -nr '"## Changes (2000 commits)\n\n### Features\n" + ([range(1; 2001) | "- Commit \(.) " + ("é" * 600) + " `abcdef1`\n"] | join(""))' >"$RELEASE_OUT/notes-plain.md"
    jq -nr '"## sha-abcdef123456 · 12-10-2026 12:00 UTC\n\nExisting page history.\n" + ("x" * 3000)' >"$STATE/env-page-dev.md"
    check "$provider oversized entry on a non-empty page succeeds" 0 "$(write_page)"
    check "$provider oversized entry never empties the page" true "$(jq -Rrs 'length > 0' "$STATE/env-page-dev.md")"
    check "$provider oversized entry fits its character limit" true "$(jq -Rrs --argjson limit "$limit" 'length <= $limit' "$STATE/env-page-dev.md")"
    contains "$provider oversized entry retains its heading" "## sha-$(printf '%.12s' "$sha") · 12-10-2026 12:00 UTC" "$(head -c 200 "$STATE/env-page-dev.md")"
    contains "$provider oversized entry retains complete commits" '- Commit 1 ' "$(head -c 200 "$STATE/env-page-dev.md")"
    shown=$(grep -c '^- Commit .* `abcdef1`$' "$STATE/env-page-dev.md" || true)
    check "$provider oversized entry ends with the exact omitted commit count" "($((2000 - shown)) more commits not shown)" "$(tail -n 1 "$STATE/env-page-dev.md")"
    lacks "$provider oversized entry trims older history afterwards" 'Existing page history.' "$(tail -c 200 "$STATE/env-page-dev.md")"
done

GITLAB_CI=false
export GITLAB_CI
printf 'Plain promotion notes.\n' >"$RELEASE_OUT/notes-plain.md"
jq -nr '[range(1; 106) | "## 2026-10-12.\(.) · 12-10-2026 12:00 UTC\r\n\r\nOld version entry \(.)\r\n\r\n"] | join("")' >"$STATE/env-page-dev.md"
check "CRLF version entries are split successfully" 0 "$(write_page)"
check "CRLF pages keep the newest 100 entries" 100 "$(page | grep -c '^## .* · .* UTC' || true)"
contains "CRLF pages retain the newest version entry" 'Old version entry 1' "$(page)"
contains "CRLF pages retain the last entry within the cap" 'Old version entry 99' "$(page)"
lacks "CRLF pages drop the oldest version entry" 'Old version entry 100' "$(page)"
done_testing
