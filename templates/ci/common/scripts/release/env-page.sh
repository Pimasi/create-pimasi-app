#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

name=$1
sha=$2
version=$3
mode=$4
case "$mode" in
    same) exit 0 ;;
    range | rollback | no-baseline | hotfix) ;;
    *) die "unknown environment changelog mode: $mode" ;;
esac
initialise_output
umask 077
pageDir=$(mktemp -d "$out/env-page.XXXXXX")
trap 'rm -rf "$pageDir"' 0
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "${RELEASE_NOW+x}" = x ]; then
    case "$RELEASE_NOW" in
        '' | *[!0-9]*) die "RELEASE_NOW must be an epoch in seconds" ;;
    esac
    timestamp=$(date -u -d "@$RELEASE_NOW" '+%d-%m-%Y %H:%M UTC')
else
    timestamp=$(date -u '+%d-%m-%Y %H:%M UTC')
fi
label=${version:-sha-$(printf '%.12s' "$sha")}
limit=125000
[ "${GITLAB_CI:-}" != true ] || limit=1000000
jq -nj --arg heading "## $label · $timestamp" --argjson limit "$limit" \
    --rawfile notes "$out/notes-plain.md" '
    ($heading + "\n\n") as $prefix |
    if (($prefix + $notes + "\n") | length) <= $limit then
        $prefix + $notes + "\n"
    else
        ($notes | split("\n")) as $lines |
        ($lines | map(select(startswith("- "))) | length) as $total |
        ("\n(\($total) more commits not shown)\n" | length) as $reserve |
        reduce $lines[] as $line (
            {body: $prefix, size: ($prefix | length), stopped: false, omitted: 0};
            if .stopped or (.size + ($line | length) + 1 + $reserve > $limit) then
                .stopped = true | .omitted += (if $line | startswith("- ") then 1 else 0 end)
            else
                .body += ($line + "\n") | .size += (($line | length) + 1)
            end
        ) | .body + "\n(\(.omitted) more commits not shown)\n"
    end
' >"$out/env-page.md"
sh "$host" env-page-read "$name" >"$pageDir/previous.md" || die "could not read the environment changelog for $name"
jq -nj --argjson limit "$limit" \
    --rawfile entry "$out/env-page.md" --rawfile previous "$pageDir/previous.md" '
    [$previous | splits("(?<=\\n)(?=## (?:[0-9]{4}-[0-9]{2}-[0-9]{2}\\.[1-9][0-9]*(?:\\.[1-9][0-9]*)?|sha-[0-9a-fA-F]{12}) · [0-9]{2}-[0-9]{2}-[0-9]{4} [0-9]{2}:[0-9]{2} UTC\\r?\\n)") | select(length > 0)] as $entries |
    ([$entry] + $entries)[:100] |
    until((join("") | length) <= $limit; .[:-1]) | join("")
' >"$pageDir/body.md"
mv "$pageDir/body.md" "$out/env-page.md"
sh "$host" env-page-write "$name" "$out/env-page.md" "$sha" || die "could not write the environment changelog for $name"
