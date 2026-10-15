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
            *' up -d --no-build pimasi-server') [ -f "$STATE/dependencies-built" ]; exit $? ;;
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
export RELEASE_IMAGE_SERVER RELEASE_IMAGE_WEB RELEASE_IMAGE_SERVER_VERSION RELEASE_IMAGE_WEB_VERSION
for trigger in merge manual; do
    rm -f "$STATE/dependencies-built"
    : >"$STATE/docker-calls"
    status=0
    RELEASE_TRIGGER=$trigger sh "$release/smoke-deploy.sh" production 0000000000000000000000000000000000000001 2026-10-12.1 >"$tmp/deploy.log" 2>&1 || status=$?
    check "$trigger builds stack dependencies before starting the server" 0 "$status"
    check "$trigger builds each dependency exactly once before start" 'build,start' "$(awk '/ build / {printf "build,"} / up -d / {printf "start"}' "$STATE/docker-calls")"
    lacks "$trigger does not rebuild the release web image" 'build pimasi-web' "$(cat "$STATE/docker-calls")"
    contains "$trigger pushes the version aliases" 'push server:version' "$(cat "$STATE/docker-calls")"
done
done_testing
