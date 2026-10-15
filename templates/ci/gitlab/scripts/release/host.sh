#!/bin/sh
set -eu

fail() {
    printf 'release host: %s\n' "$1" >&2
    exit "${2:-2}"
}

request() {
    method=$1
    path=$2
    shift 2
    printf '%s\n' "JOB-TOKEN: ${CI_JOB_TOKEN:?}" >"$hostTmp/headers"
    httpStatus=$(curl -sS --connect-timeout 10 --max-time 60 -X "$method" \
        -H "@$hostTmp/headers" -H "Content-Type: application/json" \
        -o "$hostTmp/response" -w '%{http_code}' "$@" \
        "${CI_API_V4_URL:?}/projects/${CI_PROJECT_ID:?}$path") || return 2
    case "$httpStatus" in
        2??) return 0 ;;
        404) return 1 ;;
        *) printf 'release host: %s %s returned HTTP %s\n' "$method" "$path" "$httpStatus" >&2; return 2 ;;
    esac
}

markerList() {
    environment=$1
    first=${2:-false}
    encoded=$(jq -rn --arg value "$environment" '$value | @uri')
    query=
    [ -z "$environment" ] || query="environment=$encoded&"
    page=1
    : >"$hostTmp/deployments"
    while :; do
        request GET "/deployments?${query}status=success&order_by=id&sort=desc&per_page=100&page=$page" || fail "could not read the live records for $environment"
        jq -e 'type == "array" and all(.[]; (.id | type == "number") and (.sha | type == "string"))' "$hostTmp/response" >/dev/null || fail "invalid deployment records"
        jq -c --arg environment "$environment" '.[] | select(.status == "success" and ($environment == "" or .environment.name == $environment) and .ref == .sha and .deployable == null and (.tag // false) == false) | . as $record | {sha, id} + (if $environment == "" then {environment: $record.environment.name} else {} end)' "$hostTmp/response" >>"$hostTmp/deployments"
        [ "$first" != true ] || [ ! -s "$hostTmp/deployments" ] || break
        [ "$(jq length "$hostTmp/response")" -eq 100 ] || break
        page=$((page + 1))
    done
    jq -s 'sort_by(.id) | reverse' "$hostTmp/deployments"
}

tagRead() {
    encoded=$(jq -rn --arg value "$1" '$value | @uri')
    status=0
    request GET "/repository/tags/$encoded" || status=$?
    [ "$status" -ne 1 ] || return 0
    [ "$status" -eq 0 ] || return "$status"
    jq -er '.commit.id | select(type == "string" and test("^[0-9a-fA-F]{40}$"))' "$hostTmp/response" || return 2
}

branchRead() {
    git ls-remote --heads origin "refs/heads/$1" >"$hostTmp/branch" || return 2
    awk -v ref="refs/heads/$1" '$2 == ref { print $1 }' "$hostTmp/branch"
}

verb=${1:-}
case "$verb" in
    image-prefix) printf '%s\n' "$(printf '%s' "${CI_REGISTRY_IMAGE:?}" | tr '[:upper:]' '[:lower:]')"; exit ;;
    registry-login) printf '%s' "${CI_REGISTRY_PASSWORD:?}" | docker login "${CI_REGISTRY:?}" -u "${CI_REGISTRY_USER:?}" --password-stdin; exit ;;
    summary) [ -z "${GITHUB_STEP_SUMMARY:-}" ] || cat "$2" >>"$GITHUB_STEP_SUMMARY"; exit ;;
    title) printf '%s' "${CI_MERGE_REQUEST_TITLE:-}"; exit ;;
    run-url) printf '%s\n' "${CI_PIPELINE_URL:-}"; exit ;;
esac

umask 077
hostTmp=$(mktemp -d)
trap 'rm -rf "$hostTmp"' 0
trap 'exit 130' INT
trap 'exit 143' TERM

case "$verb" in
    marker-list) markerList "$2" ;;
    marker-list-all) printf '[]\n' ;;
    marker-history) markerList "" ;;
    marker-read)
        markerList "$2" true >"$hostTmp/records"
        jq -r '.[0].sha // ""' "$hostTmp/records"
        ;;
    marker-write)
        jq -nc --arg sha "$3" --arg environment "$2" \
            '{environment: $environment, sha: $sha, ref: $sha, tag: false, status: "success"}' >"$hostTmp/body"
        request POST /deployments --data-binary "@$hostTmp/body" || fail "could not write the live record for $2"
        jq -e --arg sha "$3" --arg environment "$2" '.status == "success" and .sha == $sha and .ref == $sha and .environment.name == $environment and .deployable == null' "$hostTmp/response" >/dev/null || fail "the live record was not finalised"
        ;;
    release-exists)
        encoded=$(jq -rn --arg value "$2" '$value | @uri')
        status=0
        request GET "/releases/$encoded" || status=$?
        [ "$status" -eq 0 ] || exit "$status"
        jq -e --arg tag "$2" '.tag_name == $tag' "$hostTmp/response" >/dev/null || exit 2
        ;;
    tag-list)
        page=1
        : >"$hostTmp/tags"
        while :; do
            request GET "/repository/tags?per_page=100&page=$page" || fail "could not read remote release tags"
            jq -e 'type == "array" and all(.[]; (.name | type == "string") and (.commit.id | type == "string" and test("^[0-9a-fA-F]{40}$")))' "$hostTmp/response" >/dev/null || fail "invalid remote release tags"
            jq -c '.[] | {tag: .name, sha: .commit.id}' "$hostTmp/response" >>"$hostTmp/tags"
            [ "$(jq length "$hostTmp/response")" -eq 100 ] || break
            page=$((page + 1))
        done
        jq -s . "$hostTmp/tags"
        ;;
    tag-read) tagRead "$2" ;;
    release-publish)
        found=$(tagRead "$2") || fail "could not read tag $2"
        [ -z "$found" ] || [ "$found" = "$3" ] || fail "tag $2 points at $found, not $3" 4
        jq -nc --arg tag "$2" --arg sha "$3" --rawfile notes "$4" \
            '{tag_name: $tag, ref: $sha, name: $tag, description: $notes}' >"$hostTmp/body"
        status=0
        request POST /releases --data-binary "@$hostTmp/body" || status=$?
        found=$(tagRead "$2") || fail "could not verify tag $2 after publication"
        [ -z "$found" ] || [ "$found" = "$3" ] || fail "tag $2 points at $found, not $3" 4
        [ "$status" -eq 0 ] || fail "could not publish release $2"
        [ "$found" = "$3" ] || fail "release $2 has no tag at $3"
        ;;
    branch-read) branchRead "$2" || fail "could not read branch $2" ;;
    branch-create)
        found=$(branchRead "$2") || fail "could not read branch $2"
        if [ -z "$found" ] && ! GIT_TERMINAL_PROMPT=0 git push --quiet -o ci.skip --force-with-lease="refs/heads/$2:" origin "$3:refs/heads/$2"; then
            found=$(branchRead "$2") || fail "could not read branch $2 after refused creation"
            [ -n "$found" ] || fail "could not create branch $2"
        fi
        [ -z "$found" ] || [ "$found" = "$3" ] || fail "branch $2 points at $found, not $3" 4
        ;;
    branch-move)
        GIT_TERMINAL_PROMPT=0 git push --quiet -o ci.skip --force origin "$3:refs/heads/$2" || fail "could not move branch $2"
        ;;
    *) fail "unknown host verb: $verb" ;;
esac
