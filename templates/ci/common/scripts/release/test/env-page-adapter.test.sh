#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
unset RELEASE_HOST_ADAPTER RELEASE_TOKEN
mkdir -p "$STATE/api/tags" "$STATE/api/releases"
cp "$release/test/stateful-curl.sh" "$tmp/bin/curl"
chmod +x "$tmp/bin/curl"
if grep -q GITHUB_REPOSITORY "$release/host.sh"; then
    ADAPTER_HOST=github
else
    ADAPTER_HOST=gitlab
fi
GITHUB_TOKEN=page-default-token
RELEASE_TOKEN=page-release-token
GITHUB_REPOSITORY=Acme/Shop
GITHUB_API_URL=https://api.github.test
CI_JOB_TOKEN=page-job-token
CI_API_V4_URL=https://gitlab.test/api/v4
CI_PROJECT_ID=12
export ADAPTER_HOST GITHUB_TOKEN RELEASE_TOKEN GITHUB_REPOSITORY GITHUB_API_URL
export CI_JOB_TOKEN CI_API_V4_URL CI_PROJECT_ID
sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
later=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
key=changelog%2Fproduction
statusOf() {
    result=0
    "$@" >"$tmp/result" 2>"$tmp/error" || result=$?
    printf '%s' "$result"
}

check "environment page absent is a successful empty read" 0 "$(statusOf sh "$release/host.sh" env-page-read production)"
check "environment page absent prints no bytes" 0 "$(wc -c <"$tmp/result" | tr -d ' ')"
printf '## 2026-10-12.1 · 12-10-2026 12:00 UTC\n\nA quoted "change" \\ here.\n\n' >"$tmp/page.md"
check "environment page is created through the real adapter" 0 "$(statusOf sh "$release/host.sh" env-page-write production "$tmp/page.md" "$sha")"
check "environment page tag is anchored to its first commit" "$sha" "$(cat "$STATE/api/tags/$key" 2>/dev/null || true)"
check "environment page has its app and environment title" '__APP_SLUG__ changelog (production)' "$(jq -r '.name // ""' "$STATE/api/releases/$key.json" 2>/dev/null || true)"
if [ "$ADAPTER_HOST" = github ]; then
    check "a new environment page never takes the Latest badge" false "$(jq -r '.make_latest // "missing"' "$STATE/api/release-write-body")"
fi
check "environment page body preserves JSON text and trailing newlines" true "$(cmp -s "$tmp/page.md" "$STATE/api/releases/$key.md" && printf true || printf false)"
check "environment page body can be read exactly" 0 "$(statusOf sh "$release/host.sh" env-page-read production)"
check "environment page read preserves every byte" true "$(cmp -s "$tmp/page.md" "$tmp/result" && printf true || printf false)"
printf 'Original version notes\n' >"$tmp/version.md"
sh "$release/host.sh" release-publish 2026-10-12.1 "$sha" "$tmp/version.md"
printf '## 2026-10-12.2 · 12-10-2026 13:00 UTC\n\nNew notes.\n\n' >"$tmp/updated.md"
cat "$tmp/page.md" >>"$tmp/updated.md"
if [ "$ADAPTER_HOST" = github ]; then
    updateMethod=PATCH
    wrongMethod=PUT
    updateUrl=$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/releases/$(jq -r .id "$STATE/api/releases/$key.json")
    readUrl=$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/releases/tags/$key
else
    updateMethod=PUT
    wrongMethod=PATCH
    updateUrl=$CI_API_V4_URL/projects/$CI_PROJECT_ID/releases/$key
    readUrl=$updateUrl
fi
jq -n --rawfile body "$tmp/updated.md" '{name: "Wrong method", body: $body, description: $body}' >"$tmp/wrong-method.json"
check "the host double refuses the other host's update method" 405 "$(curl -sS -X "$wrongMethod" -o "$tmp/refused" -w '%{http_code}' --data-binary "@$tmp/wrong-method.json" "$updateUrl")"
check "a refused update method preserves the page" true "$(cmp -s "$tmp/page.md" "$STATE/api/releases/$key.md" && printf true || printf false)"
: >"$STATE/api/calls"
check "environment page is updated through the real adapter" 0 "$(statusOf sh "$release/host.sh" env-page-write production "$tmp/updated.md" "$later")"
check "environment page update retains the first tag commit" "$sha" "$(cat "$STATE/api/tags/$key" 2>/dev/null || true)"
check "environment page update replaces the body exactly" true "$(cmp -s "$tmp/updated.md" "$STATE/api/releases/$key.md" && printf true || printf false)"
check "environment page update preserves the real version release and its first notes" true "$(jq -e '.tag_name == "2026-10-12.1"' "$STATE/api/releases/2026-10-12.1.json" >/dev/null && cmp -s "$tmp/version.md" "$STATE/api/releases/2026-10-12.1.md" && printf true || printf false)"
check "environment page update only reads and updates its release" "$(printf 'GET %s\n%s %s' "$readUrl" "$updateMethod" "$updateUrl")" "$(cat "$STATE/api/calls")"
check "refused environment page reads remain errors" 2 "$(REFUSE_ENV_PAGE_READ=1 statusOf sh "$release/host.sh" env-page-read production)"
check "refused environment page updates remain errors" 2 "$(REFUSE_ENV_PAGE_WRITE=1 statusOf sh "$release/host.sh" env-page-write production "$tmp/page.md" "$later")"
check "refused environment page update preserves the body" true "$(cmp -s "$tmp/updated.md" "$STATE/api/releases/$key.md" && printf true || printf false)"
check "refused environment page creation remains an error" 2 "$(REFUSE_ENV_PAGE_WRITE=1 statusOf sh "$release/host.sh" env-page-write dev "$tmp/page.md" "$later")"
printf '%s\n' "$sha" >"$STATE/api/tags/changelog%2Fuat"
check "an orphan environment tag is adopted at its original commit" 0 "$(statusOf sh "$release/host.sh" env-page-write uat "$tmp/page.md" "$later")"
check "an adopted environment tag stays untouched" "$sha" "$(cat "$STATE/api/tags/changelog%2Fuat")"
check "an adopted environment tag receives the page body" true "$(cmp -s "$tmp/page.md" "$STATE/api/releases/changelog%2Fuat.md" && printf true || printf false)"
check "an orphan page release names the original tag commit" "$sha" "$(jq -r '.ref // .target_commitish' "$STATE/api/release-write-body")"
if [ "$ADAPTER_HOST" = gitlab ]; then
    : >"$STATE/api/calls"
    check "a successful page create cannot conceal a tag at another commit" 2 "$(ENV_PAGE_CREATED_TAG_SHA=$sha statusOf sh "$release/host.sh" env-page-write qa "$tmp/page.md" "$later")"
    check "a page create verifies its tag after the host responds" 2 "$(awk '/GET .*\/repository\/tags\/changelog%2Fqa$/ { count++ } END { print count + 0 }' "$STATE/api/calls")"
fi
check "non-publishing environments also receive a page" 0 "$(statusOf sh "$release/host.sh" env-page-write dev "$tmp/page.md" "$later")"
check "environment page tags are independent" "$later" "$(cat "$STATE/api/tags/changelog%2Fdev" 2>/dev/null || true)"
if [ "$ADAPTER_HOST" = github ]; then
    contains "environment page reads and writes use the release token" 'Authorization: Bearer page-release-token' "$(cat "$STATE/api/headers")"
    lacks "environment page reads and writes do not fall back with a release token" 'page-default-token' "$(cat "$STATE/api/headers")"
else
    contains "environment page reads and writes use the job token" 'JOB-TOKEN: page-job-token' "$(cat "$STATE/api/headers")"
fi

rm "$tmp/bin/curl"
. "$release/test/http-stub.sh"
start_http_stub
GITHUB_API_URL=$HTTP_STUB_URL
CI_API_V4_URL=$HTTP_STUB_URL
export GITHUB_API_URL CI_API_V4_URL
jq -n --rawfile body "$tmp/updated.md" '{id: 17, tag_name: "changelog/production", body: $body, description: $body}' >"$STATE/http-reply"
check "HTTP environment page read succeeds" 0 "$(statusOf sh "$release/host.sh" env-page-read production)"
check "HTTP environment page read preserves every byte" true "$(cmp -s "$tmp/updated.md" "$tmp/result" && printf true || printf false)"
contains "HTTP environment tag slash is encoded" 'changelog%2Fproduction' "$(cat "$STATE/http-headers")"
check "HTTP environment page update succeeds" 0 "$(statusOf sh "$release/host.sh" env-page-write production "$tmp/page.md" "$later")"
if [ "$ADAPTER_HOST" = github ]; then
    httpUpdatePath=/repos/Acme/Shop/releases/17
else
    httpUpdatePath=/projects/12/releases/$key
fi
check "HTTP environment page uses the host's update method and release path" "$updateMethod $httpUpdatePath HTTP/1.1" "$(jq -rs '.[-1].request | rtrimstr("\r")' "$STATE/http-history")"
check "HTTP environment page update sends the exact plain body" true "$(jq --rawfile body "$tmp/page.md" '(.body // .description) == $body' "$STATE/http-body")"
jq -n '{tag_name: "wrong", body: "text", description: "text"}' >"$STATE/http-reply"
check "HTTP environment page rejects a different tag" 2 "$(statusOf sh "$release/host.sh" env-page-read production)"
jq -n '{tag_name: "changelog/production", body: [], description: []}' >"$STATE/http-reply"
check "HTTP environment page rejects malformed body data" 2 "$(statusOf sh "$release/host.sh" env-page-read production)"
printf '403\n' >"$STATE/http-status"
check "HTTP environment page refuses forbidden reads" 2 "$(statusOf sh "$release/host.sh" env-page-read production)"
printf '404\n' >"$STATE/http-status"
check "HTTP missing environment page is distinct from refusal" 0 "$(statusOf sh "$release/host.sh" env-page-read production)"
check "HTTP missing environment page has no body" 0 "$(wc -c <"$tmp/result" | tr -d ' ')"
if [ "$ADAPTER_HOST" = github ]; then
    contains "HTTP environment pages authenticate with the release token" 'Authorization: Bearer page-release-token' "$(cat "$STATE/http-history")"
else
    contains "HTTP environment pages authenticate with the job token" 'JOB-TOKEN: page-job-token' "$(cat "$STATE/http-history")"
fi

done_testing
