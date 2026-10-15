#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

title=${PR_TITLE:-${CI_MERGE_REQUEST_TITLE:-}}
[ -n "$title" ] || exit 0
case "$title" in
    *'
'*) die "the request title must be one line" ;;
esac
title=$(printf '%s\n' "$title" | sed -E 's/^([Dd][Rr][Aa][Ff][Tt]:|\[[Dd][Rr][Aa][Ff][Tt]\]|\([Dd][Rr][Aa][Ff][Tt]\)|[Ww][Ii][Pp]:|\[[Ww][Ii][Pp]\]) ?//')
printf '%s\n' "$title" | grep -Eq '^(feat|fix|perf|refactor|docs|test|build|ci|chore|revert)(\([^()[:space:]]+\))?!?: [^[:space:]].*$' ||
    die "the title must look like 'feat(scope): summary' because release notes use it: $title"
