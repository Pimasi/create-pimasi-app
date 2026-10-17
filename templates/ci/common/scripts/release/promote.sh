#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

name=${RELEASE_ENV:-}
sha=${RELEASE_SHA:-}
stage=admit
version=
recordedVersion=
mode=
base=
outcome=failed
publication_failure=
health_url=
src=
attempt=0

initialise_output
: >"$out/notes.md"

finish() {
    status=$?
    trap - 0 INT TERM
    if [ "$status" -ne 0 ]; then
        case "$outcome" in
            succeeded)
                if [ "$stage" != done ]; then
                    outcome='succeeded, publication incomplete'
                    version=$recordedVersion
                fi
                ;;
            'succeeded, publication incomplete') ;;
            *) outcome=failed ;;
        esac
        if [ "$status" -eq 3 ]; then
            case "$stage" in
                admit | baseline) outcome=rejected ;;
            esac
        fi
    fi
    jq -nr --arg outcome "$outcome" --arg stage "$stage" --arg environment "$name" \
        --arg sha "$sha" --arg version "$version" --arg mode "$mode" --arg base "$base" \
        --arg health_url "$health_url" --arg attempt "$attempt" --arg publication_failure "$publication_failure" '
        $ARGS.named | to_entries[] | .key + "=" + (.value | @sh)
    ' >"$out/outcome.env"
    sh "$here/notify.sh" || say "warning: the release summary failed"
    if [ -n "$src" ] && [ -f "$src/docker-compose.yml" ]; then
        sh "$here/compose.sh" "$src" ci down -v || say "warning: the runner stack could not be removed"
    fi
    exit "$status"
}
trap finish 0
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$RELEASE_MAINTAINERS_ONLY" = true ] && [ "${GITHUB_ACTIONS:-}" = true ] && [ -z "${RELEASE_TOKEN:-}" ]; then
    die "Maintainer-only releases are on, so a GitHub promotion needs RELEASE_TOKEN as a secret on its environment; see \"Maintainer-only releases\" in RELEASE.md" 3
fi
if [ "${RELEASE_TRIGGER:-}" = merge ]; then
    git fetch --quiet origin "refs/heads/$RELEASE_MAIN:refs/remotes/origin/$RELEASE_MAIN"
fi
admission=$(sh "$here/admit.sh" "$name" "$sha" --kind)
sha=$(git rev-parse --verify "$sha^{commit}")
read -r RELEASE_CANDIDATE_KIND RELEASE_HOTFIX_BASE RELEASE_HOTFIX_TAG <<EOF
$admission
EOF
RELEASE_HOTFIX_SHA=$sha
export RELEASE_CANDIDATE_KIND RELEASE_HOTFIX_SHA RELEASE_HOTFIX_BASE RELEASE_HOTFIX_TAG
load_environment "$name"
health_url=$RELEASE_HEALTH_URL
if [ -n "${RELEASE_EXPECT_PUBLISH:-}" ]; then
    effectivePublish=false
    [ "$RELEASE_PUBLISH" != true ] || effectivePublish=true
    [ "$RELEASE_EXPECT_PUBLISH" = "$effectivePublish" ] || die "publication settings changed for $name; start a fresh pipeline to acquire the correct locks" 3
fi
if [ "${RELEASE_TRIGGER:-}" = merge ]; then
    [ "$RELEASE_ON_MERGE" = true ] || die "$name no longer deploys on merge" 3
fi

stage=baseline
marker=$(sh "$host" marker-read "$name")
if [ "${RELEASE_TRIGGER:-}" = merge ] && [ -n "$marker" ] && [ "$marker" != "$sha" ] && git merge-base --is-ancestor "$sha" "$marker"; then
    outcome=skipped
    mode=older-merge
    base=$marker
    stage=done
    say "$name: skipping $sha because a newer commit is already live at $marker"
    exit 0
fi
if [ "${RELEASE_TRIGGER:-}" = merge ]; then
    mainTip=$(git rev-parse "origin/$RELEASE_MAIN")
    if [ "$sha" != "$mainTip" ] && git merge-base --is-ancestor "$sha" "$mainTip"; then
        outcome=skipped
        mode=superseded-merge
        base=$mainTip
        stage=done
        say "$name: skipping $sha because a newer commit has reached main at $mainTip"
        exit 0
    fi
fi
if [ "$RELEASE_PUBLISH" = true ]; then
    version=$(sh "$here/version.sh" "$sha")
fi
classification=$(sh "$here/classify.sh" "$marker" "$sha")
read -r mode base candidate <<EOF
$classification
EOF
[ "$candidate" = "$sha" ] || die "the classified commit is not $sha"
RELEASE_VERSION=$version sh "$here/notes-ai.sh" "$marker" "$sha" >"$out/notes.md"
say "$name: $mode, label ${version:-sha-$(printf '%.12s' "$sha")}, commit $sha"

stage=gate
src=$out/src
git worktree remove --force "$src" 2>/dev/null || true
git worktree add --quiet --detach "$src" "$sha"
[ "$(git -C "$src" rev-parse HEAD)" = "$sha" ] || die "the worktree is not at $sha"
RELEASE_TOOLS=$here
export RELEASE_TOOLS
if [ "${RELEASE_TRIGGER:-}" = merge ] && [ "${RELEASE_PIPELINE_SHA:-}" = "$sha" ] && [ "${RELEASE_GATED_SHA:-}" = "$sha" ] && [ -n "${RELEASE_PIPELINE_ID:-}" ] && [ "${RELEASE_PIPELINE_ID:-}" = "${RELEASE_GATED_PIPELINE_ID:-}" ]; then
    say "the gate already passed for $sha in this pipeline"
else
    sh "$here/clean-gate.sh" -C "$src" -f "$here/../../release.mk" ci
fi

attempt=0
while :; do
stage=build
sh "$here/build.sh" "$name" "$sha" "$version" "$src"

stage=deploy
. "$out/images.env"
export RELEASE_IMAGE_SERVER RELEASE_IMAGE_WEB RELEASE_IMAGE_SERVER_VERSION RELEASE_IMAGE_WEB_VERSION
(
    umask 077
    deployCredentials=$(mktemp -d "$out/deploy-credentials.XXXXXX")
    trap 'rm -rf "$deployCredentials"' 0
    trap 'exit 130' INT
    trap 'exit 143' TERM
    jq -nr '
        (env.RELEASE_DEPLOY_VARS_JSON // "{}" | fromjson) *
        (env.RELEASE_DEPLOY_SECRETS_JSON // "{}" | fromjson) |
        to_entries[] | select(.key | test("^[A-Za-z_][A-Za-z0-9_]*$")) |
        "export " + .key + "=" + (.value | @sh)
    ' >"$deployCredentials/environment"
    . "$deployCredentials/environment"
    unset RELEASE_DEPLOY_SECRETS_JSON RELEASE_DEPLOY_VARS_JSON
    sh "$here/deploy.sh" "$name" "$sha" "$version"
)

stage=health
sh "$here/verify.sh" "$sha"

stage=record
sh "$host" marker-write "$name" "$sha" "$version"
outcome=succeeded
recordedVersion=$version
sh "$host" branch-move "env/$name" "$sha" || say "warning: env/$name was not moved to $sha; the live record still names this deployment"

stage=publish
if [ "$RELEASE_PUBLISH" = true ]; then
    publicationStatus=0
    sh "$here/publish.sh" "$name" "$sha" "$version" || publicationStatus=$?
    if [ "$publicationStatus" -eq 4 ] && [ "$attempt" -eq 0 ]; then
        attempt=1
        outcome=failed
        recordedVersion=
        say "the release tag was claimed by another commit; assigning again and repeating build, deployment and health once"
        version=$(sh "$here/version.sh" "$sha")
        RELEASE_VERSION=$version sh "$here/notes-ai.sh" "$marker" "$sha" >"$out/notes.md"
        continue
    fi
    if [ "$publicationStatus" -ne 0 ]; then
        outcome='succeeded, publication incomplete'
        publication_failure=version
        if [ "$publicationStatus" -eq 4 ]; then
            say "warning: release tags conflicted twice; publication stopped without moving either tag"
        else
            say "warning: publication did not complete; promote this SHA again to retry"
        fi
    fi
fi
if ! sh "$here/env-page.sh" "$name" "$sha" "$version" "$mode"; then
    outcome='succeeded, publication incomplete'
    if [ "$publication_failure" = version ]; then
        publication_failure=both
    else
        publication_failure=page
    fi
    say "warning: the environment changelog did not complete; the healthy deployment remains recorded"
fi
break
done
stage="done"
