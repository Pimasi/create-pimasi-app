#!/bin/sh
set -eu

exec docker run --rm --user "$(id -u):$(id -g)" -e HUSKY=0 -e npm_config_cache=/tmp/npm-cache \
    -v "$(pwd):/app" -w /app node:lts-slim \
    sh -c 'npm ci && npm run type-check && npx prettier --check . "!./.release/**"'
