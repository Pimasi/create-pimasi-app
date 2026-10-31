#!/bin/sh
. "$(dirname -- "$0")/harness.sh"

mkdir -p "$tmp/app"
printf 'JWT_SECRET=x\n' >"$tmp/app/.env.example"
: >"$tmp/app/docker-compose.yml"
cat >"$tmp/bin/docker" <<'DOCKER'
#!/bin/sh
printf '%s\n' "$*" >>"$STATE/calls"
case "$*" in
    *'config --services') printf '%s\n' "$COMPOSE_SERVICES" ;;
esac
DOCKER
chmod +x "$tmp/bin/docker"

for database in mongo postgres; do
    case "$database" in
        mongo) database_service=pimasi-mongo ;;
        postgres) database_service=pimasi-postgres ;;
    esac
    for redis in absent present; do
        COMPOSE_SERVICES=$(printf 'pimasi-server\npimasi-web\n%s\n' "$database_service")
        if [ "$redis" = present ]; then
            COMPOSE_SERVICES=$(printf '%s\npimasi-redis\n' "$COMPOSE_SERVICES")
        fi
        export COMPOSE_SERVICES
        : >"$STATE/calls"
        sh "$release/compose.sh" "$tmp/app" ci up -d --build --wait pimasi-server
        invocation=$(tail -n 1 "$STATE/calls")
        contains "$database override selected with redis $redis" "docker-compose.ci.$database.yml" "$invocation"
        contains "shared override selected with $database and redis $redis" "docker-compose.ci.yml" "$invocation"
        other_database=mongo
        [ "$database" != mongo ] || other_database=postgres
        lacks "absent database is not introduced" "docker-compose.ci.$other_database.yml" "$invocation"
        if [ "$redis" = present ]; then
            contains "redis override selected" "docker-compose.ci.redis.yml" "$invocation"
        else
            lacks "absent redis is not introduced" "docker-compose.ci.redis.yml" "$invocation"
        fi
    done
done
check "compose prepares the environment" "JWT_SECRET=x" "$(cat "$tmp/app/.env")"
sh "$release/compose.sh" "$tmp/app" release up -d --no-build pimasi-server
contains "smoke check selects production override" "docker-compose.release.yml" "$(tail -n 1 "$STATE/calls")"
status=0
sh "$release/compose.sh" "$tmp/app" unknown up >/dev/null 2>&1 || status=$?
check "unknown compose mode is refused" "1" "$status"


COMPOSE_SERVICES=pimasi-server
export COMPOSE_SERVICES
: >"$STATE/calls"
sh "$release/compose.sh" "$tmp/app" ci up -d --build --wait pimasi-server
lacks "a removed web service stays absent" 'docker-compose.ci.web.yml' "$(tail -n 1 "$STATE/calls")"
lacks "the common override does not introduce the web service" 'pimasi-web:' "$(cat "$release/../../docker-compose.ci.yml")"
contains "the common override selects the production server target" 'target: prod' "$(cat "$release/../../docker-compose.ci.yml")"
contains "the common override clears the development command" 'command: !reset null' "$(cat "$release/../../docker-compose.ci.yml")"
contains "the common override clears development watches" 'develop: !reset null' "$(cat "$release/../../docker-compose.ci.yml")"
contains "the common override clears development volumes" 'volumes: !reset []' "$(cat "$release/../../docker-compose.ci.yml")"
contains "the release override requires the deploy reference" '${RELEASE_DEPLOY_IMAGE_SERVER:?RELEASE_DEPLOY_IMAGE_SERVER is required}' "$(cat "$release/../../docker-compose.release.yml")"
contains "the release override enables rate limiting" 'RATE_LIMIT_ENABLED: "true"' "$(cat "$release/../../docker-compose.release.yml")"
COMPOSE_SERVICES=$(printf 'pimasi-server\npimasi-web')
export COMPOSE_SERVICES
sh "$release/compose.sh" "$tmp/app" ci up -d --build --wait pimasi-server
contains "an existing web service receives its port override" 'docker-compose.ci.web.yml' "$(tail -n 1 "$STATE/calls")"
printf 'JWT_SECRET=kept\n' >"$tmp/app/.env"
sh "$release/compose.sh" "$tmp/app" ci up -d --build --wait pimasi-server
check "existing local configuration survives compose" 'JWT_SECRET=kept' "$(cat "$tmp/app/.env")"

done_testing
