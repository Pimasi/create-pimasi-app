#!/bin/sh
set -eu
api=$STATE/api
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
                @*) cat "${2#@}" >>"$api/headers" ;;
                *) printf '%s\n' "$2" >>"$api/headers" ;;
            esac
            shift 2
            ;;
        -w | --connect-timeout | --max-time) shift 2 ;;
        --data-binary) body=${2#@}; shift 2 ;;
        -sS) shift ;;
        *) url=$1; shift ;;
    esac
done
printf '%s %s\n' "$method" "$url" >>"$api/calls"
if [ "$ADAPTER_HOST" = github ]; then
    path=${url#*/repos/Acme/Shop}
else
    path=${url#*/projects/12}
fi
case "$method $path" in
    'POST https://api.github.test/graphql')
        environment=$(jq -r '.variables.environments[0] // ""' "$body")
        jq --arg environment "$environment" '[.[] | select($environment == "" or .environment == $environment)] | reverse | map({id: ("D_" + (.id | tostring)), commitOid: .sha, task, environment, description, payload: (.payload | if . == null then null else tojson end), latestStatus: {state: (.status | ascii_upcase)}}) | {data: {repository: {deployments: {nodes: ., pageInfo: {hasNextPage: false, endCursor: null}}}}}' "$api/deployments.json" >"$output"
        printf 200
        ;;
    'GET /deployments?'*)
        environment=
        case "$path" in
            *environment=*) environment=$(printf '%s' "$path" | sed 's/.*environment=\([^&]*\).*/\1/') ;;
        esac
        jq --arg environment "$environment" '[.[] | select($environment == "" or .environment.name == $environment)] | reverse' "$api/deployments.json" >"$output"
        printf 200
        ;;
    'POST /deployments')
        jq --slurpfile body "$body" --arg host "$ADAPTER_HOST" '. + [($body[0] + {id: (length + 1)} | if $host == "github" then . + {sha: .ref, status: "pending"} else . + {environment: {name: .environment}, deployable: null} end)]' "$api/deployments.json" >"$api/next"
        mv "$api/next" "$api/deployments.json"
        jq '.[-1]' "$api/deployments.json" >"$output"
        if [ "$ADAPTER_HOST" = gitlab ] && [ -n "${FAIL_FINALISE:-}" ]; then
            jq '.[-1].status = "running"' "$api/deployments.json" >"$api/next"
            mv "$api/next" "$api/deployments.json"
            jq '.[-1]' "$api/deployments.json" >"$output"
        fi
        printf 201
        ;;
    'POST /deployments/'*'/statuses')
        if [ -n "${FAIL_FINALISE:-}" ]; then
            printf '{}\n' >"$output"
            printf 403
            exit 0
        fi
        id=${path#/deployments/}
        id=${id%%/*}
        jq --argjson id "$id" 'map(if .id == $id then .status = "success" else . end)' "$api/deployments.json" >"$api/next"
        mv "$api/next" "$api/deployments.json"
        printf '{"state":"success"}\n' >"$output"
        printf 201
        ;;
    'GET /tags?'* | 'GET /repository/tags?'*)
        : >"$api/tag-list"
        for file in "$api/tags/"*; do
            [ -f "$file" ] || continue
            jq -nc --arg name "${file##*/}" --arg sha "$(cat "$file")" '{name: $name, commit: {sha: $sha, id: $sha}}' >>"$api/tag-list"
        done
        jq -s . "$api/tag-list" >"$output"
        printf 200
        ;;
    'GET /git/ref/tags/'* | 'GET /repository/tags/'*)
        tag=${path##*/}
        if [ -f "$api/tags/$tag" ]; then
            jq -n --arg sha "$(cat "$api/tags/$tag")" '{object: {type: "commit", sha: $sha}, commit: {id: $sha}}' >"$output"
            printf 200
        else
            printf '{}\n' >"$output"
            printf 404
        fi
        ;;
    'GET /git/ref/heads/'*)
        branch=${path#/git/ref/heads/}
        found=$(git ls-remote --heads origin "refs/heads/$branch" | awk -v ref="refs/heads/$branch" '$2 == ref { print $1 }')
        if [ -n "$found" ]; then
            jq -n --arg ref "refs/heads/$branch" --arg sha "$found" '{ref: $ref, object: {type: "commit", sha: $sha}}' >"$output"
            printf 200
        else
            printf '{}\n' >"$output"
            printf 404
        fi
        ;;
    'PATCH /git/refs/heads/'*)
        branch=${path#/git/refs/heads/}
        if [ -n "${REFUSE_BRANCH:-}" ] || [ "$(jq -r .force "$body")" != true ]; then
            printf '{}\n' >"$output"
            printf 403
            exit 0
        fi
        git push -q -f origin "$(jq -r .sha "$body"):refs/heads/$branch"
        jq -n --arg ref "refs/heads/$branch" --arg sha "$(jq -r .sha "$body")" '{ref: $ref, object: {type: "commit", sha: $sha}}' >"$output"
        printf 200
        ;;
    'POST /git/refs')
        case "$(jq -r .ref "$body")" in
            refs/heads/*)
                branch=$(jq -r '.ref | sub("^refs/heads/"; "")' "$body")
                if [ -n "${REFUSE_BRANCH:-}" ]; then
                    printf '{}\n' >"$output"
                    printf 403
                    exit 0
                fi
                if [ -n "$(git ls-remote --heads origin "refs/heads/$branch")" ]; then
                    printf '{}\n' >"$output"
                    printf 422
                    exit 0
                fi
                git push -q origin "$(jq -r .sha "$body"):refs/heads/$branch"
                jq -n --arg ref "refs/heads/$branch" --arg sha "$(jq -r .sha "$body")" '{ref: $ref, object: {type: "commit", sha: $sha}}' >"$output"
                printf 201
                exit 0
                ;;
        esac
        if [ -n "${REFUSE_RELEASE:-}" ]; then
            printf '{}\n' >"$output"
            printf 403
            exit 0
        fi
        tag=$(jq -r '.ref | sub("^refs/tags/"; "") | @uri' "$body")
        case "$tag" in
            changelog%2F*)
                if [ -n "${REFUSE_ENV_PAGE_WRITE:-}" ]; then
                    printf '{}\n' >"$output"
                    printf 403
                    exit 0
                fi
                ;;
        esac
        if [ -n "${RACE_TAG_SHA:-}" ] && [ ! -f "$api/raced" ]; then
            printf '%s\n' "$RACE_TAG_SHA" >"$api/tags/$tag"
            : >"$api/raced"
        fi
        if [ -f "$api/tags/$tag" ]; then
            printf '{}\n' >"$output"
            printf 422
            exit 0
        fi
        jq -r .sha "$body" >"$api/tags/$tag"
        printf '{}\n' >"$output"
        printf 201
        ;;
    'GET /releases/'*)
        tag=${path##*/}
        case "$tag" in
            changelog%2F*)
                if [ -n "${REFUSE_ENV_PAGE_READ:-}" ]; then
                    printf '{}\n' >"$output"
                    printf 403
                    exit 0
                fi
                ;;
        esac
        if [ -f "$api/releases/$tag.md" ]; then
            if [ -f "$api/releases/$tag.json" ]; then
                jq --rawfile notes "$api/releases/$tag.md" '. + {body: $notes, description: $notes}' "$api/releases/$tag.json" >"$output"
            else
                jq -n --arg tag "$tag" '{tag_name: $tag}' >"$output"
            fi
            printf 200
        else
            printf '{}\n' >"$output"
            printf 404
        fi
        ;;
    'POST /releases')
        if [ -n "${REFUSE_RELEASE:-}" ]; then
            printf '{}\n' >"$output"
            printf 403
            exit 0
        fi
        tag=$(jq -r '.tag_name | @uri' "$body")
        case "$tag" in
            changelog%2F*)
                if [ -n "${REFUSE_ENV_PAGE_WRITE:-}" ]; then
                    printf '{}\n' >"$output"
                    printf 403
                    exit 0
                fi
                ;;
        esac
        if [ -n "${RACE_TAG_SHA:-}" ] && [ ! -f "$api/raced" ]; then
            printf '%s\n' "$RACE_TAG_SHA" >"$api/tags/$tag"
            printf 'Racing release\n' >"$api/releases/$tag.md"
            : >"$api/raced"
        fi
        if [ -f "$api/releases/$tag.md" ]; then
            printf '{}\n' >"$output"
            printf 409
            exit 0
        fi
        [ -f "$api/tags/$tag" ] || jq -r '.ref // .target_commitish' "$body" >"$api/tags/$tag"
        case "$ADAPTER_HOST $tag" in
            'gitlab changelog%2F'*)
                [ -z "${ENV_PAGE_CREATED_TAG_SHA:-}" ] || printf '%s\n' "$ENV_PAGE_CREATED_TAG_SHA" >"$api/tags/$tag"
                ;;
        esac
        cp "$body" "$api/release-write-body"
        jq -rj '.body // .description' "$body" >"$api/releases/$tag.md"
        id=$(cat "$api/release-sequence" 2>/dev/null || printf 0)
        id=$((id + 1))
        printf '%s\n' "$id" >"$api/release-sequence"
        jq --argjson id "$id" '{id: $id, tag_name, name}' "$body" >"$api/releases/$tag.json"
        cat "$api/releases/$tag.json" >"$output"
        printf 201
        ;;
    'PATCH /releases/'* | 'PUT /releases/'*)
        case "$ADAPTER_HOST $method" in
            'github PATCH' | 'gitlab PUT') ;;
            *) printf '{}\n' >"$output"; printf 405; exit 0 ;;
        esac
        if [ -n "${REFUSE_ENV_PAGE_WRITE:-}" ]; then
            printf '{}\n' >"$output"
            printf 403
            exit 0
        fi
        target=${path##*/}
        tag=$target
        if [ "$ADAPTER_HOST" = github ]; then
            tag=
            for file in "$api/releases/"*.json; do
                [ -f "$file" ] || continue
                if [ "$(jq -r .id "$file")" = "$target" ]; then
                    tag=${file##*/}
                    tag=${tag%.json}
                    break
                fi
            done
        fi
        if [ -z "$tag" ] || [ ! -f "$api/releases/$tag.json" ]; then
            printf '{}\n' >"$output"
            printf 404
            exit 0
        fi
        jq -rj '.body // .description' "$body" >"$api/releases/$tag.md"
        jq --slurpfile body "$body" '.name = $body[0].name' "$api/releases/$tag.json" >"$api/next"
        mv "$api/next" "$api/releases/$tag.json"
        cat "$api/releases/$tag.json" >"$output"
        printf 200
        ;;
    *) printf 'unexpected API request: %s %s\n' "$method" "$path" >&2; exit 9 ;;
esac
