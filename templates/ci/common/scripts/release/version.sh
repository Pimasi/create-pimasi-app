#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

sha=$(git rev-parse --verify --quiet "${1:-missing}^{commit}") || die "unknown commit: ${1:-}" 3
[ "$(git rev-parse --is-shallow-repository)" = false ] || die "shallow clone: fetch the full history first" 3
timezone=${RELEASE_TIMEZONE-UTC}
case "$timezone" in
    '' | /* | *..* | *[!A-Za-z0-9_+/-]*) die "RELEASE_TIMEZONE cannot be resolved: $timezone" ;;
esac
zone=/usr/share/zoneinfo/$timezone
[ -f "$zone" ] && [ "$(head -c 4 "$zone")" = TZif ] || die "RELEASE_TIMEZONE cannot be resolved: $timezone; install tzdata"
if [ "${RELEASE_NOW+x}" = x ]; then
    case "$RELEASE_NOW" in
        '' | *[!0-9]*) die "RELEASE_NOW must be an epoch in seconds" ;;
    esac
    today=$(TZ="$timezone" date -d "@$RELEASE_NOW" +%Y-%m-%d) || die "RELEASE_NOW cannot be resolved"
else
    today=$(TZ="$timezone" date +%Y-%m-%d) || die "RELEASE_TIMEZONE cannot be resolved: $timezone"
fi
tags=$(sh "$host" tag-list) || die "could not read remote release tags"
records=$(sh "$host" marker-list-all) || die "could not read finalised release versions"
hotfix_base=
if [ "${RELEASE_CANDIDATE_KIND:-}" != normal ]; then
    hotfixMode=
    [ "${RELEASE_CANDIDATE_KIND:-}" != hotfix ] || hotfixMode=--historical
    if hotfix=$(sh "$here/hotfix.sh" "$sha" "$hotfixMode" 2>/dev/null); then
        hotfix_base=$(printf '%s\n' "$hotfix" | jq -r '.base_tag')
    else
        status=$?
        [ "$status" -eq 3 ] && [ "${RELEASE_CANDIDATE_KIND:-}" != hotfix ] || die "could not inspect hotfix $sha"
    fi
fi
jq -nr --arg sha "$sha" --arg today "$today" --arg hotfix_base "$hotfix_base" --argjson tags "$tags" --argjson records "$records" '
    def parsed:
        capture("^(?<date>[0-9]{4}-[0-9]{2}-[0-9]{2})\\.(?<n>[1-9][0-9]*)(?:\\.(?<p>[1-9][0-9]*))?$") |
        . + {n: (.n | tonumber), p: (if .p == null then 0 else .p | tonumber end)} |
        . + {parts: (.date | split("-") | map(tonumber))} |
        select(.parts[1] >= 1 and .parts[1] <= 12 and .parts[2] >= 1) |
        .parts as $d |
        ([31, (if ($d[0] % 400 == 0 or ($d[0] % 4 == 0 and $d[0] % 100 != 0)) then 29 else 28 end), 31,30,31,30,31,31,30,31,30,31][$d[1] - 1]) as $days |
        select($d[2] <= $days) |
        . + {order: (.parts + [.n, .p])};
    [$tags[] | . + {release: (.tag | parsed)}] as $tags |
    [$records[] | select(.version | type == "string") | . + {release: (.version | parsed)}] as $records |
    ([$tags[] | select(.sha == $sha)] | sort_by(.release.order) | first | .tag) as $tag |
    ([$records[] | select(.sha == $sha) | . as $record |
        select(all($tags[]; .tag != $record.version or .sha == $sha))] |
        sort_by(.release.order) | first | .version) as $record |
    $tag // $record // (if $hotfix_base != "" then
        [$tags[], $records[] | select(.release.p > 0 and (.release.date + "." + (.release.n | tostring)) == $hotfix_base) | .release.p] |
        (max // 0) + 1 | $hotfix_base + "." + tostring
    else
        [$tags[], $records[] | select(.release.date == $today and .release.p == 0) | .release.n] |
        (max // 0) + 1 | $today + "." + tostring
    end)
'
