#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

if [ "${GITHUB_EVENT_NAME:-}" = push ] && [ "${GITHUB_REF:-}" = "refs/heads/$RELEASE_MAIN" ]; then
    exec sh "$here/preview.sh" "${GITHUB_SHA:-HEAD}"
fi
if [ "${CI_PIPELINE_SOURCE:-}" = push ] && [ "${CI_COMMIT_BRANCH:-}" = "$RELEASE_MAIN" ]; then
    exec sh "$here/preview.sh" "${CI_COMMIT_SHA:-HEAD}"
fi
