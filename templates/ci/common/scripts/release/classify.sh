#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

candidate=$(git rev-parse --verify --quiet "${2:-missing}^{commit}") || die "unknown commit: ${2:-}" 3
if [ -n "${1:-}" ] && ! git cat-file -e "$1^{commit}" 2>/dev/null; then
    case "$1" in
        *[!0-9a-fA-F]*) ;;
        *)
            if [ "${#1}" -eq 40 ]; then
                git fetch --quiet origin "$1" 2>/dev/null || say "warning: previous live commit $1 is unavailable; the baseline is unknown"
            fi
            ;;
    esac
fi
base=$(git rev-parse --verify --quiet "${1:-missing}^{commit}") || {
    printf 'no-baseline - %s\n' "$candidate"
    exit 0
}

main=$(git rev-parse --verify --quiet "origin/$RELEASE_MAIN^{commit}" || true)
if [ -n "$main" ] && git rev-list --first-parent "$main" | grep -Fx "$candidate" >/dev/null &&
    ! git rev-list --first-parent "$main" | grep -Fx "$base" >/dev/null; then
    if hotfix=$(sh "$here/hotfix.sh" "$base" --historical 2>/dev/null); then
        releaseBase=$(printf '%s\n' "$hotfix" | jq -r '.base_sha')
        if [ "$candidate" != "$releaseBase" ] && git merge-base --is-ancestor "$releaseBase" "$candidate"; then
            base=$releaseBase
        fi
    else
        status=$?
        [ "$status" -eq 3 ] || die "could not inspect live hotfix $base" "$status"
    fi
fi

if [ "$base" = "$candidate" ]; then
    printf 'same %s %s\n' "$base" "$candidate"
elif git merge-base --is-ancestor "$base" "$candidate"; then
    printf 'range %s %s\n' "$base" "$candidate"
elif git merge-base --is-ancestor "$candidate" "$base"; then
    printf 'rollback %s %s\n' "$base" "$candidate"
else
    printf 'no-baseline %s %s\n' "$base" "$candidate"
fi
