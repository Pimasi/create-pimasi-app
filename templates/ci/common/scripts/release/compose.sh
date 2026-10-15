#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

source_dir=$(CDPATH='' cd -- "$1" && pwd)
compose_mode=$2
shift 2
[ -f "$source_dir/.env" ] || cp "$source_dir/.env.example" "$source_dir/.env"
services=$(docker compose --project-name "__APP_SLUG__-release" --project-directory "$source_dir" -f "$source_dir/docker-compose.yml" config --services)
if [ "$compose_mode" = release ]; then
    set -- -f "$here/../../docker-compose.release.yml" "$@"
elif [ "$compose_mode" != ci ]; then
    die "unknown compose mode: $compose_mode"
fi
for service in $services; do
    case "$service" in
        pimasi-web) set -- -f "$here/../../docker-compose.ci.web.yml" "$@" ;;
        pimasi-mongo) set -- -f "$here/../../docker-compose.ci.mongo.yml" "$@" ;;
        pimasi-postgres) set -- -f "$here/../../docker-compose.ci.postgres.yml" "$@" ;;
        pimasi-redis) set -- -f "$here/../../docker-compose.ci.redis.yml" "$@" ;;
    esac
done
exec docker compose --project-name "__APP_SLUG__-release" --project-directory "$source_dir" -f "$source_dir/docker-compose.yml" -f "$here/../../docker-compose.ci.yml" "$@"
