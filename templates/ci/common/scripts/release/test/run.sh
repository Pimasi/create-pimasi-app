#!/bin/sh
set -u
dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
failed=0
total=0
for file in "$dir"/*.test.sh; do
    total=$((total + 1))
    if sh "$file"; then
        printf 'ok      %s\n' "${file##*/}"
    else
        failed=$((failed + 1))
        printf 'FAILED  %s\n' "${file##*/}"
    fi
done
printf '%s test files, %s failed\n' "$total" "$failed"
[ "$failed" -eq 0 ]
