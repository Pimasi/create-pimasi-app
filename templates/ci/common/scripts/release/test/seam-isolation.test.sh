#!/bin/sh
. "$(dirname -- "$0")/harness.sh"
SEAM_SENTINEL=$tmp/project-seam-called
export SEAM_SENTINEL
cat >"$release/deploy.sh" <<'DEPLOY'
#!/bin/sh
printf '%s\n' "$*" >>"$SEAM_SENTINEL"
exit 99
DEPLOY

for file in adapter-contract publication-history; do
    status=0
    RELEASE_UNDER_TEST=$release sh "$release/test/$file.test.sh" >"$tmp/$file.log" 2>&1 || status=$?
    check "$file tests pass with a customised project deployment seam" 0 "$status"
    check "$file tests never execute the project deployment seam" absent "$(if [ -f "$SEAM_SENTINEL" ]; then printf called; else printf absent; fi)"
    rm -f "$SEAM_SENTINEL"
done
done_testing
