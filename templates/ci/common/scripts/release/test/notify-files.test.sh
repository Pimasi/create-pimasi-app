#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
umask 022
mkdir -p "$RELEASE_OUT"
cat >"$RELEASE_OUT/outcome.env" <<'OUTCOME'
outcome=succeeded
stage=done
environment=production
sha=abc123def456
version=2026-10-13.1
mode=range
health_url=
OUTCOME
cat >"$tmp/bin/curl" <<'CURL'
#!/bin/sh
set -eu
while [ "$#" -gt 0 ]; do
    case "$1" in
        --config)
            shift
            printf '%s' "$1" >"$STATE/notify-config"
            stat -c %a "$1" >"$STATE/notify-config-mode"
            stat -c %a "${1%/*}" >"$STATE/notify-directory-mode"
            ;;
        --data-binary)
            shift
            stat -c %a "${1#@}" >"$STATE/notify-body-mode"
            ;;
    esac
    shift
done
exit "${NOTIFY_CURL_STATUS:-0}"
CURL
chmod +x "$tmp/bin/curl"
RELEASE_WEBHOOK_URL=https://example.invalid/private-webhook-secret
export RELEASE_WEBHOOK_URL

notify() {
    status=0
    sh "$release/notify.sh" "$@" >"$tmp/notify.log" 2>&1 || status=$?
}

checkCleanup() {
    check "$1 removes the secret configuration" absent "$(if [ -e "$(cat "$STATE/notify-config")" ]; then printf present; else printf absent; fi)"
    check "$1 removes the secret directory" absent "$(if [ -d "$(dirname "$(cat "$STATE/notify-config")")" ]; then printf present; else printf absent; fi)"
}

notify
check "ordinary notification succeeds" 0 "$status"
check "the summary retains the caller's normal permissions" 644 "$(stat -c %a "$RELEASE_OUT/summary.md")"
check "the secret configuration is owner-only during the request" 600 "$(cat "$STATE/notify-config-mode")"
check "the request body is owner-only during the request" 600 "$(cat "$STATE/notify-body-mode")"
check "the secret directory is owner-only during the request" 700 "$(cat "$STATE/notify-directory-mode")"
checkCleanup "a successful notification"
lacks "the webhook secret is never printed" private-webhook-secret "$(cat "$tmp/notify.log")"

NOTIFY_CURL_STATUS=22
export NOTIFY_CURL_STATUS
notify
check "an ordinary webhook failure keeps the release outcome" 0 "$status"
checkCleanup "a failed notification"
notify --test
check "the strict webhook test reports request failure" 1 "$status"
check "the test summary retains the caller's normal permissions" 644 "$(stat -c %a "$RELEASE_OUT/notify-test.md")"
checkCleanup "a failed strict notification"
done_testing
