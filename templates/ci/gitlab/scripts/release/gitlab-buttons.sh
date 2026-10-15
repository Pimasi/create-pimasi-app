#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

names=$(for file in "$here"/environments/*.env; do
    [ -f "$file" ] || continue
    name=${file##*/}
    name=${name%.env}
    case "$name" in
        '' | -* | *[!a-z0-9-]*) die "invalid environment name: $name" ;;
    esac
    [ "${#name}" -le 32 ] || die "invalid environment name: $name"
    load_environment "$name"
    [ "$RELEASE_ON_MERGE" = true ] || printf '%s\n' "$name"
done)
printf '%s\n' "$names" | jq -R . | jq -s --indent 4 --arg main "$RELEASE_MAIN" '
    map(select(length > 0)) as $names |
    {default: {image: "docker:29-cli", before_script: ["apk add --no-cache curl jq git"]}} +
    if ($names | length) == 0 then
        {"no-manual-environments": {script: ["printf \"%s\\n\" \"Every environment deploys on merge; use the release pipeline form to promote.\""]}}
    else
        $names | map({key: ("deploy-" + .), value: {when: "manual", script: [
            "git fetch --quiet origin \"+refs/heads/" + $main + ":refs/remotes/origin/" + $main + "\"",
            "tooling=$(mktemp -d)",
            "git archive origin/" + $main + " scripts/release | tar -x -C \"$tooling\"",
            "sh \"$tooling/scripts/release/dispatch-button.sh\" " + .
        ]}}) | from_entries
    end
'
