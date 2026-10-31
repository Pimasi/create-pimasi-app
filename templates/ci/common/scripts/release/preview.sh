#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

sha=$(git rev-parse --verify --quiet "${1:-HEAD}^{commit}") || die "unknown commit: ${1:-HEAD}" 3
initialise_output
: >"$out/preview.md"

for file in "$here"/environments/*.env; do
    name=${file##*/}
    name=${name%.env}
    marker=$(sh "$host" marker-read "$name") || {
        say "warning: could not read the live record for $name"
        continue
    }
    classification=$(sh "$here/classify.sh" "$marker" "$sha")
    read -r mode base candidate <<EOF
$classification
EOF
    case "$mode" in
        range) pending=$(git rev-list --count --first-parent "$base..$sha") ;;
        same) pending=0 ;;
        rollback) pending=$(git rev-list --count --first-parent "$sha..$base") ;;
        *) pending=$(git rev-list --count --first-parent "$sha") ;;
    esac
    {
        printf '## Waiting for %s: %s pending changes. Promote with commit %s\n\n' "$name" "$pending" "$sha"
        sh "$here/notes.sh" "$marker" "$sha" | sed 's/^##/###/'
        printf '\n'
    } >>"$out/preview.md"
done

cat "$out/preview.md"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    cat "$out/preview.md" >>"$GITHUB_STEP_SUMMARY"
fi
