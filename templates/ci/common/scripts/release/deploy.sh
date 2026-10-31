#!/bin/sh
set -eu
exec sh "$(dirname -- "$0")/smoke-deploy.sh" "$@"
