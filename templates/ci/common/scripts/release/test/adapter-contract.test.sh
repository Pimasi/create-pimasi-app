#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
unset RELEASE_HOST_ADAPTER RELEASE_TOKEN
sandbox
fake_tools
cat >"$tmp/remote.git/hooks/pre-receive" <<'HOOK'
#!/bin/sh
while read -r old new ref; do
    case "$ref" in
        refs/heads/*) [ -z "${REFUSE_BRANCH:-}" ] || exit 1 ;;
    esac
done
HOOK
chmod +x "$tmp/remote.git/hooks/pre-receive"
mkdir -p "$STATE/api/tags" "$STATE/api/releases" "$STATE/api/statuses"
printf '[]\n' >"$STATE/api/deployments.json"
cp "$release/test/stateful-curl.sh" "$tmp/bin/curl"
chmod +x "$tmp/bin/curl"
if grep -q GITHUB_REPOSITORY "$release/host.sh"; then
    ADAPTER_HOST=github
else
    ADAPTER_HOST=gitlab
fi
GITHUB_TOKEN=contract-token
GITHUB_REPOSITORY=Acme/Shop
GITHUB_GRAPHQL_URL=https://api.github.test/graphql
GITHUB_API_URL=https://api.github.test
GITHUB_ACTOR=contract
CI_JOB_TOKEN=contract-token
CI_API_V4_URL=https://gitlab.test/api/v4
CI_PROJECT_ID=12
CI_REGISTRY_IMAGE=registry.gitlab.test/Acme/Shop
CI_REGISTRY=registry.gitlab.test
CI_REGISTRY_USER=gitlab-ci-token
CI_REGISTRY_PASSWORD=contract-password
export ADAPTER_HOST GITHUB_TOKEN GITHUB_REPOSITORY GITHUB_GRAPHQL_URL GITHUB_API_URL GITHUB_ACTOR
export CI_JOB_TOKEN CI_API_V4_URL CI_PROJECT_ID CI_REGISTRY_IMAGE CI_REGISTRY CI_REGISTRY_USER CI_REGISTRY_PASSWORD
one=$(commit "chore: scaffold")
two=$(commit "feat: add login")
three=$(commit "fix: retain session")
four=$(commit "feat(api): add export")
five=$(commit "fix: improve export")
six=$(commit "feat: add invoices")
seven=$(commit "feat: add preferences")
eight=$(commit "fix: repair preferences")
nine=$(commit "feat: add reports")
publish_main
check "real adapter accepts the core marker-write arguments" 0 "$(promote production "$two")"
check "real adapter records the first candidate" "$two" "$(sh "$release/host.sh" marker-read production)"
check "real adapter publishes first version" yes "$(test -f "$STATE/api/releases/2026-10-12.1.md" && printf yes || printf no)"
check "real adapter creates the release branch at the published commit" "$two" "$(git ls-remote --heads origin refs/heads/release/2026-10-12.1 | cut -f1)"
check "real adapter moves the environment branch to the healthy commit" "$two" "$(git ls-remote --heads origin refs/heads/env/production | cut -f1)"
if [ "$ADAPTER_HOST" = github ]; then
    check "record payload receives the version" 2026-10-12.1 "$(jq -r '.[0].payload.version' "$STATE/api/deployments.json")"
    check "record description receives the version" 2026-10-12.1 "$(jq -r '.[0].description' "$STATE/api/deployments.json")"
fi
check "real adapter accepts range promotion" 0 "$(promote production "$four")"
check "real adapter range uses previous live record" "$two" "$(outcome base)"
original=$(cat "$STATE/api/releases/2026-10-12.2.md" 2>/dev/null || true)
contains "real adapter publishes range notes" '(2 commits)' "$original"
check "real adapter accepts redeploy" 0 "$(promote production "$four")"
check "real adapter keeps first-promotion notes on redeploy" "$original" "$(cat "$STATE/api/releases/2026-10-12.2.md")"
check "real adapter accepts rollback" 0 "$(promote production "$two")"
check "real adapter rollback moves the record" "$two" "$(sh "$release/host.sh" marker-read production)"
check "real adapter rollback forces the environment branch backwards" "$two" "$(git ls-remote --heads origin refs/heads/env/production | cut -f1)"
check "real adapter keeps one release branch per first-level version" "$four" "$(git ls-remote --heads origin refs/heads/release/2026-10-12.2 | cut -f1)"
check "real adapter publication refusal remains successful" 0 "$(REFUSE_RELEASE=1 promote production "$three")"
check "real adapter publication refusal is reported" 'succeeded, publication incomplete' "$(outcome outcome)"
original=$(cat "$RELEASE_OUT/publication.md" 2>/dev/null || true)
check "real adapter retry succeeds" 0 "$(promote production "$three")"
check "real adapter retry preserves first-promotion notes" "$original" "$(cat "$STATE/api/releases/2026-10-12.3.md")"
check "real adapter receives no record after readiness failure" 1 "$(FAIL_READINESS=1 promote production "$four")"
check "real adapter readiness failure leaves record unchanged" "$three" "$(sh "$release/host.sh" marker-read production)"
check "real adapter refuses unfinalised record writes" 2 "$(FAIL_FINALISE=1 promote production "$four")"
check "real adapter excludes unfinalised record" "$three" "$(sh "$release/host.sh" marker-read production)"
check "unhealthy new commit consumes no counter" 1 "$(FAIL_READINESS=1 promote production "$five")"
check "unhealthy new commit has no release tag" no "$(test -f "$STATE/api/tags/2026-10-12.4" && printf yes || printf no)"
check "healthy retry receives the unconsumed counter" 0 "$(promote production "$five")"
check "healthy retry uses the next counter" 2026-10-12.4 "$(outcome version)"
check "racing promotion recomputes and retries" 0 "$(RACE_TAG_SHA=$one promote production "$six")"
check "racing tag remains at the other commit" "$one" "$(cat "$STATE/api/tags/2026-10-12.5")"
check "retry uses the next free tag" "$six" "$(cat "$STATE/api/tags/2026-10-12.6")"
check "retry records its final version" 2026-10-12.6 "$(outcome version)"

printf 'RELEASE_PUBLISH=false\nRELEASE_HEALTH_URL=\n' >"$release/environments/dev.env"
check "non-publishing adapter promotion succeeds" 0 "$(promote dev "$seven")"
check "non-publishing adapter promotion assigns no version" '' "$(outcome version)"
contains "non-publishing build uses the commit label" "APP_VERSION=sha-$(printf '%.12s' "$seven")" "$(calls)"
check "non-publishing record advances independently" "$seven" "$(sh "$release/host.sh" marker-read dev)"

check "a new publication refusal preserves its live record" 0 "$(REFUSE_RELEASE=1 promote production "$eight")"
check "another commit after publication refusal succeeds" 0 "$(promote production "$nine")"
if [ "$ADAPTER_HOST" = github ]; then
    check "a finalised record reserves its unpublished counter" 2026-10-12.8 "$(outcome version)"
    check "later promotion reuses the record-held version" 0 "$(promote production "$eight")"
    check "later promotion keeps its original version" 2026-10-12.7 "$(outcome version)"
else
    check "GitLab tags-only fallback cannot reserve an unpublished counter" 2026-10-12.7 "$(outcome version)"
    check "GitLab later promotion chooses an unused tag" 0 "$(promote production "$eight")"
    check "GitLab tags-only fallback changes the untagged version" 2026-10-12.8 "$(outcome version)"
fi

git push -q origin :refs/heads/release/2026-10-12.1
check "a refused branch write through the real adapter keeps the deployment" 0 "$(REFUSE_BRANCH=1 promote production "$two")"
check "a refused release branch through the real adapter leaves publication incomplete" 'succeeded, publication incomplete' "$(outcome outcome)"
check "a refused release branch through the real adapter is not created" '' "$(git ls-remote --heads origin refs/heads/release/2026-10-12.1 | cut -f1)"
check "a refused environment branch through the real adapter stays put" "$eight" "$(git ls-remote --heads origin refs/heads/env/production | cut -f1)"
contains "a refused environment branch through the real adapter is a warning" "warning: env/production was not moved to $two" "$(cat "$tmp/promote.log")"
check "a refused branch write through the real adapter still records the deployment" "$two" "$(sh "$release/host.sh" marker-read production)"
check "a retry through the real adapter succeeds" 0 "$(promote production "$two")"
check "the retry through the real adapter completes publication" succeeded "$(outcome outcome)"
check "the retry through the real adapter creates the release branch" "$two" "$(git ls-remote --heads origin refs/heads/release/2026-10-12.1 | cut -f1)"
check "the retry through the real adapter moves the environment branch" "$two" "$(git ls-remote --heads origin refs/heads/env/production | cut -f1)"

done_testing
