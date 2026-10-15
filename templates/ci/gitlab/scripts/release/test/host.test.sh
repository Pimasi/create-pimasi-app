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
case "$method:$url" in
    GET:*/tags\?* | GET:*/repository/tags\?*) key=tags-${url##*page=} ;;
    GET:*/deployments\?*) key=deployments-${url##*page=} ;;
    GET:*/deployments/*/statuses\?*) tail=${url#*/deployments/}; key=statuses-${tail%%/*}-${url##*page=} ;;
    POST:*/deployments/*/statuses) key=write-status ;;
    POST:*/deployments) key=write-deployment ;;
    GET:*/git/tags/*) key=annotated ;;
    GET:*/git/ref/tags/* | GET:*/repository/tags/*) key=tag ;;
    POST:*/git/refs | POST:*/repository/tags) key=create-tag ;;
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
CI_JOB_TOKEN=job-token
CI_API_V4_URL=https://gitlab.test/api/v4
CI_PROJECT_ID=12
CI_PIPELINE_URL=https://gitlab.test/Acme/Shop/-/pipelines/77
CI_REGISTRY_IMAGE=registry.gitlab.test/Acme/Shop
export CI_JOB_TOKEN CI_API_V4_URL CI_PROJECT_ID CI_PIPELINE_URL CI_REGISTRY_IMAGE

jq -n --arg sha "$sha" --arg old "$old" '[{id: 9, sha: $sha, ref: $sha, status: "success", environment: {name: "production"}, deployable: null}, {id: 12, sha: $old, ref: "main", status: "success", environment: {name: "production"}, deployable: null}, {id: 16, sha: $old, ref: $old, status: "success", environment: {name: "production"}, deployable: {id: 3}}, {id: 17, sha: $old, ref: $old, status: "success", environment: {name: "production"}, deployable: null, tag: true}, {id: 14, sha: $old, ref: $old, status: "running", environment: {name: "production"}, deployable: null}, {id: 15, sha: $old, ref: $old, status: "success", environment: {name: "uat"}, deployable: null}, {id: 8, sha: $old, ref: $old, status: "success", environment: {name: "production"}, deployable: null}]' | fixture deployments-1 200
check "newest finalised release is the baseline" "$sha" "$(sh "$release/host.sh" marker-read production)"
check "automatic and incomplete records are excluded" '9,8' "$(sh "$release/host.sh" marker-list production | jq -r 'map(.id | tostring) | join(",")')"
contains "records requested in id order" 'environment=production&status=success&order_by=id&sort=desc&per_page=100&page=1' "$(calls)"
contains "API uses the job token" 'JOB-TOKEN: job-token' "$(cat "$STATE/headers")"
jq -n --arg old "$old" '[range(1;101) | {id: ., sha: $old, ref: "main", status: "success", environment: {name: "production"}, deployable: {id: 3}}]' | fixture deployments-1 200
jq -n --arg sha "$sha" '[{id: 101, sha: $sha, ref: $sha, status: "success", environment: {name: "production"}, deployable: null}]' | fixture deployments-2 200
check "walks history pagination" "$sha" "$(sh "$release/host.sh" marker-read production)"
jq -n --arg sha "$sha" '[range(200;100;-1) | {id: ., sha: $sha, ref: $sha, status: "success", environment: {name: "production"}, deployable: null}]' | fixture deployments-1 200
jq -n '{message: "must not read another page"}' | fixture deployments-2 403
: >"$STATE/requests"
check "a first-page live record needs no further page" 0 "$(statusOf sh "$release/host.sh" marker-read production)"
check "the first matching page supplies the live SHA" "$sha" "$(cat "$tmp/result")"
lacks "a live read stops before the second page" 'page=2' "$(cat "$STATE/requests")"
jq -n '[]' | fixture deployments-1 200
check "no records means empty baseline" "" "$(sh "$release/host.sh" marker-read production)"
check "network failure is an error" 2 "$(CURL_FAIL=1 statusOf sh "$release/host.sh" marker-read production)"
jq -n '{message: "forbidden"}' | fixture deployments-1 403
check "API failure is an error" 2 "$(statusOf sh "$release/host.sh" marker-read production)"
jq -n '{}' | fixture deployments-1 200
check "invalid records are an error" 2 "$(statusOf sh "$release/host.sh" marker-read production)"

jq -n --arg sha "$sha" '{id: 42, sha: $sha, ref: $sha, status: "success", environment: {name: "production"}, deployable: null}' | fixture write-deployment 201
sh "$release/host.sh" marker-write production "$sha" 2026-10-12.4
check "record reserves the detached ref marker" true "$(jq --arg sha "$sha" '.ref == $sha and .sha == $sha and .tag == false and .environment == "production" and .status == "success"' "$STATE/write-deployment-body")"
jq -n '{message: "forbidden"}' | fixture write-deployment 403
check "write failure is an error" 2 "$(statusOf sh "$release/host.sh" marker-write production "$sha" 2026-10-12.4)"
jq -n '{status: "created"}' | fixture write-deployment 201
check "unfinalised record is an error" 2 "$(statusOf sh "$release/host.sh" marker-write production "$sha" 2026-10-12.4)"

jq -n '{message: "not found"}' | fixture release 404
check "missing release is distinct" 1 "$(statusOf sh "$release/host.sh" release-exists 2026-10-12.4)"
jq -n '{tag_name: "2026-10-12.4"}' | fixture release 200
check "release object means published" 0 "$(statusOf sh "$release/host.sh" release-exists 2026-10-12.4)"
jq -n '{message: "forbidden"}' | fixture release 403
check "release lookup failure is an error" 2 "$(statusOf sh "$release/host.sh" release-exists 2026-10-12.4)"
jq -n --arg sha "$sha" '{commit: {id: $sha}}' | fixture tag 200
check "tag target is its commit" "$sha" "$(sh "$release/host.sh" tag-read 2026-10-12.4)"
jq -n '{message: "not found"}' | fixture tag 404
check "absent tag is empty" "" "$(sh "$release/host.sh" tag-read 2026-10-12.4)"
jq -n '{}' | fixture create-tag 201
jq -n '{tag_name: "2026-10-12.4"}' | fixture publish 201
printf '%s\n' '## Changes' '- say "hi" \ there' >"$tmp/notes.md"
jq -n --arg sha "$sha" '{commit: {id: $sha}}' | fixture tag-after 200
sh "$release/host.sh" release-publish 2026-10-12.4 "$sha" "$tmp/notes.md"
rm -f "$STATE/fixtures/tag-after.json" "$STATE/fixtures/tag-after.status" "$STATE/tag-reads"
check "release API creates the tag at the commit" true "$(jq --arg sha "$sha" '.ref == $sha and .tag_name == "2026-10-12.4"' "$STATE/publish-body")"
check "notes survive JSON encoding" true "$(jq --rawfile notes "$tmp/notes.md" '.description == $notes' "$STATE/publish-body")"
lacks "job token never calls tag creation API" 'POST https://gitlab.test/api/v4/projects/12/repository/tags' "$(cat "$STATE/requests")"
jq -n --arg old "$old" '{commit: {id: $old}}' | fixture tag 200
: >"$STATE/calls"
check "conflicting tag is refused" 4 "$(statusOf sh "$release/host.sh" release-publish 2026-10-12.4 "$sha" "$tmp/notes.md")"
lacks "conflicting tag is never overwritten" POST "$(calls)"
jq -n --arg sha "$sha" '{commit: {id: $sha}}' | fixture tag 200
sh "$release/host.sh" release-publish 2026-10-12.4 "$sha" "$tmp/notes.md"
jq -n '{message: "forbidden"}' | fixture publish 403
check "release refusal is an error" 2 "$(statusOf sh "$release/host.sh" release-publish 2026-10-12.4 "$sha" "$tmp/notes.md")"
check "image prefix is lower case" 'registry.gitlab.test/acme/shop' "$(sh "$release/host.sh" image-prefix)"
check "run URL is shown" 'https://gitlab.test/Acme/Shop/-/pipelines/77' "$(sh "$release/host.sh" run-url)"
check "title is merge request data" 'feat: x' "$(CI_MERGE_REQUEST_TITLE='feat: x' sh "$release/host.sh" title)"

lacks "API credentials never appear in curl arguments" 'job-token' "$(calls)"


jq -n '{message: "forbidden"}' | fixture tag 403
check "a forbidden tag lookup is an error" 2 "$(statusOf sh "$release/host.sh" tag-read 2026-10-12.4)"
contains "a forbidden tag lookup names HTTP 403" 'HTTP 403' "$(cat "$tmp/error")"

check "GitLab explicitly exposes no record-held versions" '[]' "$(sh "$release/host.sh" marker-list-all | jq -c .)"

jq -n --arg sha "$sha" '[range(1;101) | {name: ("2026-10-12." + (. | tostring)), commit: {sha: $sha, id: $sha}}]' | fixture tags-1 200
jq -n --arg old "$old" '[{name: "2026-10-13.1", commit: {sha: $old, id: $old}}]' | fixture tags-2 200
check "remote tag list follows every page" 101 "$(sh "$release/host.sh" tag-list | jq length)"
check "remote tag list carries names and commits" "$old" "$(sh "$release/host.sh" tag-list | jq -r '.[] | select(.tag == "2026-10-13.1") | .sha')"
jq -n '{}' | fixture tags-1 200
check "invalid remote tag list fails" 2 "$(statusOf sh "$release/host.sh" tag-list)"
jq -n '[]' | fixture tags-1 403
check "remote tag read refusal fails" 2 "$(statusOf sh "$release/host.sh" tag-list)"

jq -n '{message: "not found"}' | fixture tag 404
jq -n --arg old "$old" '{commit: {id: $old}}' | fixture tag-after 200
jq -n '{}' | fixture publish 409
rm -f "$STATE/tag-reads"
check "a tag created by a racing commit is a distinct refusal" 4 "$(statusOf sh "$release/host.sh" release-publish 2026-10-12.4 "$sha" "$tmp/notes.md")"
jq -n '{tag_name: "2026-10-12.4"}' | fixture publish 201
rm -f "$STATE/tag-reads"
check "a successful release response cannot conceal a raced tag" 4 "$(statusOf sh "$release/host.sh" release-publish 2026-10-12.4 "$sha" "$tmp/notes.md")"

done_testing
