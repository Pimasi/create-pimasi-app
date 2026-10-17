#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
. "$(dirname -- "$0")/http-stub.sh"
sandbox
start_http_stub
REAL_CURL=$(command -v curl)
export REAL_CURL
cat >"$tmp/bin/curl" <<'CURL'
#!/bin/sh
printf '%s\n' "$*" >>"$STATE/curl-arguments"
exec "$REAL_CURL" "$@"
CURL
chmod +x "$tmp/bin/curl"

base=$(commit "chore: scaffold")
commit "fix(api): retain the original payload" >/dev/null
head=$(commit "feat(web): add export")
plain=$(sh "$release/notes.sh" "$base" "$head")
sh "$release/notes.sh" "$base" "$head" >"$tmp/plain.md"
unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL RELEASE_NOTES_MODEL

ai_notes() {
    sh "$release/notes-ai.sh" "$base" "$head" 2>"$tmp/ai.log"
}

check "no key returns deterministic notes" "$plain" "$(ai_notes)"
contains "no key warns" "ANTHROPIC_API_KEY is not set" "$(cat "$tmp/ai.log")"
contains "no key makes no model request" "GET /ready" "$(cat "$STATE/http-headers")"

ANTHROPIC_API_KEY=local-test-key
ANTHROPIC_BASE_URL=$HTTP_STUB_URL
export ANTHROPIC_API_KEY ANTHROPIC_BASE_URL
rewritten=$(printf '%s\n' "$plain" | sed 's/add export/Export data/')
jq -n --arg reply "$rewritten" '{stop_reason: "end_turn", content: [{type: "text", text: $reply}, {type: "tool_use", name: "ignored"}]}' >"$STATE/http-reply"
check "a complete model reply is used" "$rewritten" "$(ai_notes)"
check "a model reply never replaces the stored plain notes" "$plain" "$(cat "$RELEASE_OUT/notes-plain.md")"
headers=$(cat "$STATE/http-headers")
contains "the messages endpoint is used" "POST /v1/messages" "$headers"
contains "the API key is sent" "x-api-key: local-test-key" "$headers"
contains "the API version is sent" "anthropic-version: 2023-06-01" "$headers"
contains "the fallback beta is sent" "anthropic-beta: server-side-fallback-2026-07-01" "$headers"
contains "JSON content type is sent" "content-type: application/json" "$headers"
check "the default model is sent" "claude-opus-5-5" "$(jq -r .model "$STATE/http-body")"
check "the token limit is sent" "16000" "$(jq -r .max_tokens "$STATE/http-body")"
check "server fallbacks are enabled" "default" "$(jq -r .fallbacks "$STATE/http-body")"
check "the style guide is sent exactly" "$(cat "$release/notes-style.md")" "$(jq -r .system "$STATE/http-body")"
check "the deterministic notes are sent exactly" "$plain" "$(jq -r '.messages[0].content' "$STATE/http-body")"
check "only the supported body keys are sent" "fallbacks,max_tokens,messages,model,system" "$(jq -r 'keys | join(",")' "$STATE/http-body")"
check "the message has only role and content" "content,role" "$(jq -r '.messages[0] | keys | join(",")' "$STATE/http-body")"
check "the sole message is a user message" "user" "$(jq -r '.messages | if length == 1 then .[0].role else "wrong count" end' "$STATE/http-body")"

RELEASE_NOTES_MODEL=custom-model ai_notes >/dev/null
check "the configured model is sent" "custom-model" "$(jq -r .model "$STATE/http-body")"
jq -n --arg reply "$rewritten" '{stop_reason: "end_turn", content: [{type: "text", text: "First block"}, {type: "text", text: $reply}]}' >"$STATE/http-reply"
check "text blocks are joined in order" "$(printf 'First block\n%s' "$rewritten")" "$(ai_notes)"

printf '500\n' >"$STATE/http-status"
check "HTTP 500 falls back" "$plain" "$(ai_notes)"
contains "HTTP failure warns" "HTTP 500" "$(cat "$tmp/ai.log")"
printf '201\n' >"$STATE/http-status"
check "any status other than 200 falls back" "$plain" "$(ai_notes)"
printf '200\n' >"$STATE/http-status"

for reason in refusal max_tokens tool_use; do
    jq -n --arg reason "$reason" --arg reply "$rewritten" '{stop_reason: $reason, content: [{type: "text", text: $reply}]}' >"$STATE/http-reply"
    check "$reason falls back" "$plain" "$(ai_notes)"
    contains "$reason warns" "warning:" "$(cat "$tmp/ai.log")"
done
for reply in "" "   " "No commit hashes remain"; do
    jq -n --arg reply "$reply" '{stop_reason: "end_turn", content: [{type: "text", text: $reply}]}' >"$STATE/http-reply"
    check "empty, blank or incomplete text falls back" "$plain" "$(ai_notes)"
    contains "unusable text warns" "warning:" "$(cat "$tmp/ai.log")"
done
jq -n '{stop_reason: "end_turn", content: [{type: "thinking", thinking: "No text"}]}' >"$STATE/http-reply"
check "a response with no text falls back" "$plain" "$(ai_notes)"
jq -n --arg reply "$(printf '%s\n' "$rewritten" | sed '/retain the original payload/d')" \
    '{stop_reason: "end_turn", content: [{type: "text", text: $reply}]}' >"$STATE/http-reply"
check "dropping just one commit falls back" "$plain" "$(ai_notes)"
contains "a dropped commit warns" "the reply dropped a commit hash" "$(cat "$tmp/ai.log")"
printf 'invalid JSON\n' >"$STATE/http-reply"
check "malformed JSON falls back" "$plain" "$(ai_notes)"
ANTHROPIC_BASE_URL=http://127.0.0.1:1
check "a network failure falls back" "$plain" "$(ai_notes)"
contains "a network failure warns" "the request failed" "$(cat "$tmp/ai.log")"
ANTHROPIC_BASE_URL=$HTTP_STUB_URL

inert=$(printf '%s\n$(touch %s/model-owned)\n' "$rewritten" "$tmp")
jq -n --arg reply "$inert" '{stop_reason: "end_turn", content: [{type: "text", text: $reply}]}' >"$STATE/http-reply"
check "model text remains data" "$inert" "$(ai_notes)"
check "model text cannot execute commands" "no" "$(if [ -e "$tmp/model-owned" ]; then printf yes; else printf no; fi)"
unset ANTHROPIC_API_KEY
sh "$release/notes-ai.sh" "$base" "$head" >"$tmp/fallback.md" 2>/dev/null
check "fallback preserves the deterministic file bytes" "0" "$(cmp "$tmp/plain.md" "$tmp/fallback.md" >/dev/null; printf '%s' "$?")"
lacks "credentials never appear in curl arguments" "local-test-key" "$(cat "$STATE/curl-arguments")"
done_testing
