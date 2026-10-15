start_http_stub() {
    cat >"$tmp/http-stub.sh" <<'STUB'
#!/bin/sh
set -eu
IFS= read -r request || exit 0
printf '%s\n' "$request" >"$STATE/http-headers"
printf '%s\n' "$request" >>"$STATE/http-requests"
length=0
while IFS= read -r line; do
    line=$(printf '%s' "$line" | tr -d '\r')
    [ -n "$line" ] || break
    printf '%s\n' "$line" >>"$STATE/http-headers"
    case "$line" in
        Content-Length:* | content-length:*) length=${line#*: } ;;
    esac
done
dd bs=1 count="$length" >"$STATE/http-body" 2>/dev/null
code=$(cat "$STATE/http-status")
case "$request" in
    'GET /ready '*)
        [ ! -f "$STATE/http-ready-status" ] || code=$(cat "$STATE/http-ready-status")
        if [ -f "$STATE/http-ready-pending" ]; then
            pending=$(cat "$STATE/http-ready-pending")
            if [ "$pending" -gt 0 ]; then
                code=503
                printf '%s\n' "$((pending - 1))" >"$STATE/http-ready-pending"
            fi
        fi
        ;;
esac
size=$(wc -c <"$STATE/http-reply")
printf 'HTTP/1.1 %s Stub\r\nContent-Type: application/json\r\nContent-Length: %s\r\nConnection: close\r\n\r\n' "$code" "$size"
cat "$STATE/http-reply"
STUB
    chmod +x "$tmp/http-stub.sh"
    printf '200\n' >"$STATE/http-status"
    jq -n '{}' >"$STATE/http-reply"
    busybox nc -lk -s 127.0.0.1 -p 18765 -e "$tmp/http-stub.sh" >"$tmp/http.log" 2>&1 &
    stubPid=$!
    trap 'kill "$stubPid" 2>/dev/null || true; wait "$stubPid" 2>/dev/null || true; rm -rf "$tmp"' 0
    stubAttempts=0
    until curl -fsS --max-time 1 "http://127.0.0.1:18765/ready" >/dev/null 2>&1; do
        stubAttempts=$((stubAttempts + 1))
        if [ "$stubAttempts" -ge 30 ]; then
            printf 'the local HTTP stub did not start\n' >&2
            exit 1
        fi
        sleep 0.1
    done
    HTTP_STUB_URL=http://127.0.0.1:18765
    export HTTP_STUB_URL
}
