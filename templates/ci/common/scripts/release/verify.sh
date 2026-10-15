#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

sha=$1
url=${RELEASE_HEALTH_URL:-}
timeout=${RELEASE_HEALTH_TIMEOUT_OVERRIDE:-$RELEASE_HEALTH_TIMEOUT}
interval=${RELEASE_HEALTH_INTERVAL_OVERRIDE:-$RELEASE_HEALTH_INTERVAL}
deadline=$(($(date +%s) + timeout))

probe() {
    remaining=$((deadline - $(date +%s)))
    if [ "$remaining" -le 0 ]; then
        [ "$timeout" -eq 0 ] || return 1
        remaining=1
    fi
    [ "$remaining" -lt 5 ] || remaining=5
    if [ -n "$url" ]; then
        curl -fsS --connect-timeout "$remaining" --max-time "$remaining" "$@" "${url%/}/$endpoint" 2>/dev/null
    else
        docker exec pimasi-server curl -fsS --max-time "$remaining" "$@" "http://localhost:4000/$endpoint" 2>/dev/null
    fi
}

while :; do
    endpoint=ping
    body=$(probe) || body=
    failure="the running commit is not $sha"
    if printf '%s' "$body" | jq -e --arg sha "$sha" '.commit == $sha' >/dev/null 2>&1; then
        endpoint=ready
        status=$(probe --output /dev/null --write-out '%{http_code}') || status=
        if [ "$status" = 200 ]; then
            say "healthy: the running commit is $sha and readiness passed"
            exit 0
        fi
        failure="readiness did not return HTTP 200"
    fi
    [ "$(date +%s)" -lt "$deadline" ] || die "health check failed: $failure after ${timeout}s"
    remaining=$((deadline - $(date +%s)))
    delay=$interval
    [ "$delay" -le "$remaining" ] || delay=$remaining
    sleep "$delay"
done
