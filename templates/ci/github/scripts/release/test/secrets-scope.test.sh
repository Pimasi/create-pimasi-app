#!/bin/sh
. "$(dirname -- "$0")/harness.sh"

workflow=$release_source/../../.github/workflows/promote.yml
result=$(awk '
    /^            - / { releaseStep = ($0 ~ /id: promote$/ || $0 ~ /run: make release$/); inEnv = 0 }
    /^              env:/ { inEnv = 1 }
    /toJSON\((secrets|vars)\)/ {
        total++
        if (!releaseStep || !inEnv || $0 !~ /^                  RELEASE_DEPLOY_(SECRETS|VARS)_JSON:/) misplaced++
    }
    END { printf "%d %d", total, misplaced }
' "$workflow")
check "both contexts reach only the two release steps" '4 0' "$result"
done_testing
