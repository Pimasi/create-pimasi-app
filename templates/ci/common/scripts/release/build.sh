#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

name=$1
sha=$2
version=$3
source_dir=$4
initialise_output
load_environment "$name"
prefix=$(sh "$host" image-prefix | tr '[:upper:]' '[:lower:]')
tag=$(printf '%.12s' "$sha")
label=${version:-sha-$tag}
server=$prefix/$name/pimasi-server:$tag
web=$prefix/$name/pimasi-web:$tag

set --
for key in VITE_API_URL VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_APP_ID NEXT_PUBLIC_API_URL NEXT_PUBLIC_PUBLIC_WEB_URL NEXT_PUBLIC_FIREBASE_API_KEY NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN NEXT_PUBLIC_FIREBASE_PROJECT_ID NEXT_PUBLIC_FIREBASE_APP_ID; do
    value=$(printenv "$key" || true)
    set -- "$@" --build-arg "$key=$value"
done
serverVersion=
webVersion=
if [ -n "$version" ]; then
    serverVersion=$prefix/$name/pimasi-server:$version
    webVersion=$prefix/$name/pimasi-web:$version
fi
(
    set --
    [ -z "$serverVersion" ] || set -- -t "$serverVersion"
    docker build -f "$source_dir/Dockerfile.server" --target prod --build-arg "APP_VERSION=$label" --build-arg "GIT_SHA=$sha" -t "$server" "$@" "$source_dir"
)
[ -z "$webVersion" ] || set -- "$@" -t "$webVersion"
docker build -f "$source_dir/Dockerfile.web" --target prod --build-arg "APP_VERSION=$label" --build-arg "GIT_SHA=$sha" "$@" -t "$web" "$source_dir"
printf 'RELEASE_IMAGE_SERVER=%s\nRELEASE_IMAGE_WEB=%s\nRELEASE_IMAGE_SERVER_VERSION=%s\nRELEASE_IMAGE_WEB_VERSION=%s\n' "$server" "$web" "$serverVersion" "$webVersion" >"$out/images.env"
