#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
. "$(dirname -- "$0")/http-stub.sh"
start_http_stub
sha=1234567890abcdef1234567890abcdef12345678
RELEASE_HEALTH_URL=$HTTP_STUB_URL
export RELEASE_HEALTH_URL

verify() {
    status=0
    sh "$release/verify.sh" "$sha" >"$tmp/verify.stdout" 2>"$tmp/verify.stderr" || status=$?
    printf '%s' "$status"
}

jq -n --arg sha "$sha" '{message: "pong", version: "0.4.0", commit: $sha}' >"$STATE/http-reply"
check "the exact running SHA passes health" "0" "$(verify)"
contains "the configured target is checked at ping" "GET /ping " "$(cat "$STATE/http-requests")"
contains "healthy output names the SHA" "$sha" "$(cat "$tmp/verify.stderr")"
RELEASE_HEALTH_URL=$HTTP_STUB_URL/
check "a trailing base URL slash is accepted" "0" "$(verify)"
contains "the trailing slash does not duplicate the path" "GET /ping " "$(cat "$STATE/http-requests")"
jq -n '{message: "pong", version: "0.4.0", commit: "another-commit"}' >"$STATE/http-reply"
check "a different commit fails health" "1" "$(verify)"
jq -n --arg sha "$sha" '{message: $sha, version: "0.4.0"}' >"$STATE/http-reply"
check "the SHA in another field cannot pass health" "1" "$(verify)"
jq -n --arg sha "$sha" '{commit: {value: $sha}}' >"$STATE/http-reply"
check "an object commit cannot pass health" "1" "$(verify)"
printf 'invalid JSON\n' >"$STATE/http-reply"
check "malformed JSON fails health" "1" "$(verify)"
jq -n --arg sha "$sha" '{commit: $sha}' >"$STATE/http-reply"
printf '500\n' >"$STATE/http-status"
check "HTTP failure cannot pass despite a matching body" "1" "$(verify)"
RELEASE_HEALTH_URL=http://127.0.0.1:1
check "a network failure fails health" "1" "$(verify)"

cat >"$tmp/bin/docker" <<'DOCKER'
#!/bin/sh
jq -cn --args '$ARGS.positional' -- "$@" >"$STATE/health-command.json"
case "$*" in
    */ready) printf 200 ;;
    *) cat "$STATE/smoke-reply.json" ;;
esac
DOCKER
chmod +x "$tmp/bin/docker"
unset RELEASE_HEALTH_URL
jq -n --arg sha "$sha" '{commit: $sha}' >"$STATE/smoke-reply.json"
check "an unset URL checks the smoke container" "0" "$(verify)"
check "smoke health uses docker exec" "exec" "$(jq -r '.[0]' "$STATE/health-command.json")"
check "smoke health selects the app server" "pimasi-server" "$(jq -r '.[1]' "$STATE/health-command.json")"
check "smoke health checks local readiness" "http://localhost:4000/ready" "$(jq -r '.[-1]' "$STATE/health-command.json")"
jq -n '{commit: "stale"}' >"$STATE/smoke-reply.json"
check "a stale smoke image fails health" "1" "$(verify)"

printf '200\n' >"$STATE/http-status"
jq -n --arg sha "$sha" '{commit: $sha}' >"$STATE/http-reply"
RELEASE_HEALTH_URL=$HTTP_STUB_URL
export RELEASE_HEALTH_URL
printf '503\n' >"$STATE/http-ready-status"
check "matching commit with unavailable readiness fails health" 1 "$(verify)"
contains "readiness failure names readiness" readiness "$(cat "$tmp/verify.stderr")"
printf '200\n' >"$STATE/http-ready-status"
check "matching commit with readiness passes health" 0 "$(verify)"
contains "readiness shares the configured base URL" 'GET /ready ' "$(cat "$STATE/http-requests")"


printf '1\n' >"$STATE/http-ready-pending"
RELEASE_HEALTH_TIMEOUT_OVERRIDE=5
check "readiness retries within the shared health deadline" 0 "$(verify)"
check "the delayed readiness check was attempted" 0 "$(cat "$STATE/http-ready-pending")"
done_testing
