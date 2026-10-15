#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
cat >"$release/deploy.sh" <<'OUTER'
#!/bin/sh
printf 'the outer deploy seam was called\n' >"$STATE/outer-deploy-called"
exit 99
OUTER
cp -R "$tmp/tooling" "$tmp/promotion-tooling"
release=$tmp/promotion-tooling/scripts/release
cat >"$release/deploy.sh" <<'DEPLOY'
#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"
initialise_output
printf 'deploy %s %s %s images %s %s\n' "$1" "$2" "$3" \
    "${RELEASE_IMAGE_SERVER:?}" "${RELEASE_IMAGE_WEB:?}" >>"$STATE/calls"
docker compose --project-directory "$out/src" -f "$out/src/docker-compose.yml" \
    up -d --no-build pimasi-server
DEPLOY
sandbox
fake_host
fake_tools

one=$(commit "chore: scaffold")
two=$(commit "feat: add login")
three=$(commit "fix: handle empty payload")
four=$(commit "feat(api): add export")
publish_main
git worktree add --quiet -b feature "$tmp/feature" HEAD
cd "$tmp/feature"
side=$(commit "feat: not merged")
cd "$tmp/repo"

marker() {
    cat "$STATE/marker-production" 2>/dev/null || true
}

prefix=$(printf 'registry.test/__APP_SLUG__' | tr '[:upper:]' '[:lower:]')
saved_state=$STATE
STATE=$tmp/first-state
export STATE
mkdir -p "$STATE"
check "a first-ever publication refusal exits zero" "0" "$(FAIL_TAG=1 promote production "$two")"
check "the first refusal has no baseline" "no-baseline" "$(outcome mode)"
first_notes=$(cat "$RELEASE_OUT/publication.md")
check "the first-ever retry can be refused again" "0" "$(FAIL_TAG=1 promote production "$two")"
check "repeated first-release failures keep the original notes" "$first_notes" "$(cat "$RELEASE_OUT/publication.md")"
check "a first-release retry eventually succeeds" "0" "$(promote production "$two")"
check "the first published object has the original no-baseline notes" "$first_notes" "$(cat "$STATE/release-2026-10-12.1.md")"
STATE=$saved_state
export STATE

check "first release exits zero" "0" "$(promote production "$two")"
check "first release succeeds" "succeeded" "$(outcome outcome)"
check "first release has no baseline" "no-baseline" "$(outcome mode)"
check "first release version" "2026-10-12.1" "$(outcome version)"
check "the live record points at the commit" "$two" "$(marker)"
contains "the gate uses current tooling" "make -C $RELEASE_OUT/src -f $release/../../release.mk ci at $two" "$(calls)"
contains "the server image has the commit tag" "-t $prefix/production/pimasi-server:$(printf '%.12s' "$two")" "$(calls)"
contains "the web image has the commit tag" "/production/pimasi-web:$(printf '%.12s' "$two")" "$(calls)"
contains "the build receives the commit" "--build-arg GIT_SHA=$two" "$(calls)"
contains "the deploy seam receives the exact promotion and both images" "deploy production $two 2026-10-12.1 images $prefix/production/pimasi-server:$(printf '%.12s' "$two") $prefix/production/pimasi-web:$(printf '%.12s' "$two")" "$(calls)"
check "the tag is published at the commit" "$two" "$(git ls-remote --tags origin refs/tags/2026-10-12.1 | cut -f1)"
contains "the summary carries the notes" "No trusted previous release" "$(cat "$RELEASE_OUT/summary.md")"
contains "the smoke result is honest" "images pushed and smoke-tested; no deploy target is configured" "$(cat "$RELEASE_OUT/summary.md")"
check "the output directory ignores itself" "*" "$(cat "$RELEASE_OUT/.gitignore")"

: >"$STATE/calls"
check "second release exits zero" "0" "$(promote production "$four")"
check "second release is a range" "range" "$(outcome mode)"
check "the baseline is the previous record" "$two" "$(outcome base)"
check "the live record advances" "$four" "$(marker)"
notes=$(cat "$RELEASE_OUT/notes.md")
contains "the notes cover the range" "(2 commits)" "$notes"
contains "the notes list the fix" "handle empty payload" "$notes"
contains "the notes list the feature" "api: add export" "$notes"
lacks "the notes skip what was already live" "add login" "$notes"
check "the canonical release body equals the deterministic notes" "$notes" "$(cat "$STATE/release-2026-10-12.2.md")"

: >"$STATE/calls"
check "a redeploy exits zero" "0" "$(promote production "$four")"
check "a redeploy is classified" "same" "$(outcome mode)"
contains "a redeploy says so" "Redeploy of" "$(cat "$RELEASE_OUT/notes.md")"
lacks "a redeploy does not publish again" "host release-publish" "$(calls)"
contains "a redeploy still deploys" "up -d --no-build pimasi-server" "$(calls)"

: >"$STATE/calls"
check "a rollback exits zero" "0" "$(promote production "$two")"
check "a rollback is classified" "rollback" "$(outcome mode)"
check "a rollback reproduces the old version" "2026-10-12.1" "$(outcome version)"
check "the live record moves back" "$two" "$(marker)"
contains "a rollback lists what is removed" "(2 commits removed)" "$(cat "$RELEASE_OUT/notes.md")"
lacks "a rollback does not publish again" "host release-publish" "$(calls)"

: >"$STATE/calls"
check "an unhealthy deploy exits non-zero" "1" "$(STALE_DEPLOY=1 promote production "$three")"
check "an unhealthy deploy fails" "failed" "$(outcome outcome)"
check "an unhealthy deploy names the stage" "health" "$(outcome stage)"
check "an unhealthy deploy leaves the record" "$two" "$(marker)"
lacks "an unhealthy deploy records nothing" "host marker-write" "$(calls)"
contains "an unhealthy deploy is reported" "failed at health" "$(cat "$RELEASE_OUT/summary.md")"
contains "an unhealthy deploy tears down" "down -v" "$(calls)"

: >"$STATE/calls"
check "a failed gate exits non-zero" "1" "$(FAIL_GATE=1 promote production "$three")"
check "a failed gate names the stage" "gate" "$(outcome stage)"
lacks "a failed gate builds nothing" "docker build" "$(calls)"
check "a failed gate leaves the record" "$two" "$(marker)"

: >"$STATE/calls"
check "a failed build exits non-zero" "1" "$(FAIL_BUILD=1 promote production "$three")"
check "a failed build names the stage" "build" "$(outcome stage)"
lacks "a failed build deploys nothing" "up -d" "$(calls)"

: >"$STATE/calls"
check "a failed deploy exits non-zero" "1" "$(FAIL_DEPLOY=1 promote production "$three")"
check "a failed deploy names the stage" "deploy" "$(outcome stage)"
check "a failed deploy leaves the record" "$two" "$(marker)"

: >"$STATE/calls"
check "an unreadable record exits non-zero" "1" "$(FAIL_READ=1 promote production "$three")"
check "an unreadable record names the stage" "baseline" "$(outcome stage)"
lacks "an unreadable record builds nothing" "docker build" "$(calls)"

: >"$STATE/calls"
check "a failed record write exits non-zero" "1" "$(FAIL_RECORD=1 promote production "$three")"
check "a failed record write names the stage" "record" "$(outcome stage)"
check "a failed record write leaves the record" "$two" "$(marker)"

: >"$STATE/calls"
check "a failed success status exits non-zero" "1" "$(FAIL_STATUS=1 promote production "$three")"
check "a failed status names the stage" "record" "$(outcome stage)"
check "a failed status leaves the live record" "$two" "$(marker)"
check "a half-written record is absent from the history" "0" "$(sh "$RELEASE_HOST_ADAPTER" marker-list production | jq --arg sha "$three" '[.[] | select(.sha == $sha)] | length')"

: >"$STATE/calls"
check "a refused tag does not fail the run" "0" "$(FAIL_TAG=1 promote production "$three")"
check "a refused tag reports incomplete publication" "succeeded, publication incomplete" "$(outcome outcome)"
check "unhealthy attempts consume no counter" "2026-10-12.3" "$(outcome version)"
check "a refused tag still records" "$three" "$(marker)"
original=$(cat "$RELEASE_OUT/publication.md")
check "a repeated refusal does not fail" "0" "$(FAIL_TAG=1 promote production "$three")"
check "publication retry keeps the assigned version" "2026-10-12.3" "$(outcome version)"
check "a repeated refusal preserves the original notes" "$original" "$(cat "$RELEASE_OUT/publication.md")"
check "a release refusal after creating its tag does not fail" "0" "$(FAIL_PUBLISH=1 promote production "$three")"
check "a tag is not mistaken for publication" "succeeded, publication incomplete" "$(outcome outcome)"
check "the tag exists without a release" "$three" "$(git ls-remote --tags origin refs/tags/2026-10-12.3 | cut -f1)"
check "retry with the tag already present succeeds" "0" "$(promote production "$three")"
check "retry publishes original range notes" "$original" "$(cat "$STATE/release-2026-10-12.3.md")"
contains "publication retries keep the original change" "handle empty payload" "$(cat "$STATE/release-2026-10-12.3.md")"
lacks "publication retries do not become redeploy notes" "Redeploy" "$(cat "$STATE/release-2026-10-12.3.md")"

rm "$STATE/release-2026-10-12.1.md"
check "rollback publication can be refused" "0" "$(FAIL_PUBLISH=1 promote production "$two")"
check "rollback publication retry succeeds" "0" "$(promote production "$two")"
contains "first-release retry retains no-baseline notes" "No trusted previous release" "$(cat "$STATE/release-2026-10-12.1.md")"
lacks "an old release never receives the retry rollback notes" "Rollback" "$(cat "$STATE/release-2026-10-12.1.md")"

check "a never-published rollback target can be refused" "0" "$(FAIL_PUBLISH=1 promote production "$one")"
rollback_original=$(cat "$RELEASE_OUT/publication.md")
contains "first promotion during rollback has rollback notes" "(1 commits removed)" "$rollback_original"
check "retrying a first rollback publication succeeds" "0" "$(promote production "$one")"
check "first rollback publication notes are stable" "$rollback_original" "$(cat "$STATE/release-2026-10-12.4.md")"

: >"$STATE/calls"
check "a branch commit is rejected" "3" "$(promote production "$side")"
check "a rejection is recorded" "rejected" "$(outcome outcome)"
lacks "a rejection builds nothing" "docker build" "$(calls)"
check "a rejection leaves the record" "$one" "$(marker)"
check "an unknown environment is rejected" "3" "$(promote uat "$four")"
check "an unknown environment reports rejection" "rejected" "$(outcome outcome)"

mkdir -p "$tmp/alt"
cp -R "$release/." "$tmp/alt/"
printf 'RELEASE_PUBLISH=false\nRELEASE_HEALTH_URL=\nVITE_API_URL=https://api.uat.test\n' >"$tmp/alt/environments/uat.env"
printf 'RELEASE_PUBLISH=true\nRELEASE_AFTER=uat\n' >"$tmp/alt/environments/production.env"
release=$tmp/alt
: >"$STATE/calls"
check "production requires a uat record" "3" "$(promote production "$two")"
check "missing uat builds nothing" "" "$(calls | grep 'docker build' || true)"
check "missing uat leaves production alone" "$one" "$(marker)"
check "adding uat needs one file" "0" "$(promote uat "$three")"
check "uat assigns no version" "" "$(outcome version)"
contains "uat labels its build by commit" "APP_VERSION=sha-$(printf '%.12s' "$three")" "$(calls)"
lacks "uat never asks for version tags" "host tag-list" "$(calls)"
check "uat records the candidate" "$three" "$(cat "$STATE/marker-uat")"
check "uat leaves production alone" "$one" "$(marker)"
contains "web build arguments come from the environment" "--build-arg VITE_API_URL=https://api.uat.test" "$(calls)"
lacks "uat never publishes" "host release-publish" "$(calls)"

: >"$STATE/calls"
check "production refuses a commit ahead of uat" "3" "$(promote production "$four")"
check "the refusal is rejected" "rejected" "$(outcome outcome)"
lacks "the refusal builds nothing" "docker build" "$(calls)"
check "refusal leaves both records unchanged" "$one $three" "$(marker) $(cat "$STATE/marker-uat")"

check "production accepts an ancestor of uat" "0" "$(promote production "$two")"
check "accepted promotion updates only production" "$two $three" "$(marker) $(cat "$STATE/marker-uat")"
check "production uses its own baseline" "$one" "$(outcome base)"
contains "production notes use their own range" "add login" "$(cat "$RELEASE_OUT/notes.md")"
lacks "uat's newer change is absent" "handle empty payload" "$(cat "$RELEASE_OUT/notes.md")"
check "production accepts uat's exact SHA" "0" "$(promote production "$three")"
check "the equal-SHA promotion keeps uat unchanged" "$three $three" "$(marker) $(cat "$STATE/marker-uat")"

mkdir -p "$tmp/independent"
cp -R "$release/." "$tmp/independent/"
printf 'RELEASE_PUBLISH=true\nRELEASE_HEALTH_URL=\n' >"$tmp/independent/environments/production.env"
printf 'RELEASE_PUBLISH=false\nRELEASE_HEALTH_URL=\n' >"$tmp/independent/environments/dev.env"
release=$tmp/independent
saved_state=$STATE
for order in dev-first production-first; do
    STATE=$tmp/$order
    export STATE
    mkdir -p "$STATE"
    sh "$RELEASE_HOST_ADAPTER" marker-write production "$one" 2026-10-12.4
    sh "$RELEASE_HOST_ADAPTER" marker-write dev "$two" ""
    if [ "$order" = dev-first ]; then
        environments="dev production"
    else
        environments="production dev"
    fi
    for environment in $environments; do
        if [ "$environment" = dev ]; then
            peer=production
            baseline=$two
            candidate=$four
        else
            peer=dev
            baseline=$one
            candidate=$three
        fi
        peer_marker=$(cat "$STATE/marker-$peer")
        peer_records=$(sh "$RELEASE_HOST_ADAPTER" marker-list "$peer")
        : >"$STATE/calls"
        check "$order: $environment promotes independently" "0" "$(promote "$environment" "$candidate")"
        check "$order: $environment records its candidate" "$candidate" "$(cat "$STATE/marker-$environment")"
        check "$order: $environment leaves $peer live record unchanged" "$peer_marker" "$(cat "$STATE/marker-$peer")"
        check "$order: $environment leaves $peer history unchanged" "$peer_records" "$(sh "$RELEASE_HOST_ADAPTER" marker-list "$peer")"
        check "$order: $environment uses its own baseline" "$baseline" "$(outcome base)"
        check "$order: $environment has range notes" "range" "$(outcome mode)"
        notes=$(cat "$RELEASE_OUT/notes.md")
        contains "$order: $environment notes include its new fix" "handle empty payload" "$notes"
        contains "$order: $environment notes count its own range" "(2 commits)" "$notes"
        if [ "$environment" = dev ]; then
            contains "$order: dev notes include its newer feature" "api: add export" "$notes"
            lacks "$order: dev notes exclude its own baseline" "add login" "$notes"
            lacks "$order: dev never publishes releases" "host release-publish" "$(calls)"
        else
            contains "$order: production notes include its earlier feature" "add login" "$notes"
            lacks "$order: production notes exclude dev's newer change" "api: add export" "$notes"
        fi
    done
done
STATE=$saved_state
export STATE
check "mock promotions never call the outer deploy seam" "absent" "$(if [ -f "$STATE/outer-deploy-called" ]; then printf called; else printf absent; fi)"

: >"$STATE/calls"
check "a failed release lookup keeps deployment successful" 0 "$(FAIL_RELEASE_READ=1 promote production "$four")"
check "a failed release lookup reports incomplete publication" 'succeeded, publication incomplete' "$(outcome outcome)"
lacks "a failed release lookup never publishes" 'host release-publish' "$(calls)"

savedPublish=$tmp/saved-publish.sh
cp "$release/publish.sh" "$savedPublish"
cat >"$release/publish.sh" <<'PUBLISH'
#!/bin/sh
kill -TERM "$PPID"
sleep 0.1
PUBLISH
check "interruption after recording keeps its signal status" 143 "$(promote production "$two")"
check "interruption after recording preserves a truthful outcome" 'succeeded, publication incomplete' "$(outcome outcome)"
check "interrupted publication leaves the new live record" "$two" "$(marker)"
lacks "interrupted publication never claims an unchanged record" 'The live record is unchanged' "$(cat "$RELEASE_OUT/summary.md")"
cp "$savedPublish" "$release/publish.sh"

: >"$STATE/calls"
check "unavailable readiness fails promotion" 1 "$(FAIL_READINESS=1 promote production "$three")"
check "unavailable readiness fails at health" health "$(outcome stage)"
check "unavailable readiness leaves the live record" "$two" "$(marker)"
contains "unavailable readiness is named" readiness "$(cat "$tmp/promote.log")"
lacks "unavailable readiness never writes a record" 'host marker-write' "$(calls)"


check "gate receives the current tooling directory" "$release" "$(cat "$STATE/gate-tools")"
cp "$release/notes-ai.sh" "$tmp/saved-notes-ai.sh"
cat >"$release/notes-ai.sh" <<'NOTES'
#!/bin/sh
sh "$(dirname -- "$0")/notes.sh" "$@"
printf '\nModel summary is selected.\n'
NOTES
check "promotion accepts the optional model summary" 0 "$(promote production "$four")"
contains "promotion reports the optional model summary" 'Model summary is selected.' "$(cat "$RELEASE_OUT/summary.md")"
cp "$tmp/saved-notes-ai.sh" "$release/notes-ai.sh"
unsafeEnvironment=$(printf 'bad\047$(touch %s/promotion-owned)' "$tmp")
check "unsafe environment is rejected" 3 "$(promote "$unsafeEnvironment" "$two")"
check "unsafe outcome fields remain data" "$unsafeEnvironment" "$(outcome environment)"
check "unsafe outcome fields never execute" no "$(if [ -f "$tmp/promotion-owned" ]; then printf yes; else printf no; fi)"

savedDeploy=$tmp/saved-deploy.sh
cp "$release/deploy.sh" "$savedDeploy"
cat >>"$release/deploy.sh" <<'DEPLOY'
printf '%s' "${DEPLOY_PASSWORD:-}" >"$STATE/deploy-password"
printf '%s' "${DEPLOY_REGION:-}" >"$STATE/deploy-region"
DEPLOY
RELEASE_DEPLOY_SECRETS_JSON='{"DEPLOY_PASSWORD":"a secret with quotes '\'' and $(touch ignored)","DEPLOY_REGION":"secret-region"}'
RELEASE_DEPLOY_VARS_JSON='{"DEPLOY_REGION":"public-region","DEPLOY_ONLY_VAR":"value"}'
export RELEASE_DEPLOY_SECRETS_JSON RELEASE_DEPLOY_VARS_JSON
check "project credentials reach the deploy seam" 0 "$(GITHUB_TOKEN=gate-token RELEASE_TOKEN=gate-release-token RELEASE_WEBHOOK_URL=http://127.0.0.1:1/gate-webhook ANTHROPIC_API_KEY=gate-api-key ANTHROPIC_BASE_URL=http://127.0.0.1:1 promote production "$two")"
check "the deploy seam gets the exact secret" "a secret with quotes ' and \$(touch ignored)" "$(cat "$STATE/deploy-password")"
check "secrets take precedence over variables" secret-region "$(cat "$STATE/deploy-region")"
check "the gate sees no project credential payload" '' "$(cat "$STATE/gate-credentials")"
lacks "deploy credentials are never logged" 'a secret with quotes' "$(cat "$tmp/promote.log")"
unset RELEASE_DEPLOY_SECRETS_JSON RELEASE_DEPLOY_VARS_JSON
cp "$savedDeploy" "$release/deploy.sh"

saved_state=$STATE
STATE=$tmp/unpublished-uat
export STATE
mkdir -p "$STATE"
printf 'RELEASE_PUBLISH=false\nRELEASE_HEALTH_URL=\n' >"$release/environments/uat.env"
check "a never-published SHA deploys to uat" 0 "$(promote uat "$four")"
lacks "uat never attempts first publication" 'host release-publish' "$(calls)"
STATE=$saved_state
export STATE


printf 'RELEASE_PUBLISH=true\nRELEASE_HEALTH_URL=https://deployment.test/api\n' >"$release/environments/production.env"
cat >"$tmp/bin/curl" <<'CURL'
#!/bin/sh
case "$*" in
    */ready) printf 200 ;;
    *) jq -n --arg sha "$(cat "$STATE/live")" '{commit: $sha}' ;;
esac
CURL
chmod +x "$tmp/bin/curl"
check "a configured target passes both probes" 0 "$(promote production "$two")"
contains "a configured target gets deployment wording" 'Released 2026-10-12.1 to production' "$(cat "$RELEASE_OUT/summary.md")"
saved_state=$STATE
STATE=$tmp/race
export STATE
mkdir -p "$STATE"
five=$(commit "feat: race candidate")
six=$(commit "fix: another race candidate")
publish_main
check "a tag race retries successfully" 0 "$(RACE_SHA=$one promote production "$five")"
check "a race chooses the next counter" "2026-10-12.6" "$(outcome version)"
check "a race never moves the other commit tag" "$one" "$(git ls-remote --tags origin refs/tags/2026-10-12.5 | cut -f1)"
check "the retried tag belongs to the promoted commit" "$five" "$(git ls-remote --tags origin refs/tags/2026-10-12.6 | cut -f1)"
check "race retry rebuilds the deployed version" "2026-10-12.6" "$(cat "$STATE/live-version")"
check "race retry records the deployed version" "2026-10-12.6" "$(sh "$RELEASE_HOST_ADAPTER" marker-list production | jq -r '.[0].version')"
rm "$STATE/raced"
check "a second race stops after one retry" 0 "$(RACE_SHA=$one RACE_TWICE=1 promote production "$six")"
check "a second race reports incomplete publication" 'succeeded, publication incomplete' "$(outcome outcome)"
contains "a second race explains why it stopped" 'conflicted twice' "$(cat "$tmp/promote.log")"
STATE=$saved_state
export STATE
printf 'RELEASE_TIMEZONE=Unknown/Nowhere\n' >>"$release/config.sh"
: >"$STATE/calls"
check "an invalid timezone fails before building" 1 "$(promote production "$two")"
lacks "invalid timezone builds nothing" 'docker build' "$(calls)"
done_testing
