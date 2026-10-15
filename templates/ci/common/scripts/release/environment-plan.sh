#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

name=${1:-}
case "$name" in
    '' | -* | *[!a-z0-9-]*) die "invalid environment name: $name" 3 ;;
esac
[ "${#name}" -le 32 ] || die "invalid environment name: $name" 3
[ -f "$(environment_file "$name")" ] || die "unknown environment: $name" 3
load_environment "$name"
jq -nc --arg environment "$name" --arg publish "$RELEASE_PUBLISH" \
    '{environment: $environment, publish: ($publish == "true")}'
