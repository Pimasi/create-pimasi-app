#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

name=$1
sha=$2
tag=$3
initialise_output

release_branch() {
    case "$tag" in
        *.*.*) return 0 ;;
    esac
    branch=$RELEASE_BRANCH_PREFIX$tag
    tagged=$(sh "$host" tag-read "$tag") || die "could not confirm tag $tag before creating $branch"
    [ "$tagged" = "$sha" ] || die "tag $tag does not name $sha; $branch was not created"
    branchStatus=0
    sh "$host" branch-create "$branch" "$sha" || branchStatus=$?
    case "$branchStatus" in
        0) ;;
        4)
            tip=$(sh "$host" branch-read "$branch") || tip=
            [ -z "$tip" ] || git cat-file -e "$tip^{commit}" 2>/dev/null || git fetch --quiet origin "$tip" 2>/dev/null || true
            if [ -z "$tip" ] || ! git rev-list --first-parent "$tip" 2>/dev/null | grep -qx "$sha"; then
                say "warning: $branch does not hold $tag on its first-parent line and is left unchanged"
            fi
            ;;
        *) die "the host refused branch $branch" ;;
    esac
}

found=$(sh "$host" tag-read "$tag") || die "could not read tag $tag"
[ -z "$found" ] || [ "$found" = "$sha" ] || die "$tag points at $found, not $sha: left untouched" 4

if sh "$host" release-exists "$tag"; then
    say "$tag already has a release object"
    release_branch
    exit 0
else
    status=$?
    [ "$status" -eq 1 ] || die "could not check the release object for $tag"
fi

history=$(sh "$host" marker-list-all) || die "could not read finalised release versions"
first_environment=$(printf '%s\n' "$history" | jq -r --arg sha "$sha" --arg version "$tag" '
    [.[] | select(.sha == $sha and .version == $version and (.environment | type == "string"))] | last | .environment // ""
')
[ -z "$first_environment" ] || name=$first_environment
records=$(sh "$host" marker-list "$name") || die "could not read release history for $name"
base=$(printf '%s\n' "$records" | jq -er --arg sha "$sha" '
    [to_entries[] | select(.value.sha == $sha) | .key] | last
') || die "no finalised record exists for $sha in $name"
base=$(printf '%s\n' "$records" | jq -r --argjson index "$base" '.[$index + 1].sha // ""')
RELEASE_ENV=$name RELEASE_VERSION=$tag sh "$here/notes.sh" "$base" "$sha" >"$out/publication.md"

status=0
sh "$host" release-publish "$tag" "$sha" "$out/publication.md" || status=$?
[ "$status" -ne 4 ] || die "the tag $tag was claimed by another commit: left untouched" 4
[ "$status" -eq 0 ] || die "the host refused release $tag"
say "published $tag at $sha"
release_branch
