#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

name=${1:-}
sha=${2:-}

case "$name" in
    '' | *[!a-z0-9-]*) die "environment must use lower-case letters, digits and dashes" 3 ;;
esac
[ -f "$(environment_file "$name")" ] || die "unknown environment: $name" 3

case "$sha" in
    *[!0-9a-fA-F]*) die "the commit must be 40 hex characters" 3 ;;
esac
[ "${#sha}" -eq 40 ] || die "the commit must be 40 hex characters" 3

[ "$(git rev-parse --is-shallow-repository)" = false ] || die "shallow clone: fetch the full history first" 3
sha=$(printf '%s' "$sha" | tr '[:upper:]' '[:lower:]')
[ "$(git cat-file -t "$sha" 2>/dev/null)" = commit ] || die "$sha is not a commit in this clone" 3
kind=normal
if ! git rev-list --first-parent "origin/$RELEASE_MAIN" | grep -qx "$sha"; then
    hotfixBase=$(sh "$here/hotfix.sh" "$sha" --admit) || exit "$?"
    kind="hotfix $hotfixBase"
fi

load_environment "$name"
if [ -n "$RELEASE_AFTER" ]; then
    case "$RELEASE_AFTER" in
        *[!a-z0-9-]*) die "invalid prerequisite environment: $RELEASE_AFTER" 3 ;;
    esac
    [ -f "$(environment_file "$RELEASE_AFTER")" ] || die "unknown prerequisite environment: $RELEASE_AFTER" 3
    previous=$(sh "$host" marker-read "$RELEASE_AFTER") || die "could not read the live record for $RELEASE_AFTER" 3
    [ -n "$previous" ] || die "$RELEASE_AFTER has no finalised release record" 3
    if ! git cat-file -e "$previous^{commit}" 2>/dev/null; then
        git fetch --quiet origin "$previous" 2>/dev/null || die "could not fetch live commit $previous for prerequisite environment $RELEASE_AFTER from origin" 3
    fi
    git merge-base --is-ancestor "$sha" "$previous" || die "commit $sha is ahead of or unrelated to $RELEASE_AFTER" 3
fi
if [ "${3:-}" = --kind ]; then
    printf '%s\n' "$kind"
fi
