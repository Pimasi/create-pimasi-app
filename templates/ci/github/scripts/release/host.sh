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
    printf '%s\n' "Authorization: Bearer $token" >"$hostTmp/headers"
    requestUrl=${GITHUB_API_URL:-https://api.github.com}/repos/${GITHUB_REPOSITORY:?}$path
    if [ "$path" = /graphql ]; then
        requestUrl=${GITHUB_GRAPHQL_URL:-https://api.github.com/graphql}
    fi
    httpStatus=$(curl -sS --connect-timeout 10 --max-time 60 -X "$method" \
        -H "@$hostTmp/headers" \
        -H "Accept: application/vnd.github+json" \
        -H "Content-Type: application/json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        -o "$hostTmp/response" -w '%{http_code}' "$@" \
        "$requestUrl") || return 2
    case "$httpStatus" in
        2??) return 0 ;;
        404) return 1 ;;
        *) printf 'release host: %s %s returned HTTP %s\n' "$method" "$path" "$httpStatus" >&2; return 2 ;;
    esac
}

markerList() {
    environment=$1
    limit=${2:-all}
    cursor=
    : >"$hostTmp/finalised"
    while :; do
        jq -nc --arg owner "${GITHUB_REPOSITORY%%/*}" --arg name "${GITHUB_REPOSITORY#*/}" \
            --arg environment "$environment" --arg cursor "$cursor" '
            {query: "query($owner:String!,$name:String!,$environments:[String!],$cursor:String) { repository(owner:$owner,name:$name) { deployments(first:100,after:$cursor,environments:$environments,orderBy:{field:CREATED_AT,direction:DESC}) { nodes { id commitOid task environment description payload latestStatus { state } } pageInfo { hasNextPage endCursor } } } }",
             variables: {owner:$owner,name:$name,environments:(if $environment == "" then null else [$environment] end),cursor:(if $cursor == "" then null else $cursor end)}}
        ' >"$hostTmp/body"
        request POST /graphql --data-binary "@$hostTmp/body" || fail "could not read the live records for $environment"
        jq -e '(.errors // [] | length) == 0 and (.data.repository.deployments | (.nodes | type == "array") and (.pageInfo.hasNextPage | type == "boolean") and all(.nodes[]; (.id | type == "string" and length > 0) and (.commitOid | type == "string")))' "$hostTmp/response" >/dev/null || fail "invalid deployment records"
        jq -c --arg environment "$environment" '.data.repository.deployments.nodes[] | select(.task == "release" and ($environment == "" or .environment == $environment) and .latestStatus.state == "SUCCESS") | {sha: .commitOid, id: .id, version: ((.payload // "{}" | fromjson? | .version? | select(type == "string")) // .description // ""), environment}' "$hostTmp/response" >>"$hostTmp/finalised"
        if [ "$limit" = first ] && [ -s "$hostTmp/finalised" ]; then
            break
        fi
        [ "$(jq -r '.data.repository.deployments.pageInfo.hasNextPage' "$hostTmp/response")" = true ] || break
        nextCursor=$(jq -er '.data.repository.deployments.pageInfo.endCursor | select(type == "string" and length > 0)' "$hostTmp/response") || fail "missing deployment page cursor"
        [ "$nextCursor" != "$cursor" ] || fail "repeated deployment page cursor"
        cursor=$nextCursor
    done
    jq -s . "$hostTmp/finalised"
}

tagRead() {
    encoded=$(jq -rn --arg value "$1" '$value | @uri')
    status=0
    request GET "/git/ref/tags/$encoded" || status=$?
    [ "$status" -ne 1 ] || return 0
    [ "$status" -eq 0 ] || return "$status"
    while [ "$(jq -r '.object.type // ""' "$hostTmp/response")" = tag ]; do
        object=$(jq -er '.object.sha' "$hostTmp/response") || return 2
        request GET "/git/tags/$object" || return 2
    done
    jq -er 'select(.object.type == "commit") | .object.sha | select(test("^[0-9a-fA-F]{40}$"))' "$hostTmp/response" || return 2
}

branchPath() {
    jq -rn --arg value "$1" '$value | split("/") | map(@uri) | join("/")'
}

branchRead() {
    status=0
    request GET "/git/ref/heads/$(branchPath "$1")" || status=$?
    [ "$status" -ne 1 ] || return 0
    [ "$status" -eq 0 ] || return "$status"
    jq -er 'select(.object.type == "commit") | .object.sha | select(test("^[0-9a-fA-F]{40}$"))' "$hostTmp/response" || return 2
}

verb=${1:-}
case "$verb" in
    image-prefix) printf 'ghcr.io/%s\n' "$(printf '%s' "${GITHUB_REPOSITORY:?}" | tr '[:upper:]' '[:lower:]')"; exit ;;
    registry-login) printf '%s' "${GITHUB_TOKEN:?}" | docker login ghcr.io -u "${GITHUB_ACTOR:?}" --password-stdin; exit ;;
    summary) [ -z "${GITHUB_STEP_SUMMARY:-}" ] || cat "$2" >>"$GITHUB_STEP_SUMMARY"; exit ;;
    title) printf '%s' "${PR_TITLE:-}"; exit ;;
    run-url) printf '%s/%s/actions/runs/%s\n' "${GITHUB_SERVER_URL:-https://github.com}" "${GITHUB_REPOSITORY:-}" "${GITHUB_RUN_ID:-}"; exit ;;
esac

umask 077
hostTmp=$(mktemp -d)
trap 'rm -rf "$hostTmp"' 0
trap 'exit 130' INT
trap 'exit 143' TERM
token=${GITHUB_TOKEN:?}
case "$verb" in
    tag-list | tag-read | release-exists | release-publish | branch-read | branch-create | branch-move) token=${RELEASE_TOKEN:-$token} ;;
esac

case "$verb" in
    marker-list) markerList "$2" ;;
    marker-list-all | marker-history) markerList "" ;;
    marker-read)
        markerList "$2" first >"$hostTmp/records"
        jq -r '.[0].sha // ""' "$hostTmp/records"
        ;;
    marker-write)
        jq -nc --arg ref "$3" --arg environment "$2" --arg description "$4" \
            '{ref: $ref, environment: $environment, task: "release", description: $description, payload: {version: $description}, auto_merge: false, required_contexts: []}' >"$hostTmp/body"
        request POST /deployments --data-binary "@$hostTmp/body" || fail "could not create the live record for $2"
        id=$(jq -er '.id | select(type == "number")' "$hostTmp/response") || fail "the live record has no id"
        jq -nc '{state: "success", auto_inactive: false}' >"$hostTmp/body"
        request POST "/deployments/$id/statuses" --data-binary "@$hostTmp/body" || fail "could not finalise the live record for $2"
        jq -e '.state == "success"' "$hostTmp/response" >/dev/null || fail "the live record was not finalised"
        ;;
    release-exists)
        encoded=$(jq -rn --arg value "$2" '$value | @uri')
        status=0
        request GET "/releases/tags/$encoded" || status=$?
        [ "$status" -eq 0 ] || exit "$status"
        jq -e --arg tag "$2" '.tag_name == $tag' "$hostTmp/response" >/dev/null || exit 2
        ;;
    tag-list)
        page=1
        : >"$hostTmp/tags"
        while :; do
            request GET "/tags?per_page=100&page=$page" || fail "could not read remote release tags"
            jq -e 'type == "array" and all(.[]; (.name | type == "string") and (.commit.sha | type == "string" and test("^[0-9a-fA-F]{40}$")))' "$hostTmp/response" >/dev/null || fail "invalid remote release tags"
            jq -c '.[] | {tag: .name, sha: .commit.sha}' "$hostTmp/response" >>"$hostTmp/tags"
            [ "$(jq length "$hostTmp/response")" -eq 100 ] || break
            page=$((page + 1))
        done
        jq -s . "$hostTmp/tags"
        ;;
    tag-read) tagRead "$2" ;;
    release-publish)
        found=$(tagRead "$2") || fail "could not read tag $2"
        if [ -z "$found" ]; then
            jq -nc --arg ref "refs/tags/$2" --arg sha "$3" '{ref: $ref, sha: $sha}' >"$hostTmp/body"
            if ! request POST /git/refs --data-binary "@$hostTmp/body"; then
                found=$(tagRead "$2") || fail "could not read tag $2 after refused creation"
                [ -z "$found" ] || [ "$found" = "$3" ] || fail "tag $2 points at $found, not $3" 4
                [ "$found" = "$3" ] || fail "could not create tag $2"
            fi
        elif [ "$found" != "$3" ]; then
            fail "tag $2 points at $found, not $3" 4
        fi
        jq -nc --arg tag "$2" --arg sha "$3" --rawfile notes "$4" \
            '{tag_name: $tag, target_commitish: $sha, name: $tag, body: $notes}' >"$hostTmp/body"
        request POST /releases --data-binary "@$hostTmp/body" || fail "could not publish release $2"
        ;;
    branch-read) branchRead "$2" || fail "could not read branch $2" ;;
    branch-create)
        found=$(branchRead "$2") || fail "could not read branch $2"
        if [ -z "$found" ]; then
            jq -nc --arg ref "refs/heads/$2" --arg sha "$3" '{ref: $ref, sha: $sha}' >"$hostTmp/body"
            if ! request POST /git/refs --data-binary "@$hostTmp/body"; then
                found=$(branchRead "$2") || fail "could not read branch $2 after refused creation"
                [ -n "$found" ] || fail "could not create branch $2"
            fi
        fi
        [ -z "$found" ] || [ "$found" = "$3" ] || fail "branch $2 points at $found, not $3" 4
        ;;
    branch-move)
        found=$(branchRead "$2") || fail "could not read branch $2"
        [ "$found" != "$3" ] || exit 0
        if [ -z "$found" ]; then
            jq -nc --arg ref "refs/heads/$2" --arg sha "$3" '{ref: $ref, sha: $sha}' >"$hostTmp/body"
            request POST /git/refs --data-binary "@$hostTmp/body" || fail "could not create branch $2"
        else
            jq -nc --arg sha "$3" '{sha: $sha, force: true}' >"$hostTmp/body"
            request PATCH "/git/refs/heads/$(branchPath "$2")" --data-binary "@$hostTmp/body" || fail "could not move branch $2"
        fi
        ;;
    *) fail "unknown host verb: $verb" ;;
esac
