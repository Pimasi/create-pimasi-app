#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
fake_host
mkdir -p "$RELEASE_OUT/src"
printf 'JWT_SECRET=x\n' >"$RELEASE_OUT/src/.env.example"
: >"$RELEASE_OUT/src/docker-compose.yml"
if [ -f "$release_source/smoke-deploy.sh" ]; then
    cp "$release_source/smoke-deploy.sh" "$release/smoke-deploy.sh"
else
    cp "$release_source/deploy.sh" "$release/smoke-deploy.sh"
fi
cat >"$tmp/bin/docker" <<'DOCKER'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$STATE/docker-calls"
case "$1" in
    push) exit 0 ;;
    compose)
        case "$*" in
            *'config --services') printf 'pimasi-server\npimasi-web\npimasi-mongo\npimasi-redis\n'; exit 0 ;;
            *'config --format json') printf '%s\n' '{"services":{"pimasi-server":{"image":"server"},"pimasi-web":{"build":{}},"pimasi-mongo":{"build":{}},"pimasi-redis":{"image":"redis"},"helper":{"build":{}}}}'; exit 0 ;;
            *' build pimasi-mongo helper' | *' build helper pimasi-mongo') : >"$STATE/dependencies-built"; exit 0 ;;
            *' up -d --no-build pimasi-server') printf '%s\n' "${RELEASE_DEPLOY_IMAGE_SERVER:-}" >"$STATE/deploy-image"; [ -f "$STATE/dependencies-built" ]; exit $? ;;
        esac
        exit 17 ;;
esac
exit 18
DOCKER
chmod +x "$tmp/bin/docker"
RELEASE_IMAGE_SERVER=server:commit
RELEASE_IMAGE_WEB=web:commit
RELEASE_IMAGE_SERVER_VERSION=server:version
RELEASE_IMAGE_WEB_VERSION=web:version
RELEASE_DEPLOY_IMAGE_SERVER=server:version
RELEASE_DEPLOY_IMAGE_WEB=web:version
export RELEASE_IMAGE_SERVER RELEASE_IMAGE_WEB RELEASE_IMAGE_SERVER_VERSION RELEASE_IMAGE_WEB_VERSION RELEASE_DEPLOY_IMAGE_SERVER RELEASE_DEPLOY_IMAGE_WEB
for trigger in merge manual; do
    rm -f "$STATE/dependencies-built"
    : >"$STATE/docker-calls"
    : >"$STATE/calls"
    status=0
    RELEASE_TRIGGER=$trigger sh "$release/smoke-deploy.sh" production 0000000000000000000000000000000000000001 2026-10-12.1 >"$tmp/deploy.log" 2>&1 || status=$?
    check "$trigger builds stack dependencies before starting the server" 0 "$status"
    check "$trigger builds each dependency exactly once before start" 'build,start' "$(awk '/ build / {printf "build,"} / up -d / {printf "start"}' "$STATE/docker-calls")"
    lacks "$trigger does not rebuild the release web image" 'build pimasi-web' "$(cat "$STATE/docker-calls")"
    lacks "$trigger performs no push" 'push ' "$(cat "$STATE/docker-calls")"
    lacks "$trigger performs no registry login" 'host registry-login' "$(calls)"
    check "$trigger starts the deploy reference" server:version "$(cat "$STATE/deploy-image")"
done
done_testing
