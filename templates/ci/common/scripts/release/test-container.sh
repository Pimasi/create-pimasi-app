#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

initialise_output
mkdir -p "$out/tests"
exec docker run --rm -v "$here/../..:/app:ro" -v "$out/tests:/release-work" \
    -e TMPDIR=/release-work -w /app docker:29-cli \
    sh -c 'apk add --no-cache make curl jq git tzdata && sh scripts/release/test/run.sh'
