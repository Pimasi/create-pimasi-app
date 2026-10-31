#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
mkdir -p "$RELEASE_OUT/src"
key_text=$(printf '%s\n' '-----BEGIN OPENSSH PRIVATE KEY-----' 'private-key-content' '-----END OPENSSH PRIVATE KEY-----')
known_hosts='host.test ssh-ed25519 pinned-host-key'
env_content=$(printf '%s\n' 'JWT_SECRET=never-log-runtime-secret' 'VALUE=spaces and '\''quotes'\''; $(touch runtime-owned)')
server_image=docker.io/team/pimasi-server-production:deployed
web_image=registry.test:5000/team/pimasi-web-production:deployed
project=__APP_SLUG__-production
printf '%s\n' "$key_text" >"$STATE/expected-key"
printf '%s\n' "$known_hosts" >"$STATE/expected-known-hosts"
cat >"$STATE/transport-auth.sh" <<'AUTH'
key=
known=
strict=
batch=
while [ "$#" -gt 0 ]; do
    case "$1" in
        -i) key=$2; shift 2 ;;
        -o)
            case "$2" in
                UserKnownHostsFile=*) known=${2#*=} ;;
                StrictHostKeyChecking=yes) strict=yes ;;
                BatchMode=yes) batch=yes ;;
                *) exit 81 ;;
            esac
            shift 2
            ;;
        -q | -T | --) shift ;;
        *) break ;;
    esac
done
[ -n "$key" ] && [ -n "$known" ] && [ "$strict" = yes ] && [ "$batch" = yes ] || exit 82
[ -f "$key" ] && [ -f "$known" ] || exit 83
[ "$(ls -ld "$key" | awk '{print substr($1, 1, 10)}')" = '-rw-------' ] || exit 84
[ "$(cat "$key")" = "$(cat "$STATE/expected-key")" ] || exit 85
[ "$(cat "$known")" = "$(cat "$STATE/expected-known-hosts")" ] || exit 86
printf '%s\n' "$key" "$known" >>"$STATE/credentials"
AUTH
cat >"$tmp/bin/ssh" <<'SSH'
#!/bin/sh
set -eu
. "$STATE/transport-auth.sh"
[ "$1" = deploy@host.test ] || exit 87
shift
printf 'ssh %s\n' "$*" >>"$STATE/calls"
[ -z "${FAIL_SSH:-}" ] || exit "$FAIL_SSH"
cd "$STATE/host"
HOME=$STATE/host
export HOME
sh -c "$*"
SSH
cat >"$tmp/bin/scp" <<'SCP'
#!/bin/sh
set -eu
. "$STATE/transport-auth.sh"
[ "$#" -eq 2 ] || exit 88
source=$1
destination=$2
case "$destination" in
    deploy@host.test:*) destination=${destination#*:} ;;
    *) exit 89 ;;
esac
case "$destination" in
    '~'* | /* | */*) exit 90 ;;
esac
printf 'scp %s\n' "$destination" >>"$STATE/calls"
case "$destination" in
    *.env)
        [ "${EXPECT_ENV_MODE:-}" != 600 ] || [ "$(ls -ld "$source" | awk '{print substr($1, 1, 10)}')" = '-rw-------' ] || exit 91
        ;;
esac
[ -z "${FAIL_COPY:-}" ] || exit "$FAIL_COPY"
cp "$source" "$STATE/host/$destination"
SCP
cat >"$tmp/bin/docker" <<'DOCKER'
#!/bin/sh
set -eu
printf 'docker %s\n' "$*" >>"$STATE/calls"
case "$1" in
    compose)
        [ "${RELEASE_DEPLOY_IMAGE_SERVER:-}" = "$EXPECTED_SERVER_IMAGE" ] || exit 92
        [ "${RELEASE_DEPLOY_IMAGE_WEB:-}" = "$EXPECTED_WEB_IMAGE" ] || exit 93
        [ "${RELEASE_ENV_FILE:-}" = "$EXPECTED_PROJECT.env" ] || exit 94
        printf '%s\n' "$RELEASE_DEPLOY_IMAGE_SERVER" "$RELEASE_DEPLOY_IMAGE_WEB" "$RELEASE_ENV_FILE" >>"$STATE/compose-env"
        printf '<%s>' "$@" >>"$STATE/compose-argv"
        printf '\n' >>"$STATE/compose-argv"
        case "$*" in
            *' up -d --wait') [ -z "${FAIL_UP:-}" ] || exit "$FAIL_UP" ;;
            *' pull') : ;;
            *) exit 95 ;;
        esac
        ;;
    image)
        shift
        case "$1" in
            ls | list)
                shift
                repository=
                while [ "$#" -gt 0 ]; do
                    case "$1" in
                        --format) shift 2 ;;
                        *) repository=$1; shift ;;
                    esac
                done
                case "$repository" in
                    "$(printf '%s' "${EXPECTED_SERVER_IMAGE%:*}" | sed 's|^docker.io/||')") tag=${EXPECTED_SERVER_IMAGE##*:} ;;
                    "${EXPECTED_WEB_IMAGE%:*}") tag=${EXPECTED_WEB_IMAGE##*:} ;;
                    *) exit 98 ;;
                esac
                printf '%s\n' "$tag" '<none>' old in-use
                ;;
            rm)
                shift
                for reference in "$@"; do
                    printf '%s\n' "$reference" >>"$STATE/removed"
                    case "$reference" in
                        *:in-use) exit 40 ;;
                        -* | *:deployed | *:'<none>') exit 99 ;;
                    esac
                done
                ;;
            prune)
                [ "$#" -eq 2 ] && [ "$2" = -f ] || exit 100
                [ -z "${FAIL_CLEANUP:-}" ] || exit "$FAIL_CLEANUP"
                ;;
            *) exit 101 ;;
        esac
        ;;
    *) exit 102 ;;
esac
DOCKER
chmod +x "$tmp/bin/ssh" "$tmp/bin/scp" "$tmp/bin/docker"
EXPECTED_SERVER_IMAGE=$server_image
EXPECTED_WEB_IMAGE=$web_image
EXPECTED_PROJECT=$project
export EXPECTED_SERVER_IMAGE EXPECTED_WEB_IMAGE EXPECTED_PROJECT

prepare() {
    rm -rf "$STATE/host" "$STATE/temporary"
    mkdir -p "$STATE/host" "$STATE/temporary"
    : >"$STATE/calls"
    : >"$STATE/credentials"
    : >"$STATE/removed"
    : >"$STATE/compose-env"
    : >"$STATE/compose-argv"
    : >"$RELEASE_OUT/src/docker-compose.host.yml"
    printf 'RELEASE_HEALTH_URL=https://api.test\n' >"$release/environments/production.env"
    RELEASE_DEPLOY_IMAGE_SERVER=$server_image
    RELEASE_DEPLOY_IMAGE_WEB=$web_image
    DEPLOY_SSH_TARGET=deploy@host.test
    DEPLOY_SSH_KEY=$(printf '%s' "$key_text" | base64 | tr -d '\n')
    DEPLOY_SSH_KNOWN_HOSTS=$known_hosts
    DEPLOY_ENV_FILE=$env_content
    EXPECT_ENV_MODE=600
    export RELEASE_DEPLOY_IMAGE_SERVER RELEASE_DEPLOY_IMAGE_WEB DEPLOY_SSH_TARGET DEPLOY_SSH_KEY DEPLOY_SSH_KNOWN_HOSTS DEPLOY_ENV_FILE EXPECT_ENV_MODE
    unset FAIL_SSH FAIL_COPY FAIL_UP FAIL_CLEANUP 2>/dev/null || true
}

run_deploy() {
    status=0
    TMPDIR=$STATE/temporary sh "$release/compose-ssh-deploy.sh" production 0000000000000000000000000000000000000001 release-tag >"$tmp/deploy.log" 2>&1 || status=$?
}

credentials_removed() {
    remaining=0
    while IFS= read -r credential; do
        [ ! -e "$credential" ] || remaining=$((remaining + 1))
    done <"$STATE/credentials"
    check "$1 removes temporary credentials" 0 "$remaining"
    check "$1 leaves no temporary secret files" '' "$(find "$STATE/temporary" -type f -print)"
    check "$1 leaves no output secret files" '' "$(find "$RELEASE_OUT" -type f ! -path "$RELEASE_OUT/src/*" ! -name .gitignore -print)"
}

prepare
unset RELEASE_DEPLOY_IMAGE_SERVER RELEASE_DEPLOY_IMAGE_WEB DEPLOY_SSH_TARGET DEPLOY_SSH_KEY DEPLOY_SSH_KNOWN_HOSTS
: >"$release/environments/production.env"
rm "$RELEASE_OUT/src/docker-compose.host.yml"
run_deploy
check 'pre-flight rejects missing inputs' 1 "$([ "$status" -ne 0 ] && printf 1 || printf 0)"
for setting in RELEASE_DEPLOY_IMAGE_SERVER RELEASE_DEPLOY_IMAGE_WEB DEPLOY_SSH_TARGET DEPLOY_SSH_KEY DEPLOY_SSH_KNOWN_HOSTS RELEASE_HEALTH_URL docker-compose.host.yml; do
    contains "pre-flight names $setting" "$setting" "$(cat "$tmp/deploy.log")"
done
check 'pre-flight contacts no host' '' "$(calls)"
credentials_removed 'pre-flight'

prepare
rm "$RELEASE_OUT/src/docker-compose.host.yml"
run_deploy
check 'a missing host Compose file fails' 1 "$([ "$status" -ne 0 ] && printf 1 || printf 0)"
contains 'the missing host Compose file is named' docker-compose.host.yml "$(cat "$tmp/deploy.log")"
check 'a missing host Compose file fails before host access' '' "$(calls)"

prepare
run_deploy
check 'content secrets and a base64 key deploy successfully' 0 "$status"
check 'the host receives the Compose file' 1 "$([ -f "$STATE/host/$project.yml" ] && printf 1 || printf 0)"
check 'the host receives exact runtime env content' 1 "$([ "$(cat "$STATE/host/$project.env" 2>/dev/null || true)" = "$env_content" ] && printf 1 || printf 0)"
check 'the remote env is mode 600' '-rw-------' "$(ls -ld "$STATE/host/$project.env" 2>/dev/null | awk '{print substr($1, 1, 10)}')"
contains 'remote chmod sets the runtime env permissions' 'chmod 600' "$(calls)"
lacks 'the env content stays out of logs' never-log-runtime-secret "$(cat "$tmp/deploy.log"; calls)"
lacks 'the key stays out of logs' private-key-content "$(cat "$tmp/deploy.log"; calls)"
check 'both Compose commands preserve every deploy value' 6 "$(wc -l <"$STATE/compose-env" | tr -d ' ')"
while IFS= read -r compose_call; do
    contains 'each Compose command uses the project name' "<-p><$project>" "$compose_call"
    contains 'each Compose command pins the env file' "<--env-file><$project.env>" "$compose_call"
    contains 'each Compose command pins the Compose file' "<-f><$project.yml>" "$compose_call"
done <"$STATE/compose-argv"
check 'rollout and cleanup follow the required order' 'compose,env,pull,up,cleanup,prune,' "$(awk '/^scp .*\.yml$/ {printf "compose,"} /^scp .*\.env$/ {printf "env,"} /^docker compose .* pull$/ {printf "pull,"} /^docker compose .* up -d --wait$/ {printf "up,"} /^docker image ls/ && !seen++ {printf "cleanup,"} /^docker image prune/ {printf "prune,"}' "$STATE/calls")"
for repository in team/pimasi-server-production registry.test:5000/team/pimasi-web-production; do
    contains "cleanup removes old tags for $repository" "$repository:old" "$(cat "$STATE/removed")"
    contains "cleanup tries an in-use tag for $repository" "$repository:in-use" "$(cat "$STATE/removed")"
    lacks "cleanup keeps the deployed tag for $repository" "$repository:deployed" "$(cat "$STATE/removed")"
    lacks "cleanup keeps untagged images for $repository" "$repository:<none>" "$(cat "$STATE/removed")"
done
contains 'cleanup reports images kept in use' in-use "$(cat "$tmp/deploy.log")"
contains 'cleanup prunes dangling images' 'docker image prune -f' "$(calls)"
lacks 'cleanup never prunes all images' 'prune -a' "$(calls)"
lacks 'cleanup never prunes the host system' 'system prune' "$(calls)"
credentials_removed 'successful deployment'

prepare
printf '%s\n' "$env_content" >"$tmp/runtime.env"
printf '%s\n' "$key_text" >"$tmp/key"
printf '%s\n' "$known_hosts" >"$tmp/known-hosts"
DEPLOY_ENV_FILE=$tmp/runtime.env
DEPLOY_SSH_KEY=$tmp/key
DEPLOY_SSH_KNOWN_HOSTS=$tmp/known-hosts
EXPECT_ENV_MODE=
run_deploy
check 'file secrets and a file key deploy successfully' 0 "$status"
check 'file env content reaches the host' 1 "$([ "$(cat "$STATE/host/$project.env" 2>/dev/null || true)" = "$env_content" ] && printf 1 || printf 0)"
check 'the caller key file remains intact' 1 "$([ -f "$tmp/key" ] && printf 1 || printf 0)"
check 'the caller known-hosts file remains intact' 1 "$([ -f "$tmp/known-hosts" ] && printf 1 || printf 0)"
credentials_removed 'file credentials'

prepare
DEPLOY_SSH_KEY=$key_text
run_deploy
check 'a raw key deploys successfully' 0 "$status"
credentials_removed 'raw credentials'

prepare
DEPLOY_SSH_KEY='a==='
run_deploy
check 'an undecodable key fails' 1 "$([ "$status" -ne 0 ] && printf 1 || printf 0)"
contains 'an undecodable key names its setting' DEPLOY_SSH_KEY "$(cat "$tmp/deploy.log")"
check 'an undecodable key contacts no host' '' "$(calls)"
credentials_removed 'undecodable credentials'

prepare
unset DEPLOY_ENV_FILE
run_deploy
check 'an absent remote env fails' 1 "$([ "$status" -ne 0 ] && printf 1 || printf 0)"
contains 'an absent remote env names DEPLOY_ENV_FILE' DEPLOY_ENV_FILE "$(cat "$tmp/deploy.log")"
lacks 'an absent remote env prevents pull and up' 'docker compose' "$(calls)"
lacks 'an absent remote env prevents cleanup' 'docker image' "$(calls)"
credentials_removed 'missing remote env'

prepare
unset DEPLOY_ENV_FILE
printf '%s\n' "$env_content" >"$STATE/host/$project.env"
run_deploy
check 'an existing remote env is reused' 0 "$status"
contains 'reuse is reported' reus "$(cat "$tmp/deploy.log")"
lacks 'reuse does not copy another runtime env' "scp $project.env" "$(calls)"
credentials_removed 'reused remote env'

for failure in FAIL_COPY FAIL_SSH FAIL_UP; do
    prepare
    export "$failure=31"
    run_deploy
    check "$failure fails deployment" 1 "$([ "$status" -ne 0 ] && printf 1 || printf 0)"
    lacks "$failure prevents cleanup" 'docker image' "$(calls)"
    credentials_removed "$failure"
done

prepare
FAIL_CLEANUP=32
export FAIL_CLEANUP
run_deploy
check 'cleanup failure keeps deployment successful' 0 "$status"
contains 'cleanup failure prints a warning' warn "$(tr '[:upper:]' '[:lower:]' <"$tmp/deploy.log")"
credentials_removed 'failed cleanup'

prepare
RELEASE_DEPLOY_IMAGE_SERVER="docker.io/team/pimasi-server-production:release'one"
RELEASE_DEPLOY_IMAGE_WEB='registry.test:5000/team/pimasi-web-production:release$two'
EXPECTED_SERVER_IMAGE=$RELEASE_DEPLOY_IMAGE_SERVER
EXPECTED_WEB_IMAGE=$RELEASE_DEPLOY_IMAGE_WEB
run_deploy
check 'remote shell quoting preserves both references' 0 "$status"
credentials_removed 'quoted references'
done_testing
