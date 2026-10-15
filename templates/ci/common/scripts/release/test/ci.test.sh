#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
REAL_MAKE=$(command -v make)
export REAL_MAKE

mkdir -p "$tmp/app"
printf 'JWT_SECRET=x\n' >"$tmp/app/.env.example"
: >"$tmp/app/docker-compose.yml"
: >"$tmp/app/Makefile"
cat >"$tmp/bin/docker" <<'DOCKER'
#!/bin/sh
printf 'docker %s\n' "$*" >>"$STATE/calls"
case "$*" in
    *'config --services') printf 'pimasi-server\npimasi-web\npimasi-postgres\n' ;;
    run*) [ "${FAIL_CI:-}" != checks ] ;;
    *'up -d --build --wait'*) [ "${FAIL_CI:-}" != up ] ;;
esac
DOCKER
cat >"$tmp/bin/make" <<'MAKE'
#!/bin/sh
printf 'make %s\n' "$*" >>"$STATE/calls"
[ "${FAIL_CI:-}" != tests ]
MAKE
chmod +x "$tmp/bin/docker" "$tmp/bin/make"
cd "$tmp/app"

for failure in none title checks up tests; do
    : >"$STATE/calls"
    PR_TITLE=
    [ "$failure" != title ] || PR_TITLE='an invalid title'
    status=0
    FAIL_CI=$failure PR_TITLE=$PR_TITLE sh "$release/ci.sh" >"$tmp/ci.log" 2>&1 || status=$?
    if [ "$failure" = none ]; then
        check "the complete gate succeeds" "0" "$status"
        contains "install, types and format run in node" "npm ci && npm run type-check && npx prettier --check ." "$(calls)"
        contains "the base test target is invoked" " test" "$(calls)"
    else
        check "$failure failure is preserved" "1" "$status"
    fi
    contains "$failure path tears the stack down with volumes" "down -v" "$(calls)"
    if [ "$failure" = title ]; then
        lacks "bad titles do not install dependencies" "docker run" "$(calls)"
    fi
done


printf 'test:\n\t@true\n-include %s/../../release.mk\n' "$release" >Makefile
cat >"$tmp/bin/make" <<'MAKE'
#!/bin/sh
exec "$REAL_MAKE" -n "$@"
MAKE
status=0
PR_TITLE='fix: use one release include' sh "$release/ci.sh" >"$tmp/ci.log" 2>&1 || status=$?
check "the gate works with the generated Makefile include" 0 "$status"
lacks "the gate loads release targets once" 'overriding recipe' "$(cat "$tmp/ci.log")"
done_testing
