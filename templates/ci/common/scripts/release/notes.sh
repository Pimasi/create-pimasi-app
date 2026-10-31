#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

classification=$(sh "$here/classify.sh" "${1:-}" "${2:-}")
read -r mode base candidate <<EOF
$classification
EOF

hotfix_details() {
    if details=$(sh "$here/hotfix.sh" "$1" "${2:-}" 2>/dev/null); then
        printf '%s\n' "$details"
    else
        status=$?
        [ "$status" -eq 3 ] || die "could not inspect hotfix $1" "$status"
    fi
}

candidateInspection=
[ "${RELEASE_CANDIDATE_KIND:-}" != hotfix ] || candidateInspection=--historical
candidateHotfix=$(hotfix_details "$candidate" "$candidateInspection")
[ -n "$candidateHotfix" ] || [ "${RELEASE_CANDIDATE_KIND:-}" != hotfix ] || die "could not inspect hotfix $candidate"
liveHotfix=$(hotfix_details "${1:-}" --historical)
if [ -n "$liveHotfix" ]; then
    hotfixLabel=$(printf '%s\n' "$liveHotfix" | jq -r '.version')
    if [ -z "$hotfixLabel" ]; then
        hotfixLabel="of $(printf '%s\n' "$liveHotfix" | jq -r '.base_tag') ($(short "$1"))"
    fi
fi

list() {
    git log --first-parent --reverse --format='%h%x1f%s%x1f%b%x1f%H%x1e' "$1" |
        awk -v RS='\036' -v FS='\037' -v omitted="${2:-}" -v included="${3:-}" -f "$here/notes.awk"
}

list_hotfix() {
    for picked in $(git rev-list --first-parent --reverse "$1"); do
        original=$(printf '%s\n' "$candidateHotfix" | jq -r --arg sha "$picked" '.commits[] | select(.sha == $sha) | .original')
        originalShort=
        releaseBase=$(printf '%s\n' "$candidateHotfix" | jq -r '.base_sha')
        if [ -n "$original" ] && [ "$original" != "$releaseBase" ] &&
            git merge-base --is-ancestor "$releaseBase" "$original" 2>/dev/null &&
            git merge-base --is-ancestor "$original" "origin/$RELEASE_MAIN" 2>/dev/null; then
            originalShort=$(git rev-parse --short "$original")
        fi
        git show -s --format="%h%x1f%s%x1f%b%x1f%H%x1f$originalShort%x1e" "$picked"
    done | awk -v RS='\036' -v FS='\037' -f "$here/notes.awk"
}

count() {
    git rev-list --count --first-parent "$1"
}

if [ -n "${1:-}" ] && ! git cat-file -e "$1^{commit}" 2>/dev/null; then
    printf 'Previous live commit %s is unavailable; the baseline is unknown.\n\n' "$1"
fi

if [ -n "$candidateHotfix" ] && [ "$mode" != same ] && [ "$mode" != rollback ]; then
    hotfixBase=$(printf '%s\n' "$candidateHotfix" | jq -r '.base_sha')
    hotfixTag=$(printf '%s\n' "$candidateHotfix" | jq -r '.base_tag')
    hotfixVersion=${RELEASE_VERSION:-$(printf '%s\n' "$candidateHotfix" | jq -r '.version')}
    [ -n "$hotfixVersion" ] || hotfixVersion="of $hotfixTag ($(short "$candidate"))"
    range=$hotfixBase..$candidate
    if [ "$mode" = range ]; then
        range=$base..$candidate
    fi
    printf '## Hotfix of %s (%s commits)\n' "$hotfixTag" "$(count "$range")"
    if [ "$mode" != range ]; then
        liveLabel=${1:-no finalised release}
        if [ -n "${1:-}" ]; then
            tags=$(sh "$host" tag-list) || die "could not read remote release tags"
            records=$(sh "$host" marker-list-all) || die "could not read finalised release versions"
            knownLabel=$(jq -nr --arg sha "$1" --argjson tags "$tags" --argjson records "$records" '
                ([$tags[] | select(.sha == $sha and (.tag | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.[1-9][0-9]*(\\.[1-9][0-9]*)?$"))) | .tag] | first) //
                ([$records[] | select(.sha == $sha and (.version | type == "string") and .version != "") | .version] | first) // ""
            ')
            liveLabel=${knownLabel:-$(printf '%.8s' "$1")}
        fi
        printf '\nThis promotion moves %s from %s to hotfix %s.\n' "${RELEASE_ENV:-the environment}" "$liveLabel" "$hotfixVersion"
    fi
    list_hotfix "$range"
    exit 0
fi

case "$mode" in
    range)
        printf '## Changes %s..%s (%s commits)\n' "$(short "$base")" "$(short "$candidate")" "$(count "$base..$candidate")"
        list "$base..$candidate"
        if [ -n "$liveHotfix" ]; then
            printf '\n### Hotfix %s was live\n\n' "$hotfixLabel"
            for commit in $(printf '%s\n' "$liveHotfix" | jq -r '.commits[].sha'); do
                original=$(printf '%s\n' "$liveHotfix" | jq -r --arg sha "$commit" '.commits[] | select(.sha == $sha) | .original')
                confirmation='confirm on main'
                releaseBase=$(printf '%s\n' "$liveHotfix" | jq -r '.base_sha')
                if git merge-base --is-ancestor "$commit" "$candidate" 2>/dev/null; then
                    confirmation='on main'
                elif [ -n "$original" ] && [ "$original" != "$releaseBase" ] &&
                    git merge-base --is-ancestor "$releaseBase" "$original" 2>/dev/null &&
                    git merge-base --is-ancestor "$original" "$candidate" 2>/dev/null; then
                    confirmation='on main'
                fi
                printf -- '- %s `%s` (%s)\n' "$(git show -s --format=%s "$commit")" "$(git rev-parse --short "$commit")" "$confirmation"
            done
        fi
        ;;
    same)
        printf '## Redeploy of %s\n\nSame commit as the current release. No code changes.\n' "$(short "$candidate")"
        ;;
    rollback)
        printf '## Rollback to %s from %s (%s commits removed)\n' "$(short "$candidate")" "$(short "$base")" "$(count "$candidate..$base")"
        if [ -n "$liveHotfix" ]; then
            printf '\nThis rollback also removes hotfix %s.\n' "$hotfixLabel"
        fi
        list "$candidate..$base"
        ;;
    no-baseline)
        printf '## Release of %s\n\nNo trusted previous release to compare against. The change list is omitted.\n' "$(short "$candidate")"
        ;;
esac
