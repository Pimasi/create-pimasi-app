#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

initialise_output
sh "$host" registry-login
docker push "$RELEASE_IMAGE_SERVER"
docker push "$RELEASE_IMAGE_WEB"
[ -z "${RELEASE_IMAGE_SERVER_VERSION:-}" ] || docker push "$RELEASE_IMAGE_SERVER_VERSION"
[ -z "${RELEASE_IMAGE_WEB_VERSION:-}" ] || docker push "$RELEASE_IMAGE_WEB_VERSION"
say "no deploy target is configured: starting $RELEASE_IMAGE_SERVER on this runner as a smoke check"
configuration=$(sh "$here/compose.sh" "$out/src" release config --format json)
services=$(printf '%s\n' "$configuration" | jq -r '.services | to_entries[] | select(.value.build != null and .key != "pimasi-server" and .key != "pimasi-web") | .key')
set --
for service in $services; do
    set -- "$@" "$service"
done
if [ "$#" -gt 0 ]; then
    sh "$here/compose.sh" "$out/src" release build "$@"
fi
sh "$here/compose.sh" "$out/src" release up -d --no-build pimasi-server
