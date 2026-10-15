#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
unset GITHUB_ACTIONS RELEASE_TOKEN RELEASE_MAINTAINERS_ONLY 2>/dev/null || true
sandbox
fake_host
fake_tools

first=$(commit "feat: first release")
publish_main
cp "$release/config.sh" "$tmp/config-without-key.sh"
printf 'RELEASE_MAINTAINERS_ONLY=true\n' >>"$release/config.sh"
: >"$STATE/calls"
check "a GitHub promotion without RELEASE_TOKEN is refused" 3 "$(GITHUB_ACTIONS=true promote production "$first")"
check "the refusal is a rejection" rejected "$(outcome outcome)"
check "the refusal happens at admission" admit "$(outcome stage)"
contains "the refusal names the missing token" RELEASE_TOKEN "$(cat "$tmp/promote.log")"
contains "the refusal names the runbook section" 'see "Maintainer-only releases" in RELEASE.md' "$(cat "$tmp/promote.log")"
lacks "the refusal reads no live record" 'host marker-read' "$(calls)"
lacks "the refusal runs no gate" 'make ' "$(calls)"
lacks "the refusal builds nothing" 'docker build' "$(calls)"
check "an empty RELEASE_TOKEN counts as missing" 3 "$(GITHUB_ACTIONS=true RELEASE_TOKEN= promote production "$first")"
check "nothing is recorded while the token is missing" '' "$(cat "$STATE/marker-production" 2>/dev/null || true)"
check "a GitHub promotion with RELEASE_TOKEN proceeds" 0 "$(GITHUB_ACTIONS=true RELEASE_TOKEN=release-token promote production "$first")"
check "the promotion with the token succeeds" succeeded "$(outcome outcome)"
check "outside GitHub the switch changes nothing" 0 "$(promote production "$first")"

printf 'RELEASE_MAINTAINERS_ONLY=false\n' >>"$release/config.sh"
check "with the switch off a GitHub promotion needs no token" 0 "$(GITHUB_ACTIONS=true promote production "$first")"
cp "$tmp/config-without-key.sh" "$release/config.sh"
check "a configuration without the key reads the switch as off" 0 "$(GITHUB_ACTIONS=true promote production "$first")"
check "only the configuration turns the switch on" 0 "$(GITHUB_ACTIONS=true RELEASE_MAINTAINERS_ONLY=true promote production "$first")"

printf 'RELEASE_MAINTAINERS_ONLY=true\n' >>"$release/config.sh"
printf 'RELEASE_PUBLISH=false\nRELEASE_HEALTH_URL=\n' >"$release/environments/uat.env"
printf '%s\n' "$first" >"$STATE/marker-uat"
printf 'RELEASE_AFTER=uat\n' >>"$release/environments/production.env"
: >"$STATE/calls"
check "a GitHub promotion that follows uat is refused without RELEASE_TOKEN" 3 "$(GITHUB_ACTIONS=true promote production "$first")"
contains "that refusal names the missing token" RELEASE_TOKEN "$(cat "$tmp/promote.log")"
lacks "that refusal reads no live record, not even uat's" 'host marker-' "$(calls)"
check "with RELEASE_TOKEN the same promotion proceeds" 0 "$(GITHUB_ACTIONS=true RELEASE_TOKEN=release-token promote production "$first")"
contains "that promotion reads uat's live record at admission" 'host marker-read uat' "$(calls)"
done_testing
