#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools
one=$(commit "chore: scaffold")
two=$(commit "feat: first change")
three=$(commit "fix: second change")
publish_main
printf 'RELEASE_PUBLISH=true\nRELEASE_HEALTH_URL=\n' >"$release/environments/secondary.env"
sh "$RELEASE_HOST_ADAPTER" marker-write production "$one" ""
sh "$RELEASE_HOST_ADAPTER" marker-write secondary "$two" ""
check "the first environment may refuse publication" 0 "$(FAIL_TAG=1 promote production "$three")"
first_notes=$(cat "$RELEASE_OUT/publication.md")
contains "the initial publication includes both changes" '(2 commits)' "$first_notes"
check "another publishing environment retries the same version" 0 "$(promote secondary "$three")"
check "the second environment reuses the held version" 2026-10-12.1 "$(outcome version)"
check "publication in another environment preserves the first notes" "$first_notes" "$(cat "$STATE/release-2026-10-12.1.md")"
check "the second environment still gets its own promotion baseline" "$two" "$(outcome base)"
done_testing
