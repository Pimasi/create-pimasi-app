set -eu
release_source=${RELEASE_UNDER_TEST:-$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)}
tmp=$(mktemp -d "${TMPDIR:-/tmp}/release-test.XXXXXX")
trap 'rm -rf "$tmp"' 0
release=$tmp/tooling/scripts/release
mkdir -p "$release"
cp -R "$release_source/." "$release/"
cat >"$release/deploy.sh" <<'DEPLOY'
#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"
initialise_output
docker compose --project-directory "$out/src" -f "$out/src/docker-compose.yml" \
    up -d --no-build pimasi-server
DEPLOY
cp "$release_source/../../release.mk" "$tmp/tooling/release.mk"
cp "$release_source/../../"docker-compose*.yml "$tmp/tooling/"
rm -rf "$release/environments"
mkdir -p "$release/environments"
cat >"$release/config.sh" <<'CONFIG'
RELEASE_TIMEZONE=UTC
RELEASE_MAIN=main
RELEASE_HEALTH_TIMEOUT=300
RELEASE_HEALTH_INTERVAL=5
RELEASE_NOTES_MODEL=${RELEASE_NOTES_MODEL:-claude-opus-5-5}
CONFIG
cat >"$release/environments/production.env" <<'ENVIRONMENT'
RELEASE_PUBLISH=true
RELEASE_HEALTH_URL=
VITE_API_URL=http://localhost:4000
NEXT_PUBLIC_API_URL=http://localhost:4000
ENVIRONMENT
RELEASE_NOW=1791806400
export RELEASE_NOW
checks=0
failures=0

STATE=$tmp/state
RELEASE_OUT=$tmp/out
RELEASE_HOST_ADAPTER=$tmp/host.sh
RELEASE_HEALTH_TIMEOUT_OVERRIDE=0
RELEASE_HEALTH_INTERVAL_OVERRIDE=0
export STATE RELEASE_OUT RELEASE_HOST_ADAPTER RELEASE_HEALTH_TIMEOUT_OVERRIDE RELEASE_HEALTH_INTERVAL_OVERRIDE
unset RELEASE_WEBHOOK_URL ANTHROPIC_API_KEY RELEASE_HEALTH_URL PR_TITLE CI_MERGE_REQUEST_TITLE 2>/dev/null || true
mkdir -p "$STATE" "$tmp/bin"
PATH=$tmp/bin:$PATH
export PATH

check() {
    checks=$((checks + 1))
    if [ "$2" = "$3" ]; then
        return 0
    fi
    failures=$((failures + 1))
    printf 'not ok: %s\n  expected: %s\n  actual:   %s\n' "$1" "$2" "$3" >&2
}

contains() {
    checks=$((checks + 1))
    case "$3" in
        *"$2"*) return 0 ;;
    esac
    failures=$((failures + 1))
    printf 'not ok: %s\n  expected to contain: %s\n  actual: %s\n' "$1" "$2" "$3" >&2
}

lacks() {
    checks=$((checks + 1))
    case "$3" in
        *"$2"*) ;;
        *) return 0 ;;
    esac
    failures=$((failures + 1))
    printf 'not ok: %s\n  expected not to contain: %s\n  actual: %s\n' "$1" "$2" "$3" >&2
}

done_testing() {
    printf '%s checks ' "$checks"
    [ "$failures" -eq 0 ] || {
        printf '%s of %s checks failed\n' "$failures" "$checks" >&2
        exit 1
    }
}

sandbox() {
    git init -q --bare -b main "$tmp/remote.git"
    git -C "$tmp/remote.git" config receive.advertisePushOptions true
    git init -q -b main "$tmp/repo"
    cd "$tmp/repo"
    git config user.name "Release Test"
    git config user.email "release-test@example.invalid"
    git config commit.gpgsign false
    git remote add origin "$tmp/remote.git"
    mkdir -p scripts/release
    printf 'RELEASE_TIMEZONE=UTC\n' >scripts/release/config.sh
    printf 'ci:\n\t@true\n' >Makefile
    printf 'JWT_SECRET="x"\n' >.env.example
    : >docker-compose.yml
    git add -A
}

commit() {
    printf '%s\n' "$1" >>"${COMMIT_FILE:-history.txt}"
    git add -A
    if [ -n "${2:-}" ]; then
        git commit -q -m "$1" -m "$2"
    else
        git commit -q -m "$1"
    fi
    git rev-parse HEAD
}

publish_main() {
    git push -q origin main
    git fetch -q origin
}

outcome() {
    (
        . "$RELEASE_OUT/outcome.env"
        case "$1" in
            outcome) printf '%s' "$outcome" ;;
            stage) printf '%s' "$stage" ;;
            environment) printf '%s' "$environment" ;;
            sha) printf '%s' "$sha" ;;
            version) printf '%s' "$version" ;;
            mode) printf '%s' "$mode" ;;
            base) printf '%s' "$base" ;;
        esac
    )
}

promote() {
    status=0
    printf '%s' "$STATE" >"$tmp/gate-state"
    printf '%s' "${FAIL_GATE:-}" >"$tmp/gate-failure"
    RELEASE_ENV=$1 RELEASE_SHA=$2 sh "$release/promote.sh" >"$tmp/promote.log" 2>&1 || status=$?
    printf '%s' "$status"
}

fake_host() {
    cat >"$tmp/host.sh" <<'HOST'
#!/bin/sh
set -eu
printf 'host %s\n' "$*" >>"$STATE/calls"
case "$1" in
    marker-read)
        [ -z "${FAIL_READ:-}" ] || exit 1
        cat "$STATE/marker-$2" 2>/dev/null || true
        ;;
    marker-list)
        [ -z "${FAIL_READ:-}" ] || exit 1
        if [ -f "$STATE/records-$2.json" ]; then
            jq '[.[] | select(.status == "success") | {id, sha, version}]' "$STATE/records-$2.json"
        elif [ -f "$STATE/marker-$2" ]; then
            jq -n --arg sha "$(cat "$STATE/marker-$2")" '[{id: 0, sha: $sha}]'
        else
            printf '[]\n'
        fi
        ;;
    marker-list-all | marker-history)
        [ -z "${FAIL_READ:-}" ] || exit 1
        for file in "$STATE"/records-*.json; do
            [ -f "$file" ] || continue
            environment=${file##*/records-}
            environment=${environment%.json}
            jq --arg environment "$environment" '.[] | select(.status == "success") | {id, sha, version, environment: $environment}' "$file"
        done | jq -s 'sort_by(.id) | reverse'
        ;;
    tag-list)
        git ls-remote --tags origin | jq -Rn '[inputs | split("\t") | {tag: (.[1] | sub("^refs/tags/"; "")), sha: .[0]}]'
        ;;
    marker-write)
        [ -z "${FAIL_RECORD:-}" ] || exit 1
        file=$STATE/records-$2.json
        if [ ! -f "$file" ]; then
            sh "$0" marker-list "$2" | jq 'map(. + {status: "success"})' >"$file.next"
            mv "$file.next" "$file"
        fi
        status=success
        [ -z "${FAIL_STATUS:-}" ] || status=pending
        id=$(cat "$STATE/record-sequence" 2>/dev/null || printf 0)
        id=$((id + 1))
        printf '%s\n' "$id" >"$STATE/record-sequence"
        jq --arg sha "$3" --arg status "$status" --arg version "${4:-}" --argjson id "$id" \
            '[{id: $id, sha: $sha, status: $status, version: $version}] + .' "$file" >"$file.next"
        mv "$file.next" "$file"
        [ "$status" = success ] || exit 1
        printf '%s\n' "$3" >"$STATE/marker-$2"
        ;;
    tag-read)
        git ls-remote --tags origin "refs/tags/$2" | cut -f1
        ;;
    release-exists)
        [ -z "${FAIL_RELEASE_READ:-}" ] || exit 2
        [ -f "$STATE/release-$2.md" ]
        ;;
    release-publish)
        [ -z "${FAIL_TAG:-}" ] || exit 1
        if [ -n "${RACE_SHA:-}" ] && { [ ! -f "$STATE/raced" ] || [ "${RACE_TWICE:-}" = 1 ]; }; then
            git push -q origin "$RACE_SHA:refs/tags/$2"
            : >"$STATE/raced"
        fi
        found=$(git ls-remote --tags origin "refs/tags/$2" | cut -f1)
        [ -z "$found" ] || [ "$found" = "$3" ] || exit 4
        git push -q origin "$3:refs/tags/$2"
        [ -z "${FAIL_PUBLISH:-}" ] || exit 1
        cp "$4" "$STATE/release-$2.md"
        ;;
    branch-read)
        git ls-remote --heads origin "refs/heads/$2" | awk -v ref="refs/heads/$2" '$2 == ref { print $1 }'
        ;;
    branch-create)
        [ -z "${FAIL_BRANCH_CREATE:-}" ] || exit 1
        found=$(sh "$0" branch-read "$2")
        if [ -z "$found" ]; then
            git push -q origin "$3:refs/heads/$2"
            printf 'host created %s at %s\n' "$2" "$3" >>"$STATE/calls"
        elif [ "$found" != "$3" ]; then
            printf 'release host: branch %s points at %s, not %s\n' "$2" "$found" "$3" >&2
            exit 4
        fi
        ;;
    branch-move)
        [ -z "${FAIL_BRANCH_MOVE:-}" ] || exit 1
        git push -q -f origin "$3:refs/heads/$2"
        ;;
    registry-login) ;;
    image-prefix) printf 'registry.test/__APP_SLUG__\n' ;;
    summary) cat "$2" >>"$STATE/summary" ;;
    title) printf '%s' "${CHANGE_TITLE:-}" ;;
    run-url) printf 'https://ci.test/runs/1\n' ;;
esac
HOST
}

fake_tools() {
    cat >"$tmp/bin/docker" <<'DOCKER'
#!/bin/sh
set -eu
printf 'docker %s\n' "$*" >>"$STATE/calls"
case "$1" in
    build)
        [ -z "${FAIL_BUILD:-}" ] || exit 1
        for word in "$@"; do
            case "$word" in
                APP_VERSION=*) printf '%s' "${word#APP_VERSION=}" >"$STATE/built-version" ;;
                GIT_SHA=*) printf '%s' "${word#GIT_SHA=}" >"$STATE/built" ;;
            esac
        done
        ;;
    compose)
        for word in "$@"; do
            case "$word" in
                --services) printf 'pimasi-server\npimasi-web\npimasi-mongo\npimasi-redis\n'; exit 0 ;;
                down) exit 0 ;;
            esac
        done
        [ -z "${FAIL_DEPLOY:-}" ] || exit 1
        [ -n "${STALE_DEPLOY:-}" ] || cp "$STATE/built" "$STATE/live"
        [ -n "${STALE_DEPLOY:-}" ] || cp "$STATE/built-version" "$STATE/live-version"
        ;;
    exec)
        case "$*" in
            */ready) [ -z "${FAIL_READINESS:-}" ] || exit 22; printf 200; exit 0 ;;
        esac
        jq -n --arg sha "$(cat "$STATE/live" 2>/dev/null || true)" '{message: "pong", version: "x", commit: $sha}'
        ;;
esac
DOCKER
    cat >"$tmp/bin/make" <<'MAKE'
#!/bin/sh
testRoot=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
STATE=$(cat "$testRoot/gate-state")
FAIL_GATE=$(cat "$testRoot/gate-failure")
printf 'make %s at %s\n' "$*" "$(git -C "$2" rev-parse HEAD)" >>"$STATE/calls"
printf '%s' "${RELEASE_TOOLS:-}" >"$STATE/gate-tools"
printf '%s%s%s%s%s%s%s%s' "${RELEASE_DEPLOY_SECRETS_JSON:-}" "${RELEASE_DEPLOY_VARS_JSON:-}" "${DEPLOY_PASSWORD:-}" "${DEPLOY_REGION:-}" "${GITHUB_TOKEN:-}" "${RELEASE_TOKEN:-}" "${RELEASE_WEBHOOK_URL:-}" "${ANTHROPIC_API_KEY:-}" >"$STATE/gate-credentials"
[ -z "${FAIL_GATE:-}" ] || exit 1
MAKE
    chmod +x "$tmp/bin/docker" "$tmp/bin/make"
}

fake_curl() {
    cat >"$tmp/bin/curl" <<'CURL'
#!/bin/sh
printf 'curl %s\n' "$*" >>"$STATE/calls"
for word in "$@"; do
    case "$word" in
        @-) cat >"$STATE/curl-body" ;;
    esac
done
[ -z "${CURL_FAIL:-}" ] || exit 22
cat "$STATE/curl-reply" 2>/dev/null || true
CURL
    chmod +x "$tmp/bin/curl"
}

calls() {
    cat "$STATE/calls" 2>/dev/null || true
}
