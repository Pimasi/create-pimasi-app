#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools

one=$(commit "feat: first environment release")
two=$(COMMIT_FILE=two.txt commit "fix: second environment release")
three=$(COMMIT_FILE=three.txt commit "feat: third environment release")
publish_main
printf 'RELEASE_PUBLISH=false\n' >"$release/environments/dev.env"

page() {
    cat "$STATE/env-page-$1.md" 2>/dev/null || true
}

entries() {
    page "$1" | grep -c '^## .* · .* UTC$' || true
}

line() {
    calls | grep -n -- "$1" | head -n 1 | cut -d: -f1
}

check "first page promotion succeeds" 0 "$(promote production "$one")"
contains "no-baseline promotion creates the first dated entry" '## 2026-10-12.1 · 12-10-2026 12:00 UTC' "$(page production)"
contains "first entry keeps the promotion's plain notes" 'No trusted previous release' "$(page production)"
check "first page fixes its git tag at the deployed commit" "$one" "$(git ls-remote --tags origin refs/tags/changelog/production | cut -f1)"
check "the page is written after the live record" true "$([ "$(line 'host marker-write production')" -lt "$(line 'host env-page-write production')" ] 2>/dev/null && printf true || printf false)"
check "the page is written after version publication" true "$([ "$(line 'host release-publish')" -lt "$(line 'host env-page-write production')" ] 2>/dev/null && printf true || printf false)"
firstVersion=$(cat "$STATE/release-2026-10-12.1.md")

check "range promotion succeeds" 0 "$(promote production "$two")"
check "a range promotion prepends its version" '## 2026-10-12.2 · 12-10-2026 12:00 UTC' "$(page production | head -n 1)"
check "a range promotion preserves the first entry" 2 "$(entries production)"
contains "range entry uses the destination's notes" 'second environment release' "$(page production)"
check "the range entry precedes the first version" '2026-10-12.2,2026-10-12.1' "$(page production | sed -n 's/^## \([^ ]*\) · .* UTC$/\1/p' | paste -sd,)"
before=$(page production)
: >"$STATE/calls"
check "same promotion succeeds" 0 "$(promote production "$two")"
check "same redeploy leaves the body untouched" "$before" "$(page production)"
lacks "same redeploy skips the page read" 'host env-page-read' "$(calls)"
lacks "same redeploy skips the page write" 'host env-page-write' "$(calls)"

check "rollback promotion succeeds" 0 "$(promote production "$one")"
check "rollback prepends another entry" 3 "$(entries production)"
contains "rollback entry lists the removed changes" 'Rollback to' "$(page production)"
check "rollback keeps the version page's first notes" "$firstVersion" "$(cat "$STATE/release-2026-10-12.1.md")"

hotfix=$(printf 'fix: environment hotfix\n' | git commit-tree "$one^{tree}" -p "$one")
git push -q origin "$hotfix:refs/heads/release/2026-10-12.1"
check "hotfix promotion succeeds" 0 "$(promote production "$hotfix")"
check "hotfix prepends its patch label" '## 2026-10-12.1.1 · 12-10-2026 12:00 UTC' "$(page production | head -n 1)"
contains "hotfix entry keeps its base and plain notes" 'Hotfix of 2026-10-12.1' "$(page production)"
check "hotfix adds one entry" 4 "$(entries production)"

cp "$release/notes-ai.sh" "$release/notes-ai-original.sh"
cat >"$release/notes-ai.sh" <<'NOTES'
#!/bin/sh
sh "$(dirname -- "$0")/notes-ai-original.sh" "$@"
printf '\nModel summary only.\n'
NOTES
: >"$STATE/calls"
check "non-publishing promotion succeeds" 0 "$(promote dev "$three")"
contains "non-publishing entry uses a commit label" "## sha-$(printf '%.12s' "$three") · 12-10-2026 12:00 UTC" "$(page dev)"
contains "the summary can use rewritten notes" 'Model summary only.' "$(cat "$RELEASE_OUT/summary.md")"
lacks "environment pages keep plain notes before the rewrite" 'Model summary only.' "$(page dev)"
contains "a page tag never labels the live commit in hotfix notes" "moves dev from $(printf '%.8s' "$three") to hotfix" "$(RELEASE_ENV=dev sh "$release/notes.sh" "$three" "$hotfix")"
lacks "non-publishing environment creates no version page" 'host release-publish' "$(calls)"
check "another environment keeps the production page" 4 "$(entries production)"

for refusal in READ WRITE; do
    eval "export FAIL_ENV_PAGE_$refusal=1"
    target=$two
    [ "$refusal" != WRITE ] || target=$one
    check "a refused page $refusal keeps the deploy successful" 0 "$(promote dev "$target")"
    check "a refused page $refusal reports incomplete publication" 'succeeded, publication incomplete' "$(outcome outcome)"
    check "a refused page $refusal keeps the new live record" "$target" "$(cat "$STATE/marker-dev")"
    summary=$(cat "$RELEASE_OUT/summary.md")
    contains "a refused page $refusal names the page failure in the summary" 'The environment page was not updated.' "$summary"
    contains "a refused page $refusal explains the host error" 'host reported an error' "$summary"
    contains "a refused page $refusal names the retained artefact" 'job artefact `env-page.md`, to add by hand' "$summary"
    lacks "a refused page $refusal never advises a same-SHA retry" 'Promote this SHA again' "$summary"
    contains "a refused page $refusal retains the entry for manual addition" "## sha-$(printf '%.12s' "$target") ·" "$(cat "$RELEASE_OUT/env-page.md")"
    eval "unset FAIL_ENV_PAGE_$refusal"
done

cp "$release/env-page.sh" "$tmp/env-page-original.sh"
cat >"$release/env-page.sh" <<'PAGE'
#!/bin/sh
kill -TERM "$PPID"
sleep 0.1
PAGE
check "interrupted non-publishing page retains its signal status" 143 "$(promote dev "$three")"
check "interrupted non-publishing page reports incomplete publication" 'succeeded, publication incomplete' "$(outcome outcome)"
check "interrupted non-publishing page keeps the healthy record" "$three" "$(cat "$STATE/marker-dev")"
cp "$tmp/env-page-original.sh" "$release/env-page.sh"

: >"$STATE/calls"
check "a failed health check fails the deploy" 1 "$(FAIL_READINESS=1 promote dev "$two")"
lacks "an unhealthy deploy never writes an environment page" 'host env-page-write' "$(calls)"
done_testing
