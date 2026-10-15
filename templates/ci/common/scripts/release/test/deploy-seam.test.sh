#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
fake_host
cp "$release_source/deploy.sh" "$release/deploy.sh"
mkdir -p "$RELEASE_OUT/src"
printf 'JWT_SECRET=x\n' >"$RELEASE_OUT/src/.env.example"
: >"$RELEASE_OUT/src/docker-compose.yml"
: >"$STATE/docker-calls"
cat >"$tmp/bin/docker" <<'DOCKER'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$STATE/docker-calls"
case "$1" in
    push) exit "${FAIL_PUSH:-0}" ;;
    compose)
        case "$*" in
            *'config --services') printf 'pimasi-server\npimasi-web\npimasi-mongo\n'; exit 0 ;;
            *'config --format json') printf '%s\n' '{"services":{"pimasi-server":{"image":"server"},"pimasi-web":{"build":{}},"pimasi-mongo":{"build":{}}}}'; exit 0 ;;
            *' build pimasi-mongo') : >"$STATE/dependencies-built"; exit 0 ;;
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
status=0
sh "$release/deploy.sh" production 0000000000000000000000000000000000000001 2026-10-12.1 >"$tmp/deploy.log" 2>&1 || status=$?
check "the shipped seam completes its smoke deployment" 0 "$status"
check "the shipped seam pushes both commit and version images" 4 "$(grep -c '^push ' "$STATE/docker-calls" || true)"
check "the shipped seam builds dependencies before startup" 'build,start' "$(awk '/ build / {printf "build,"} / up -d / {printf "start"}' "$STATE/docker-calls")"
contains "the shipped seam authenticates before pushing" 'host registry-login' "$(calls)"
status=0
FAIL_PUSH=19 sh "$release/deploy.sh" production 0000000000000000000000000000000000000001 2026-10-12.1 >"$tmp/deploy-failed.log" 2>&1 || status=$?
check "the shipped seam preserves its failing push status" 19 "$status"
done_testing
