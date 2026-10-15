#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools
base=$(commit 'feat: base release')
main=$(COMMIT_FILE=main.txt commit 'feat: next main release')
publish_main
check 'the base release succeeds' 0 "$(promote production "$base")"
first=$(printf 'fix: first hotfix\n' | git commit-tree "$base^{tree}" -p "$base")
second=$(printf 'fix: independent hotfix\n' | git commit-tree "$base^{tree}" -p "$base")
git push -q origin "$first:refs/heads/release/2026-10-12.1"
check 'the first hotfix succeeds' 0 "$(promote production "$first")"
git push -q -f origin "$second:refs/heads/release/2026-10-12.1"
check 'a hotfix from a rewritten line retries its tag collision' 0 "$(RACE_SHA=$main promote production "$second")"
check 'the retry assigns the next hotfix counter' 2026-10-12.1.3 "$(outcome version)"
for file in notes.md summary.md publication.md; do
    contains "$file names the final hotfix version" 'moves production from 2026-10-12.1.1 to hotfix 2026-10-12.1.3' "$(cat "$RELEASE_OUT/$file")"
    lacks "$file does not name the colliding candidate version" 'to hotfix 2026-10-12.1.2' "$(cat "$RELEASE_OUT/$file")"
done
done_testing
