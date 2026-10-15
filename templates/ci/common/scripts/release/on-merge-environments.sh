#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

records=$(for file in "$here"/environments/*.env; do
    [ -f "$file" ] || continue
    name=${file##*/}
    name=${name%.env}
    case "$name" in
        '' | -* | *[!a-z0-9-]*) die "invalid environment name: $name" ;;
    esac
    [ "${#name}" -le 32 ] || die "invalid environment name: $name"
    load_environment "$name"
    if [ "$RELEASE_ON_MERGE" = true ]; then
        jq -nc --arg environment "$name" --arg publish "$RELEASE_PUBLISH" \
            '{environment: $environment, publish: ($publish == "true")}'
    fi
done)
printf '%s\n' "$records" | jq -sc .
