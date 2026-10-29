#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
fake_host
cat >"$tmp/bin/docker" <<'DOCKER'
#!/bin/sh
set -eu
printf 'docker %s\n' "$*" >>"$STATE/calls"
[ "$1" = push ] || exit 18
exit "${FAIL_PUSH:-0}"
DOCKER
chmod +x "$tmp/bin/docker"
mkdir -p "$RELEASE_OUT"
cat >"$RELEASE_OUT/images.env" <<'IMAGES'
RELEASE_IMAGE_SERVER=server:commit
RELEASE_IMAGE_WEB=web:commit
RELEASE_IMAGE_SERVER_VERSION=server:version
RELEASE_IMAGE_WEB_VERSION=web:version
IMAGES
sha=1234567890abcdef1234567890abcdef12345678
status=0
sh "$release/push.sh" production "$sha" 2026-10-12.1 >"$tmp/push.log" 2>&1 || status=$?
check "publishing pushes succeed" 0 "$status"
check "publishing logs in before pushing all four references" 'host registry-login,docker push server:commit,docker push web:commit,docker push server:version,docker push web:version' "$(calls | paste -sd, -)"
cat >"$RELEASE_OUT/images.env" <<'IMAGES'
RELEASE_IMAGE_SERVER=server:commit
RELEASE_IMAGE_WEB=web:commit
RELEASE_IMAGE_SERVER_VERSION=
RELEASE_IMAGE_WEB_VERSION=
IMAGES
: >"$STATE/calls"
status=0
sh "$release/push.sh" uat "$sha" "" >"$tmp/push.log" 2>&1 || status=$?
check "non-publishing pushes succeed" 0 "$status"
check "non-publishing logs in before pushing only commit references" 'host registry-login,docker push server:commit,docker push web:commit' "$(calls | paste -sd, -)"
: >"$STATE/calls"
status=0
FAIL_PUSH=19 sh "$release/push.sh" production "$sha" 2026-10-12.1 >"$tmp/push.log" 2>&1 || status=$?
check "a failed push preserves its status" 19 "$status"
check "a failed first push stops further pushes" 'host registry-login,docker push server:commit' "$(calls | paste -sd, -)"
: >"$STATE/calls"
status=0
FAIL_LOGIN=23 sh "$release/push.sh" production "$sha" 2026-10-12.1 >"$tmp/push.log" 2>&1 || status=$?
check "a failed login preserves its status" 23 "$status"
check "a failed login pushes nothing" 'host registry-login' "$(calls)"
rm "$RELEASE_OUT/images.env"
: >"$STATE/calls"
status=0
sh "$release/push.sh" production "$sha" 2026-10-12.1 >"$tmp/push.log" 2>&1 || status=$?
check "missing images.env fails the push" true "$(if [ "$status" -ne 0 ]; then printf true; else printf false; fi)"
check "missing images.env never logs in or pushes" '' "$(calls)"
done_testing
