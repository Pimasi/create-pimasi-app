#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
one=$(commit "feat: scoped configuration")
publish_main
fake_host
fake_tools
cat >>"$release/deploy.sh" <<'DEPLOY'
printf '%s' "${DEPLOY_PASSWORD:-}" >"$STATE/deploy-password"
printf '%s' "${DEPLOY_REGION:-}" >"$STATE/deploy-region"
printf '%s' "${REPOSITORY_ONLY:-}" >"$STATE/repository-only"
printf '%s' "${HOST_ENVIRONMENT_SECRET:-}" >"$STATE/host-environment-secret"
DEPLOY
cat >>"$tmp/bin/make" <<'MAKE'
printf '%s%s%s%s' "${HOST_ENVIRONMENT_SECRET:-}" "${CI_JOB_TOKEN:-}" "${REPOSITORY_ONLY:-}" "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" >"$STATE/gate-host-credentials"
MAKE
RELEASE_DEPLOY_SECRETS_JSON='{"DEPLOY_PASSWORD":"environment-secret"}'
RELEASE_DEPLOY_VARS_JSON='{"DEPLOY_REGION":"environment-region","REPOSITORY_ONLY":"repository-value"}'
DEPLOY_PASSWORD=repository-secret
DEPLOY_REGION=repository-region
HOST_ENVIRONMENT_SECRET=gitlab-scoped-secret
CI_JOB_TOKEN=gitlab-job-token
ACTIONS_ID_TOKEN_REQUEST_TOKEN=github-identity-token
export RELEASE_DEPLOY_SECRETS_JSON RELEASE_DEPLOY_VARS_JSON DEPLOY_PASSWORD DEPLOY_REGION
export HOST_ENVIRONMENT_SECRET CI_JOB_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN
check "host configuration reaches the deployment" 0 "$(promote production "$one")"
check "the environment secret replaces the inherited repository value" environment-secret "$(cat "$STATE/deploy-password")"
check "the environment variable replaces the inherited repository value" environment-region "$(cat "$STATE/deploy-region")"
check "repository-only values remain available" repository-value "$(cat "$STATE/repository-only")"
check "native GitLab scoped values reach the seam" gitlab-scoped-secret "$(cat "$STATE/host-environment-secret")"
check "the gate receives no inherited project or context credential" '' "$(cat "$STATE/gate-credentials")"
check "the gate receives no native host or identity credential" '' "$(cat "$STATE/gate-host-credentials")"
lacks "the environment secret is never printed" environment-secret "$(cat "$tmp/promote.log")"
lacks "the native host secret is never printed" gitlab-scoped-secret "$(cat "$tmp/promote.log")"
done_testing
