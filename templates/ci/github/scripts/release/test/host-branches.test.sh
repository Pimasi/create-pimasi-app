#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
unset RELEASE_HOST_ADAPTER RELEASE_TOKEN
mkdir -p "$STATE/refs"
cat >"$tmp/bin/curl" <<'CURL'
#!/bin/sh
set -eu
printf 'curl %s\n' "$*" >>"$STATE/calls"
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
                @*) cat "${2#@}" >>"$STATE/headers" ;;
            esac
            shift 2
            ;;
        -w | --connect-timeout | --max-time) shift 2 ;;
        --data-binary) body=${2#@}; shift 2 ;;
        -sS) shift ;;
        *) url=$1; shift ;;
    esac
done
path=${url#https://api.github.test/repos/Acme/Shop}
printf '%s %s\n' "$method" "$path" >>"$STATE/requests"
[ -z "$body" ] || jq -c . "$body" >>"$STATE/bodies"
if [ -n "${BRANCH_WRITE_STATUS:-}" ] && [ "$method" != GET ]; then
    printf '{}\n' >"$output"
    printf '%s' "$BRANCH_WRITE_STATUS"
    exit 0
fi
if [ -n "${BRANCH_READ_STATUS:-}" ] && [ "$method" = GET ]; then
    printf '{}\n' >"$output"
    printf '%s' "$BRANCH_READ_STATUS"
    exit 0
fi
case "$method $path" in
    'GET /git/ref/heads/'*) name=${path#/git/ref/heads/} ;;
    'PATCH /git/refs/heads/'*) name=${path#/git/refs/heads/} ;;
    'POST /git/refs') name=$(jq -r '.ref | sub("^refs/heads/"; "")' "$body") ;;
    *) printf 'unexpected request: %s %s\n' "$method" "$path" >&2; exit 9 ;;
esac
file=$STATE/refs/$(printf '%s' "$name" | tr / _)
case "$method" in
    GET)
        if [ -f "$file" ]; then
            jq -n --arg sha "$(cat "$file")" '{object: {type: "commit", sha: $sha}}' >"$output"
            printf 200
        else
            printf '{}\n' >"$output"
            printf 404
        fi
        ;;
    POST)
        [ -z "${RACE_BRANCH_SHA:-}" ] || printf '%s\n' "$RACE_BRANCH_SHA" >"$file"
        if [ -f "$file" ]; then
            printf '{}\n' >"$output"
            printf 422
            exit 0
        fi
        jq -r .sha "$body" >"$file"
        printf '{}\n' >"$output"
        printf 201
        ;;
    PATCH)
        if [ ! -f "$file" ] || [ "$(jq -r .force "$body")" != true ]; then
            printf '{}\n' >"$output"
            printf 422
            exit 0
        fi
        jq -r .sha "$body" >"$file"
        printf '{}\n' >"$output"
        printf 200
        ;;
esac
CURL
chmod +x "$tmp/bin/curl"
statusOf() {
    result=0
    "$@" >"$tmp/result" 2>"$tmp/error" || result=$?
    printf '%s' "$result"
}
host() {
    sh "$release/host.sh" "$@"
}
sha=4f6e2a7fa87860ed1b1acacb21867be2e0a1b2c3
old=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
GITHUB_TOKEN=default-token
GITHUB_REPOSITORY=Acme/Shop
GITHUB_API_URL=https://api.github.test
export GITHUB_TOKEN GITHUB_REPOSITORY GITHUB_API_URL

check "an absent branch reads as empty" '' "$(host branch-read release/2026-10-12.1)"
contains "branch reads keep the branch path" 'GET /git/ref/heads/release/2026-10-12.1' "$(cat "$STATE/requests")"
contains "branch reads use the default token" 'Authorization: Bearer default-token' "$(cat "$STATE/headers")"
: >"$STATE/headers"
check "an absent release branch is created" 0 "$(RELEASE_TOKEN=workflow-token statusOf host branch-create release/2026-10-12.1 "$sha")"
contains "branch writes use the optional token" 'Authorization: Bearer workflow-token' "$(cat "$STATE/headers")"
lacks "the optional token replaces the default token" 'Authorization: Bearer default-token' "$(cat "$STATE/headers")"
check "the created branch names the commit" "$sha" "$(host branch-read release/2026-10-12.1)"
check "creation names the exact branch ref and commit" true "$(jq -s --arg sha "$sha" 'last | .ref == "refs/heads/release/2026-10-12.1" and .sha == $sha' "$STATE/bodies")"

: >"$STATE/requests"
check "an existing branch at the commit is accepted" 0 "$(statusOf host branch-create release/2026-10-12.1 "$sha")"
lacks "an existing branch at the commit is not written" 'POST' "$(cat "$STATE/requests")"
check "an existing branch elsewhere is refused distinctly" 4 "$(statusOf host branch-create release/2026-10-12.1 "$old")"
contains "the refusal names the existing commit" "$sha" "$(cat "$tmp/error")"
check "an existing branch elsewhere is left alone" "$sha" "$(host branch-read release/2026-10-12.1)"
lacks "an existing release branch is never moved" 'PATCH' "$(cat "$STATE/requests")"
lacks "an existing release branch is never recreated" 'POST' "$(cat "$STATE/requests")"

check "a lost creation race to another commit is refused distinctly" 4 "$(RACE_BRANCH_SHA=$old statusOf host branch-create release/2026-10-12.2 "$sha")"
check "a lost creation race leaves the winner" "$old" "$(host branch-read release/2026-10-12.2)"
check "a creation race to the same commit is accepted" 0 "$(RACE_BRANCH_SHA=$sha statusOf host branch-create release/2026-10-12.3 "$sha")"
check "a refused creation is an error" 2 "$(BRANCH_WRITE_STATUS=403 statusOf host branch-create release/2026-10-12.4 "$sha")"
check "a refused creation leaves no branch" '' "$(host branch-read release/2026-10-12.4)"
check "an unreadable branch is an error" 2 "$(BRANCH_READ_STATUS=500 statusOf host branch-create release/2026-10-12.4 "$sha")"
check "an unreadable branch is never written" '' "$(host branch-read release/2026-10-12.4)"
check "a failed branch read is an error" 2 "$(BRANCH_READ_STATUS=403 statusOf host branch-read release/2026-10-12.1)"

: >"$STATE/requests"
check "an absent environment branch is created by a move" 0 "$(statusOf host branch-move env/production "$sha")"
check "the environment branch names the commit" "$sha" "$(host branch-read env/production)"
check "an environment branch moves backwards" 0 "$(statusOf host branch-move env/production "$old")"
check "the environment branch names the older commit" "$old" "$(host branch-read env/production)"
check "environment moves are forced" true "$(jq -s --arg sha "$old" 'last | .sha == $sha and .force == true' "$STATE/bodies")"
contains "environment moves update the branch ref" 'PATCH /git/refs/heads/env/production' "$(cat "$STATE/requests")"
: >"$STATE/requests"
check "a move to the current commit succeeds" 0 "$(statusOf host branch-move env/production "$old")"
lacks "a move to the current commit writes nothing" 'PATCH' "$(cat "$STATE/requests")"
: >"$STATE/headers"
check "a refused move is an error" 2 "$(RELEASE_TOKEN=workflow-token BRANCH_WRITE_STATUS=403 statusOf host branch-move env/production "$sha")"
check "a refused move leaves the branch" "$old" "$(host branch-read env/production)"
contains "environment moves use the optional token" 'Authorization: Bearer workflow-token' "$(cat "$STATE/headers")"
lacks "credentials never appear in curl arguments" 'default-token' "$(cat "$STATE/calls")"
lacks "the optional token never appears in curl arguments" 'workflow-token' "$(cat "$STATE/calls")"
done_testing
