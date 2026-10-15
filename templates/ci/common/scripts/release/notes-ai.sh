#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

initialise_output
umask 077
notesDir=$(mktemp -d "$out/notes-ai.XXXXXX")
trap 'rm -rf "$notesDir"' 0
trap 'exit 130' INT
trap 'exit 143' TERM
sh "$here/notes.sh" "${1:-}" "${2:-}" >"$notesDir/plain.md"

fallback() {
    say "warning: model notes skipped: $1"
    cat "$notesDir/plain.md"
    exit 0
}

[ -n "${ANTHROPIC_API_KEY:-}" ] || fallback "ANTHROPIC_API_KEY is not set"
jq -n --arg model "${RELEASE_NOTES_MODEL:-claude-opus-5-5}" \
    --rawfile system "$here/notes-style.md" --rawfile notes "$notesDir/plain.md" \
    '{model: $model, max_tokens: 16000, fallbacks: "default", system: $system, messages: [{role: "user", content: $notes}]}' >"$notesDir/request.json"

printf 'x-api-key: %s\n' "$ANTHROPIC_API_KEY" >"$notesDir/headers"
status=$(curl -sS --connect-timeout 10 --max-time 180 \
    -H "content-type: application/json" \
    -H "@$notesDir/headers" \
    -H "anthropic-version: 2023-06-01" \
    -H "anthropic-beta: server-side-fallback-2026-07-01" \
    --data-binary "@$notesDir/request.json" \
    --output "$notesDir/response.json" --write-out "%{http_code}" \
    "${ANTHROPIC_BASE_URL:-https://api.anthropic.com}/v1/messages") || fallback "the request failed"
[ "$status" = 200 ] || fallback "the API returned HTTP $status"
jq -er 'select(.stop_reason == "end_turn") | [.content[] | select(.type == "text") | .text] | join("\n") | select(test("\\S"))' \
    "$notesDir/response.json" >"$notesDir/reply.md" 2>/dev/null || fallback "the reply was incomplete or empty"
jq -e -n --rawfile plain "$notesDir/plain.md" --rawfile reply "$notesDir/reply.md" \
    '[$plain | scan("\\b[0-9a-f]{7,40}\\b")] | all(.[]; . as $hash | $reply | contains($hash))' \
    >/dev/null || fallback "the reply dropped a commit hash"
cat "$notesDir/reply.md"
