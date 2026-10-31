#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

finish() {
    status=$?
    trap - 0 INT TERM
    if ! sh "$here/compose.sh" . ci down -v; then
        say "warning: gate teardown failed"
        [ "$status" -ne 0 ] || status=1
    fi
    exit "$status"
}
trap finish 0
trap 'exit 130' INT
trap 'exit 143' TERM

sh "$here/check-title.sh"
sh "$here/ci-checks.sh"
sh "$here/compose.sh" . ci up -d --build --wait pimasi-server
RELEASE_TOOLS=$here
export RELEASE_TOOLS
make -f Makefile test
