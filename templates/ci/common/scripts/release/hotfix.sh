#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"
RELEASE_MAIN=${RELEASE_MAIN:-main}

sha=$(git rev-parse --verify --quiet "${1:-missing}^{commit}") || die "unknown commit: ${1:-}" 3
git rev-parse --verify --quiet "origin/$RELEASE_MAIN^{commit}" >/dev/null || die "cannot inspect $RELEASE_MAIN history" 3
if git rev-list --first-parent "origin/$RELEASE_MAIN" | grep -qx "$sha"; then
    die "commit $sha is already on $RELEASE_MAIN; promote its main first-parent commit" 3
fi
tags=$(sh "$host" tag-list) || die "could not read remote release tags"
tags=$(printf '%s\n' "$tags" | jq '
    [.[] | . + {release: (.tag |
        capture("^(?<date>[0-9]{4}-[0-9]{2}-[0-9]{2})\\.(?<n>[1-9][0-9]*)(?:\\.(?<p>[1-9][0-9]*))?$") |
        . + {parts: (.date | split("-") | map(tonumber))} |
        select(.parts[1] >= 1 and .parts[1] <= 12 and .parts[2] >= 1) |
        .parts as $d |
        ([31, (if ($d[0] % 400 == 0 or ($d[0] % 4 == 0 and $d[0] % 100 != 0)) then 29 else 28 end), 31,30,31,30,31,31,30,31,30,31][$d[1] - 1]) as $days |
        select($d[2] <= $days))}]
')
base=
base_tag=
if [ "${2:-}" != --admit ] && [ "${RELEASE_HOTFIX_SHA:-}" = "$sha" ] && [ -n "${RELEASE_HOTFIX_BASE:-}" ] && [ -n "${RELEASE_HOTFIX_TAG:-}" ]; then
    base=$RELEASE_HOTFIX_BASE
    base_tag=$RELEASE_HOTFIX_TAG
fi
carried=$(printf '%s\n' "$tags" | jq -r --arg sha "$sha" '
    [.[] | select(.sha == $sha and .release.p != null)] |
    sort_by(.release.parts + [(.release.n | tonumber), (.release.p | tonumber)]) |
    first | if . == null then "" else .release.date + "." + .release.n end
')
if [ -z "$base" ] && [ -n "$carried" ]; then
    carriedBase=$(printf '%s\n' "$tags" | jq -r --arg tag "$carried" '[.[] | select(.tag == $tag and .release.p == null) | .sha] | first // ""')
    if [ -n "$carriedBase" ] && [ "$carriedBase" != "$sha" ] &&
        git merge-base --is-ancestor "$carriedBase" "origin/$RELEASE_MAIN" &&
        git merge-base --is-ancestor "$carriedBase" "$sha"; then
        base=$carriedBase
        base_tag=$carried
    fi
fi
if [ -z "$base" ]; then
    heads=$(git ls-remote --heads origin) || die "could not read remote release branches"
    lines=$({
        printf '%s\n' "$tags"
        printf '%s\n' "$heads" | awk -v prefix="refs/heads/$RELEASE_BRANCH_PREFIX" 'index($2, prefix) == 1 { print $1, substr($2, length(prefix) + 1) }' |
            jq -R 'split(" ") | {tip: .[0], tag: .[1]}'
    } | jq -rs '
        .[0] as $tags | .[1:][] | . as $branch |
        $tags[] | select(.tag == $branch.tag and .release.p == null) | .sha + " " + .tag + " " + $branch.tip
    ')
    nearest=$({
        printf '%s\n' "$lines"
        printf '%s\n' --
        git rev-list --first-parent "$sha"
    } | awk '
        !listed && $0 == "--" { listed = 1; next }
        !listed { if ($1 != "") candidates[$1] = 1; next }
        ++depth > 1 && ($0 in candidates) { print }
    ')
    for commit in $nearest; do
        git merge-base --is-ancestor "$commit" "origin/$RELEASE_MAIN" || continue
        for entry in $(printf '%s\n' "$lines" | awk -v commit="$commit" '$1 == commit { print $2 "," $3 }'); do
            tip=${entry#*,}
            git cat-file -e "$tip^{commit}" 2>/dev/null || git fetch --quiet origin "$tip" || die "could not fetch remote release branch $RELEASE_BRANCH_PREFIX${entry%%,*}"
            if git rev-list --first-parent "$tip" | grep -qx "$sha"; then
                base=$commit
                base_tag=${entry%%,*}
                break 2
            fi
        done
    done
fi
if [ -z "$base" ]; then
    if git merge-base --is-ancestor "$sha" "origin/$RELEASE_MAIN"; then
        die "commit $sha is already part of $RELEASE_MAIN through a merge; promote the main commit that contains it" 3
    fi
    die "commit $sha is not on the first-parent line of a ${RELEASE_BRANCH_PREFIX}<version> branch above that version's released tag on $RELEASE_MAIN, and carries no hotfix tag" 3
fi
if [ "${2:-}" = --admit ]; then
    printf '%s %s\n' "$base" "$base_tag"
    exit 0
fi
commits='[]'
for commit in $(git rev-list --first-parent --reverse "$base..$sha"); do
    original=$(git log -1 --format=%B "$commit" | sed -n 's/^(cherry picked from commit \([0-9a-fA-F]\{40\}\))$/\1/p' | head -n 1 | tr '[:upper:]' '[:lower:]')
    commits=$(jq -cn --argjson commits "$commits" --arg sha "$commit" --arg original "$original" '$commits + [{sha: $sha, original: $original}]')
done
records=$(sh "$host" marker-list-all) || die "could not read finalised release versions"
jq -cn --arg sha "$sha" --arg base "$base" --arg tag "$base_tag" --argjson commits "$commits" --argjson tags "$tags" --argjson records "$records" '
    [$tags[] | {sha, version: .tag}] as $tags |
    [$tags[], ($records[] | select(.version | type == "string") | . as $record |
        select(all($tags[]; .version != $record.version or .sha == $record.sha)))] |
    map(select(.version | startswith($tag + ".")) |
        . + {patch: (.version | ltrimstr($tag + ".") | select(test("^[1-9][0-9]*$")) | tonumber)}) |
    sort_by(.patch) as $versions |
    {base_tag: $tag, base_sha: $base, commits: $commits,
        version: ([$versions[] | select(.sha == $sha)] | first | .version // "")}
'
