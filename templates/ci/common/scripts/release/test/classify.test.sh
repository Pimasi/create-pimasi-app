#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox

old=$(commit "chore: scaffold")
mid=$(commit "feat: one")
new=$(commit "feat: two")
other=$(printf 'chore: unrelated history\n' | git commit-tree "$(git rev-parse HEAD^{tree})")

check "marker behind the candidate" "range $old $new" "$(sh "$release/classify.sh" "$old" "$new")"
check "marker equals the candidate" "same $new $new" "$(sh "$release/classify.sh" "$new" "$new")"
check "marker ahead of the candidate" "rollback $new $mid" "$(sh "$release/classify.sh" "$new" "$mid")"
check "no marker" "no-baseline - $new" "$(sh "$release/classify.sh" "" "$new")"
check "unknown marker" "no-baseline - $new" "$(sh "$release/classify.sh" "1111111111111111111111111111111111111111" "$new")"
check "diverged marker" "no-baseline $other $new" "$(sh "$release/classify.sh" "$other" "$new")"

status=0
sh "$release/classify.sh" "$old" "nope" >/dev/null 2>&1 || status=$?
check "an unknown candidate is an error" "3" "$status"
done_testing
