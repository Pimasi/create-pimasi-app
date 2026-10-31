#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

name=${1:?usage: compose-ssh-deploy.sh <environment> <sha> <version>}
load_environment "$name"
initialise_output
compose=$out/src/docker-compose.host.yml
missing=
for setting in RELEASE_DEPLOY_IMAGE_SERVER RELEASE_DEPLOY_IMAGE_WEB DEPLOY_SSH_TARGET DEPLOY_SSH_KEY DEPLOY_SSH_KNOWN_HOSTS RELEASE_HEALTH_URL; do
    value=$(printenv "$setting" || true)
    [ -n "$value" ] || missing="$missing $setting"
done
[ -f "$compose" ] || missing="$missing docker-compose.host.yml ($compose)"
[ -z "$missing" ] || die "missing deployment inputs:$missing"

umask 077
credentials=$(mktemp -d "$out/compose-ssh.XXXXXX")
trap 'rm -rf "$credentials"' 0
trap 'exit 130' INT
trap 'exit 143' TERM
if [ -f "$DEPLOY_SSH_KEY" ]; then
    cp "$DEPLOY_SSH_KEY" "$credentials/key"
else
    case "$DEPLOY_SSH_KEY" in
        -----BEGIN*) printf '%s\n' "$DEPLOY_SSH_KEY" >"$credentials/key" ;;
        *) printf '%s' "$DEPLOY_SSH_KEY" | base64 -d >"$credentials/key" 2>/dev/null || die "DEPLOY_SSH_KEY could not be decoded; use base64, a raw private key or a readable file path" ;;
    esac
fi
chmod 600 "$credentials/key"
if [ -f "$DEPLOY_SSH_KNOWN_HOSTS" ]; then
    cp "$DEPLOY_SSH_KNOWN_HOSTS" "$credentials/known_hosts"
else
    printf '%s\n' "$DEPLOY_SSH_KNOWN_HOSTS" >"$credentials/known_hosts"
fi

ssh_host() {
    ssh -i "$credentials/key" -o "UserKnownHostsFile=$credentials/known_hosts" \
        -o StrictHostKeyChecking=yes -o BatchMode=yes "$DEPLOY_SSH_TARGET" "$@"
}

copy_to_host() {
    scp -i "$credentials/key" -o "UserKnownHostsFile=$credentials/known_hosts" \
        -o StrictHostKeyChecking=yes -o BatchMode=yes "$1" "$DEPLOY_SSH_TARGET:$2"
}

quote() {
    jq -nr --arg value "$1" '$value | @sh'
}

project=__APP_SLUG__-$name
remote_compose=$project.yml
remote_env=$project.env
copy_to_host "$compose" "$remote_compose"
if [ -n "${DEPLOY_ENV_FILE:-}" ]; then
    if [ -f "$DEPLOY_ENV_FILE" ]; then
        env_file=$DEPLOY_ENV_FILE
    else
        env_file=$credentials/environment
        printf '%s\n' "$DEPLOY_ENV_FILE" >"$env_file"
        chmod 600 "$env_file"
    fi
    copy_to_host "$env_file" "$remote_env"
    ssh_host "chmod 600 $(quote "$remote_env")"
else
    say "DEPLOY_ENV_FILE is unset; reusing the host's $remote_env"
fi
ssh_host "test -f $(quote "$remote_env")" || die "the host's $remote_env is missing; set DEPLOY_ENV_FILE before deploying"

deploy_images="RELEASE_DEPLOY_IMAGE_SERVER=$(quote "$RELEASE_DEPLOY_IMAGE_SERVER") RELEASE_DEPLOY_IMAGE_WEB=$(quote "$RELEASE_DEPLOY_IMAGE_WEB") RELEASE_ENV_FILE=$(quote "$remote_env")"
compose_command="$deploy_images docker compose -p $(quote "$project") --env-file $(quote "$remote_env") -f $(quote "$remote_compose")"
ssh_host "$compose_command pull"
ssh_host "$compose_command up -d --wait"

if ! ssh_host "$deploy_images sh -s" <<'CLEANUP'
set -u
failed=0
for reference in "$RELEASE_DEPLOY_IMAGE_SERVER" "$RELEASE_DEPLOY_IMAGE_WEB"; do
    repository=${reference%:*}
    repository=${repository#docker.io/}
    deployed_tag=${reference##*:}
    tags=$(docker image ls --format '{{.Tag}}' "$repository") || {
        failed=1
        continue
    }
    for tag in $tags; do
        case "$tag" in
            "$deployed_tag" | '<none>') continue ;;
        esac
        if ! docker image rm "$repository:$tag"; then
            printf 'warning: kept %s:%s; it may still be in use\n' "$repository" "$tag" >&2
            failed=1
        fi
    done
done
docker image prune -f || failed=1
exit "$failed"
CLEANUP
then
    say "warning: old image cleanup failed; the rollout succeeded"
fi
