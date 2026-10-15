#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
unset RELEASE_HOST_ADAPTER RELEASE_TOKEN
mkdir -p "$STATE/fixtures"
cat >"$tmp/bin/curl" <<'CURL'
#!/bin/sh
set -eu
printf 'curl %s\n' "$*" >>"$STATE/calls"
[ -z "${CURL_FAIL:-}" ] || exit 7
method=GET
output=
body=
url=
while [ "$#" -gt 0 ]; do
    case "$1" in
        -X) method=$2; shift 2 ;;
        -o) output=$2; shift 2 ;;
        -H)
            case "$2" in
                @*) cat "${2#@}" >>"$STATE/headers"; printf '%s\n' "${2#@}" >>"$STATE/header-files" ;;
                *) printf '%s\n' "$2" >>"$STATE/headers" ;;
            esac
            shift 2
            ;;
        -w | --connect-timeout | --max-time) shift 2 ;;
        --data-binary) body=${2#@}; shift 2 ;;
        -sS) shift ;;
        *) url=$1; shift ;;
    esac
done
printf '%s %s\n' "$method" "$url" >>"$STATE/requests"
if [ "$url" = https://api.github.test/graphql ]; then
    page=$(jq -r '(.variables.cursor // "1") | tonumber' "$body")
    cp "$body" "$STATE/query-body"
    if [ -f "$STATE/fixtures/graphql-$page.json" ]; then
        count=$(cat "$STATE/graphql-count" 2>/dev/null || printf 0)
        count=$((count + 1))
        printf '%s' "$count" >"$STATE/graphql-count"
        if [ "$count" -gt 2 ]; then
            printf '{}\n' >"$output"
        else
            cat "$STATE/fixtures/graphql-$page.json" >"$output"
        fi
        printf 200
        exit 0
    fi
    if [ "$(cat "$STATE/fixtures/deployments-$page.status")" != 200 ]; then
        cat "$STATE/fixtures/deployments-$page.json" >"$output"
        cat "$STATE/fixtures/deployments-$page.status"
        exit 0
    fi
    : >"$STATE/nodes"
    if ! jq -e 'type == "array"' "$STATE/fixtures/deployments-$page.json" >/dev/null; then
        printf '{}\n' >"$output"
        printf 200
        exit 0
    fi
    jq -c 'sort_by(.created_at // .id) | reverse | .[]' "$STATE/fixtures/deployments-$page.json" | while IFS= read -r deployment; do
        id=$(printf '%s' "$deployment" | jq -r .id)
        state=$(cat "$STATE/fixtures/statuses-$id-"*.json 2>/dev/null | jq -sr '(add // []) | max_by(.id).state // ""' || true)
        printf '%s' "$deployment" | jq -c --arg state "$state" '{id: (.node_id // ("D_" + (.id | tostring))), databaseId: (if .id > 2147483647 then null else .id end), commitOid: .sha, task, environment, description, payload: (.payload | if . == null then null else tojson end), latestStatus: {state: ($state | ascii_upcase)}}' >>"$STATE/nodes"
    done
    jq -s --argjson page "$page" '{data: {repository: {deployments: {nodes: ., pageInfo: {hasNextPage: (length == 100), endCursor: (($page + 1) | tostring)}}}}}' "$STATE/nodes" >"$output"
    printf 200
    exit 0
fi
case "$method:$url" in
    GET:*/tags\?* | GET:*/repository/tags\?*) key=tags-${url##*page=} ;;
    GET:*/deployments\?*) key=deployments-${url##*page=} ;;
    GET:*/deployments/*/statuses\?*) tail=${url#*/deployments/}; key=statuses-${tail%%/*}-${url##*page=} ;;
    POST:*/deployments/*/statuses) key=write-status ;;
    POST:*/deployments) key=write-deployment ;;
    GET:*/git/tags/*) key=annotated ;;
    GET:*/git/ref/tags/* | GET:*/repository/tags/*) key=tag ;;
    POST:*/git/refs) key=create-tag ;;
    GET:*/releases/*) key=release ;;
    POST:*/releases) key=publish ;;
    *) printf 'unexpected request: %s %s\n' "$method" "$url" >&2; exit 9 ;;
esac
[ -z "$body" ] || cp "$body" "$STATE/$key-body"
if [ "$key" = tag ] && [ -f "$STATE/fixtures/tag-after.json" ]; then
    count=$(cat "$STATE/tag-reads" 2>/dev/null || printf 0)
    count=$((count + 1))
    printf '%s' "$count" >"$STATE/tag-reads"
    [ "$count" -eq 1 ] || key=tag-after
fi
cat "$STATE/fixtures/$key.json" >"$output"
cat "$STATE/fixtures/$key.status"
CURL
chmod +x "$tmp/bin/curl"
fixture() {
    printf '%s\n' "$2" >"$STATE/fixtures/$1.status"
    jq . >"$STATE/fixtures/$1.json"
}
statusOf() {
    result=0
    "$@" >"$tmp/result" 2>"$tmp/error" || result=$?
    printf '%s' "$result"
}
sha=4f6e2a7fa87860ed1b1acacb21867be2e0a1b2c3
old=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
GITHUB_TOKEN=default-token
GITHUB_REPOSITORY=Acme/Shop
GITHUB_API_URL=https://api.github.test
GITHUB_GRAPHQL_URL=https://api.github.test/graphql
export GITHUB_GRAPHQL_URL
GITHUB_SERVER_URL=https://github.test
GITHUB_RUN_ID=77
GITHUB_STEP_SUMMARY=$tmp/summary
export GITHUB_TOKEN GITHUB_REPOSITORY GITHUB_API_URL GITHUB_SERVER_URL GITHUB_RUN_ID GITHUB_STEP_SUMMARY

jq -n --arg sha "$sha" --arg old "$old" '[{id: 9, sha: $sha, task: "release", environment: "production"}, {id: 12, sha: $old, task: "release", environment: "production"}, {id: 14, sha: $old, task: "deploy", environment: "production"}, {id: 15, sha: $old, task: "release", environment: "uat"}, {id: 8, sha: $old, task: "release", environment: "production"}]' | fixture deployments-1 200
jq -n '[{id: 2, state: "success"}, {id: 1, state: "failure"}]' | fixture statuses-9-1 200
jq -n '[{id: 4, state: "failure"}, {id: 3, state: "success"}]' | fixture statuses-12-1 200
jq -n '[{id: 1, state: "success"}]' | fixture statuses-8-1 200
check "reads the newest finalised release only" "$sha" "$(sh "$release/host.sh" marker-read production)"
check "only finalised releases appear in history" "2" "$(sh "$release/host.sh" marker-list production | jq length)"
check "history filters the requested environment" production "$(jq -r .variables.environments[0] "$STATE/query-body")"
contains "history requests latest status in pages" 'latestStatus { state }' "$(jq -r .query "$STATE/query-body")"
contains "records use the default token" 'Authorization: Bearer default-token' "$(cat "$STATE/headers")"

jq -n --arg sha "$sha" --arg old "$old" '[range(1;101) | {id: ., sha: $old, task: "deploy", environment: "production"}]' | fixture deployments-1 200
jq -n --arg sha "$sha" '[{id: 101, sha: $sha, task: "release", environment: "production"}]' | fixture deployments-2 200
jq -n '[{id: 5, state: "success"}]' | fixture statuses-101-1 200
check "walks deployment pagination" "$sha" "$(sh "$release/host.sh" marker-read production)"
jq -n '[range(1;101) | {id: ., state: "failure"}]' | fixture statuses-101-1 200
jq -n '[{id: 101, state: "success"}]' | fixture statuses-101-2 200
check "walks status pagination and selects newest id" "$sha" "$(sh "$release/host.sh" marker-read production)"
jq -n '[]' | fixture deployments-1 200
check "no records means empty baseline" "" "$(sh "$release/host.sh" marker-read production)"
check "network failures are errors" "2" "$(CURL_FAIL=1 statusOf sh "$release/host.sh" marker-read production)"
jq -n '{message: "forbidden"}' | fixture deployments-1 403
check "API failures are errors" "2" "$(statusOf sh "$release/host.sh" marker-read production)"
jq -n '{}' | fixture deployments-1 200
check "malformed records are errors" "2" "$(statusOf sh "$release/host.sh" marker-read production)"

jq -n '{id: 42}' | fixture write-deployment 201
jq -n '{state: "success"}' | fixture write-status 201
sh "$release/host.sh" marker-write production "$sha" 2026-10-12.4
check "assigned version is retained in description and payload" true "$(jq '.description == "2026-10-12.4" and .payload.version == "2026-10-12.4"' "$STATE/write-deployment-body")"
check "record commits explicitly without merging" true "$(jq --arg sha "$sha" '.ref == $sha and .task == "release" and .environment == "production" and .auto_merge == false and .required_contexts == []' "$STATE/write-deployment-body")"
check "success preserves historical records" true "$(jq '.state == "success" and .auto_inactive == false' "$STATE/write-status-body")"
jq -n '{message: "forbidden"}' | fixture write-status 403
check "failed finalisation is an error" "2" "$(statusOf sh "$release/host.sh" marker-write production "$sha" 2026-10-12.4)"

jq -n '{message: "not found"}' | fixture release 404
check "missing release is distinct" 1 "$(statusOf sh "$release/host.sh" release-exists 2026-10-12.4)"
jq -n '{tag_name: "2026-10-12.4"}' | fixture release 200
check "release object means published" 0 "$(statusOf sh "$release/host.sh" release-exists 2026-10-12.4)"
jq -n '{message: "forbidden"}' | fixture release 403
check "release lookup errors remain errors" 2 "$(statusOf sh "$release/host.sh" release-exists 2026-10-12.4)"
jq -n '{object: {type: "tag", sha: "annotated-object"}}' | fixture tag 200
jq -n --arg sha "$sha" '{object: {type: "commit", sha: $sha}}' | fixture annotated 200
check "annotated tags resolve to their commit" "$sha" "$(sh "$release/host.sh" tag-read 2026-10-12.4)"
jq -n '{message: "not found"}' | fixture tag 404
check "absent tag is empty" "" "$(sh "$release/host.sh" tag-read 2026-10-12.4)"
jq -n '{}' | fixture create-tag 201
jq -n '{tag_name: "2026-10-12.4"}' | fixture publish 201
printf '%s\n' '## Changes' '- say "hi" \ there' >"$tmp/notes.md"
RELEASE_TOKEN=workflow-token sh "$release/host.sh" release-publish 2026-10-12.4 "$sha" "$tmp/notes.md"
contains "publication uses optional token" 'Authorization: Bearer workflow-token' "$(cat "$STATE/headers")"
check "tag names exact commit" true "$(jq --arg sha "$sha" '.ref == "refs/tags/2026-10-12.4" and .sha == $sha' "$STATE/create-tag-body")"
check "notes survive JSON encoding" true "$(jq --rawfile notes "$tmp/notes.md" '.body == $notes' "$STATE/publish-body")"
jq -n --arg old "$old" '{object: {type: "commit", sha: $old}}' | fixture tag 200
: >"$STATE/calls"
check "conflicting tag is refused" 4 "$(statusOf sh "$release/host.sh" release-publish 2026-10-12.4 "$sha" "$tmp/notes.md")"
lacks "conflicting tag is never overwritten" 'POST' "$(calls)"
jq -n --arg sha "$sha" '{object: {type: "commit", sha: $sha}}' | fixture tag 200
sh "$release/host.sh" release-publish 2026-10-12.4 "$sha" "$tmp/notes.md"
lacks "matching tag is reused" '/git/refs' "$(calls)"
jq -n '{message: "forbidden"}' | fixture publish 403
check "release refusal is an error" 2 "$(statusOf sh "$release/host.sh" release-publish 2026-10-12.4 "$sha" "$tmp/notes.md")"
check "image prefix is lower case" 'ghcr.io/acme/shop' "$(sh "$release/host.sh" image-prefix)"
check "run URL is shown" 'https://github.test/Acme/Shop/actions/runs/77' "$(sh "$release/host.sh" run-url)"
sh "$release/host.sh" summary "$tmp/notes.md"
check "summary appends to host summary" "$(cat "$tmp/notes.md")" "$(cat "$GITHUB_STEP_SUMMARY")"
check "title is event data" 'feat: x' "$(PR_TITLE='feat: x' sh "$release/host.sh" title)"

lacks "API credentials never appear in curl arguments" 'default-token' "$(calls)"


jq -n '{state: "pending"}' | fixture write-status 201
check "a successful HTTP response must finalise the record" 2 "$(statusOf sh "$release/host.sh" marker-write production "$sha" 2026-10-12.4)"
jq -n '{state: "success"}' | fixture write-status 403
check "HTTP refusal cannot finalise a success-shaped body" 2 "$(statusOf sh "$release/host.sh" marker-write production "$sha" 2026-10-12.4)"
jq -n '{tag_name: "2026-10-12.9"}' | fixture release 200
check "a different release tag is not accepted" 2 "$(statusOf sh "$release/host.sh" release-exists 2026-10-12.4)"
for page in 1 2 3; do
    jq -n --argjson page "$page" --arg sha "$sha" '[range((251 - ($page * 100)); (351 - ($page * 100))) | select(. > 0) | {id: ., sha: $sha, task: "release", environment: "production"}] | reverse' | fixture "deployments-$page" 200
done
id=1
while [ "$id" -le 250 ]; do
    jq -n '[{id: 1, state: "success"}]' | fixture "statuses-$id-1" 200
    id=$((id + 1))
done
: >"$STATE/calls"
check "250-record baseline uses the newest finalised record" "$sha" "$(sh "$release/host.sh" marker-read production)"
check "250-record baseline stops on the first page" true "$(test "$(wc -l <"$STATE/calls")" -le 2 && printf true || printf false)"
: >"$STATE/calls"
check "250-record history retains every finalised record" 250 "$(sh "$release/host.sh" marker-list production | jq length)"
check "250-record history needs only bounded page calls" true "$(test "$(wc -l <"$STATE/calls")" -le 4 && printf true || printf false)"

jq -n --arg sha "$sha" --arg old "$old" '[{id: 21, sha: $sha, task: "release", environment: "production", description: "Healthy release", payload: {version: "2026-10-12.4"}}, {id: 22, sha: $old, task: "release", environment: "dev", description: "2026-10-12.5", payload: []}, {id: 23, sha: $old, task: "release", environment: "uat", description: "2026-10-12.6"}]' | fixture deployments-1 200
jq -n '[{id: 1, state: "success"}]' | fixture statuses-21-1 200
jq -n '[{id: 1, state: "success"}]' | fixture statuses-22-1 200
jq -n '[{id: 1, state: "failure"}]' | fixture statuses-23-1 200
check "environment history retains assigned version" 2026-10-12.4 "$(sh "$release/host.sh" marker-list production | jq -r '.[0].version')"
check "global history retains finalised versions across environments" '2026-10-12.5,2026-10-12.4' "$(sh "$release/host.sh" marker-list-all | jq -r 'map(.version) | join(",")')"
check "global history omits the environment filter" null "$(jq -c '.variables.environments' "$STATE/query-body")"

jq -n --arg sha "$sha" '[range(1;101) | {name: ("2026-10-12." + (. | tostring)), commit: {sha: $sha, id: $sha}}]' | fixture tags-1 200
jq -n --arg old "$old" '[{name: "2026-10-13.1", commit: {sha: $old, id: $old}}]' | fixture tags-2 200
check "remote tag list follows every page" 101 "$(sh "$release/host.sh" tag-list | jq length)"
check "remote tag list carries names and commits" "$old" "$(sh "$release/host.sh" tag-list | jq -r '.[] | select(.tag == "2026-10-13.1") | .sha')"
jq -n '{}' | fixture tags-1 200
check "invalid remote tag list fails" 2 "$(statusOf sh "$release/host.sh" tag-list)"
jq -n '[]' | fixture tags-1 403
check "remote tag read refusal fails" 2 "$(statusOf sh "$release/host.sh" tag-list)"

jq -n '{message: "not found"}' | fixture tag 404
jq -n --arg old "$old" '{object: {type: "commit", sha: $old}}' | fixture tag-after 200
jq -n '{}' | fixture create-tag 422
rm -f "$STATE/tag-reads"
check "a tag created by a racing commit is a distinct refusal" 4 "$(statusOf sh "$release/host.sh" release-publish 2026-10-12.4 "$sha" "$tmp/notes.md")"

jq -n --arg sha "$sha" --arg old "$old" '[{id: 2147483648, node_id: "D_a", created_at: "2026-10-13T12:00:00Z", sha: $sha, task: "release", environment: "production"}, {id: 2147483649, node_id: "D_z", created_at: "2026-10-13T11:00:00Z", sha: $old, task: "release", environment: "production"}]' | fixture deployments-1 200
jq -n '[{id: 1, state: "success"}]' | fixture statuses-2147483648-1 200
jq -n '[{id: 1, state: "success"}]' | fixture statuses-2147483649-1 200
check "large deployment ids retain the newest live record" "$sha" "$(sh "$release/host.sh" marker-read production)"
check "large deployment ids use node identity and creation order" 'D_a,D_z' "$(sh "$release/host.sh" marker-list production | jq -r 'map(.id) | join(",")')"
lacks "deployment reads never request the 32-bit database id" databaseId "$(jq -r .query "$STATE/query-body")"
contains "deployment reads request descending creation order" 'orderBy:{field:CREATED_AT,direction:DESC}' "$(jq -r .query "$STATE/query-body")"

jq -n --arg sha "$sha" '{data: {repository: {deployments: {nodes: [{id: "D_a", databaseId: 2, commitOid: $sha, task: "release", environment: "production", latestStatus: {state: "SUCCESS"}}], pageInfo: {hasNextPage: true, endCursor: "2"}}}}}' | fixture graphql-1 200
jq -n --arg old "$old" '{data: {repository: {deployments: {nodes: [{id: "D_z", databaseId: 1, commitOid: $old, task: "release", environment: "production", latestStatus: {state: "SUCCESS"}}], pageInfo: {hasNextPage: false, endCursor: null}}}}}' | fixture graphql-2 200
rm -f "$STATE/graphql-count"
check "deployment history preserves creation order across pages" 'D_a,D_z' "$(sh "$release/host.sh" marker-list production | jq -r 'map(.id) | join(",")')"

jq -n '{errors: [{message: "Deployment query failed"}], data: {repository: {deployments: {nodes: [], pageInfo: {hasNextPage: false, endCursor: null}}}}}' | fixture graphql-1 200
rm -f "$STATE/graphql-count"
check "GraphQL errors reject otherwise valid deployment data" 2 "$(statusOf sh "$release/host.sh" marker-read production)"
contains "GraphQL errors identify invalid records" 'invalid deployment records' "$(cat "$tmp/error")"

jq -n '{data: {repository: {deployments: {nodes: [], pageInfo: {hasNextPage: true, endCursor: "2"}}}}}' | fixture graphql-1 200
cp "$STATE/fixtures/graphql-1.json" "$STATE/fixtures/graphql-2.json"
rm -f "$STATE/graphql-count"
check "a repeated deployment cursor fails closed" 2 "$(statusOf sh "$release/host.sh" marker-read production)"
contains "a repeated deployment cursor is diagnosed" 'repeated deployment page cursor' "$(cat "$tmp/error")"
check "a repeated deployment cursor stops before another request" 2 "$(cat "$STATE/graphql-count")"

done_testing
