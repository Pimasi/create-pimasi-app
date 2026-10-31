#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

initialise_output
. "$out/images.env"
sh "$host" registry-login
docker push "$RELEASE_IMAGE_SERVER"
docker push "$RELEASE_IMAGE_WEB"
[ -z "$RELEASE_IMAGE_SERVER_VERSION" ] || docker push "$RELEASE_IMAGE_SERVER_VERSION"
[ -z "$RELEASE_IMAGE_WEB_VERSION" ] || docker push "$RELEASE_IMAGE_WEB_VERSION"
