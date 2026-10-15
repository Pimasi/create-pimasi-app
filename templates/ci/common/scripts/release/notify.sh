#!/bin/sh
set -eu
. "$(dirname -- "$0")/lib.sh"

post() (
    umask 077
    [ -n "${RELEASE_WEBHOOK_URL:-}" ] || return 2
    jq -Rs '{text: .}' <"$1" >"$notifyDir/body.json"
    printf '%s' "$RELEASE_WEBHOOK_URL" | jq -Rs '"url = " + tojson' -r >"$notifyDir/curl.conf"
    curl -fsS --connect-timeout 5 --max-time 15 \
            -H "content-type: application/json" --data-binary "@$notifyDir/body.json" \
            --config "$notifyDir/curl.conf" >/dev/null
)

initialise_output
notifyDir=$(mktemp -d "$out/notify.XXXXXX")
trap 'rm -rf "$notifyDir"' 0
trap 'exit 130' INT
trap 'exit 143' TERM
if [ "${1:-}" = --test ]; then
    printf 'TEST ONLY: release notifications reach this channel.\n' >"$out/notify-test.md"
    post "$out/notify-test.md" || die "the webhook test failed; check RELEASE_WEBHOOK_URL and the receiver"
    say "the webhook test succeeded"
    exit 0
fi

if [ ! -f "$out/outcome.env" ]; then
    say "no outcome record: nothing to report"
    exit 0
fi
. "$out/outcome.env"

label=${version:-sha-$(printf '%.12s' "$sha")}

case "$outcome" in
    succeeded | "succeeded, publication incomplete")
        if [ -n "${health_url:-}" ]; then
            title="Released $label to $environment"
        else
            title="Published $label: images pushed and smoke-tested; no deploy target is configured"
        fi
        meaning="The health check passed and the live record now points at this commit."
        if [ "$outcome" = "succeeded, publication incomplete" ]; then
            title="$title; publication incomplete"
            meaning="$meaning Promote this SHA again to retry publication."
        fi
        ;;
    rejected)
        title="Promotion to $environment rejected"
        meaning="Nothing was built or deployed. The live record is unchanged."
        ;;
    skipped)
        title="Merge promotion to $environment skipped"
        meaning="A newer commit is already live. Nothing was built or deployed and the live record is unchanged."
        if [ "$mode" = superseded-merge ]; then
            meaning="A newer commit has reached main. Nothing was built or deployed and the last healthy live record is unchanged."
        fi
        ;;
    *)
        title="Promotion to $environment failed at $stage"
        meaning="The live record is unchanged. Fix the cause and promote again."
        if [ "${attempt:-0}" -gt 0 ]; then
            meaning="The earlier attempt finalised a live record before its tag collided. Inspect the record and target before retrying."
        fi
        ;;
esac

{
    printf '## %s\n\n%s\n\n' "$title" "$meaning"
    printf -- '- Outcome: %s\n- Environment: %s\n- SHA: `%s`\n- Version: %s\n- Mode: %s\n\n' \
        "$outcome" "$environment" "$sha" "${version:-none}" "${mode:-none}"
    if [ -f "$out/notes.md" ]; then
        cat "$out/notes.md"
    fi
} >"$out/summary.md"

cat "$out/summary.md"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    cat "$out/summary.md" >>"$GITHUB_STEP_SUMMARY" || say "warning: the job summary could not be written"
fi
if [ -n "${RELEASE_WEBHOOK_URL:-}" ]; then
    post "$out/summary.md" || say "warning: the webhook post failed"
else
    say "no webhook is configured: notification skipped"
fi
