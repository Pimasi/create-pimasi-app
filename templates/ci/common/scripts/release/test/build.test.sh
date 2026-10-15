#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
mkdir -p "$tmp/tools/environments" "$tmp/source"
cp "$release/build.sh" "$release/lib.sh" "$release/config.sh" "$tmp/tools/"
cat >"$tmp/host.sh" <<'HOST'
#!/bin/sh
[ "$1" = image-prefix ] || exit 1
printf 'Registry.Invalid/Group/Project\n'
HOST
cat >"$tmp/bin/docker" <<'DOCKER'
#!/bin/sh
jq -cn --args '$ARGS.positional' -- "$@" >>"$STATE/builds.jsonl"
[ -z "${FAIL_BUILD:-}" ]
DOCKER
chmod +x "$tmp/bin/docker"
cat >"$tmp/tools/environments/production.env" <<'ENV'
RELEASE_PUBLISH=true
VITE_API_URL=https://api.production.invalid
NEXT_PUBLIC_API_URL=https://api.production.invalid
VITE_FIREBASE_API_KEY='a key with spaces and "quotes"'
ENV
cat >"$tmp/tools/environments/uat.env" <<'ENV'
RELEASE_PUBLISH=false
VITE_API_URL=https://api.uat.invalid
NEXT_PUBLIC_API_URL=https://api.uat.invalid
ENV
sha=1234567890abcdef1234567890abcdef12345678
sh "$tmp/tools/build.sh" production "$sha" 2026-10-12.1 "$tmp/source"
check "exactly two images are built" "2" "$(jq -s length "$STATE/builds.jsonl")"
check "both builds use the promoted source directory" "true" "$(jq -s --arg source "$tmp/source" 'all(.[]; .[-1] == $source)' "$STATE/builds.jsonl")"
check "both builds select the production target" "true" "$(jq -s 'all(.[]; .[index("--target") + 1] == "prod")' "$STATE/builds.jsonl")"
check "both images contain the version build argument" "true" "$(jq -s 'all(.[]; index("APP_VERSION=2026-10-12.1") != null)' "$STATE/builds.jsonl")"
check "both images contain the exact SHA build argument" "true" "$(jq -s --arg value "GIT_SHA=$sha" 'all(.[]; index($value) != null)' "$STATE/builds.jsonl")"
check "the web API URL comes from its environment" "true" "$(jq -s '.[1] | index("VITE_API_URL=https://api.production.invalid") != null and index("NEXT_PUBLIC_API_URL=https://api.production.invalid") != null' "$STATE/builds.jsonl")"
check "build arguments preserve spaces and quotes" "true" "$(jq -s '.[1] | index("VITE_FIREBASE_API_KEY=a key with spaces and \"quotes\"") != null' "$STATE/builds.jsonl")"
. "$RELEASE_OUT/images.env"
check "the server image name is lower case and environment scoped" "registry.invalid/group/project/production/pimasi-server:1234567890ab" "$RELEASE_IMAGE_SERVER"
check "the web image name is lower case and environment scoped" "registry.invalid/group/project/production/pimasi-web:1234567890ab" "$RELEASE_IMAGE_WEB"
check "publishing builds also tag the same images with the version" "true" "$(jq -s 'all(.[]; any(.[]; endswith(":2026-10-12.1")))' "$STATE/builds.jsonl")"
: >"$STATE/builds.jsonl"
sh "$tmp/tools/build.sh" uat "$sha" "" "$tmp/source"
. "$RELEASE_OUT/images.env"
contains "uat images use a separate registry path" "/uat/" "$RELEASE_IMAGE_WEB"
check "uat uses its own baked API URL" "true" "$(jq -s '.[1] | index("VITE_API_URL=https://api.uat.invalid") != null' "$STATE/builds.jsonl")"
check "non-publishing builds are labelled by commit" "true" "$(jq -s 'all(.[]; index("APP_VERSION=sha-1234567890ab") != null)' "$STATE/builds.jsonl")"
check "non-publishing builds have no version tag" "true" "$(jq -s 'all(.[]; [ .[] | select(. == "-t") ] | length == 1)' "$STATE/builds.jsonl")"
status=0
FAIL_BUILD=1 sh "$tmp/tools/build.sh" production "$sha" 2026-10-12.1 "$tmp/source" >/dev/null 2>&1 || status=$?
check "a failed image build fails the stage" "1" "$status"
done_testing
