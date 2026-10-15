here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
RELEASE_MAINTAINERS_ONLY=false
. "$here/config.sh"
RELEASE_BRANCH_PREFIX=${RELEASE_BRANCH_PREFIX:-release/}
host=${RELEASE_HOST_ADAPTER:-$here/host.sh}
out=${RELEASE_OUT:-.release}

say() {
    printf '==> %s\n' "$*" >&2
}

die() {
    printf 'release: %s\n' "$1" >&2
    exit "${2:-1}"
}

short() {
    git rev-parse --short=8 "$1"
}

environment_file() {
    printf '%s/environments/%s.env' "$here" "$1"
}

initialise_output() {
    mkdir -p "$out"
    out=$(CDPATH='' cd -- "$out" && pwd)
    printf '*\n' >"$out/.gitignore"
    RELEASE_OUT=$out
    export RELEASE_OUT
}

load_environment() {
    RELEASE_PUBLISH=false
    RELEASE_ON_MERGE=false
    RELEASE_AFTER=
    RELEASE_HEALTH_URL=
    set -a
    . "$(environment_file "$1")"
    set +a
}
