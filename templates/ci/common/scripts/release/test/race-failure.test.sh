#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
sandbox
fake_host
fake_tools
one=$(commit 'feat: other release')
two=$(commit 'fix: racing release')
publish_main
mv "$tmp/bin/docker" "$tmp/bin/docker-recording"
cat >"$tmp/bin/docker" <<'DOCKER'
#!/bin/sh
set -eu
if [ "$1" = build ] && [ -f "$STATE/raced" ]; then
    exit 23
fi
exec "$(dirname -- "$0")/docker-recording" "$@"
DOCKER
chmod +x "$tmp/bin/docker"
check 'a failed build after a tag collision returns its failure' 23 "$(RACE_SHA=$one promote production "$two")"
check 'a failed second attempt reports failure' failed "$(outcome outcome)"
check 'a failed second attempt identifies build' build "$(outcome stage)"
check 'a failed second attempt reports its newly assigned version' 2026-10-12.2 "$(outcome version)"
check 'the stolen version remains on its owner' "$one" "$(git ls-remote --tags origin refs/tags/2026-10-12.1 | cut -f1)"
check 'the failed retry does not finalise a new record' 1 "$(jq length "$STATE/records-production.json")"
lacks 'a failed retry does not claim the earlier healthy record stayed unchanged' 'The live record is unchanged' "$(cat "$RELEASE_OUT/summary.md")"
done_testing
