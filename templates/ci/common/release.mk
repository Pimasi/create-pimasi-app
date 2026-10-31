RELEASE_TOOLS ?= scripts/release

.PHONY: ci ci-checks ci-title up down release-test release-preview release-preview-if-main release release-from-main release-notify-test

test: release-test

ci:
	sh "$(RELEASE_TOOLS)/ci.sh"

ci-title:
	sh "$(RELEASE_TOOLS)/check-title.sh"

ci-checks:
	sh "$(RELEASE_TOOLS)/ci-checks.sh"

up:
	sh "$(RELEASE_TOOLS)/compose.sh" . ci up -d --build --wait pimasi-server

down:
	sh "$(RELEASE_TOOLS)/compose.sh" . ci down -v

release-test:
	sh "$(RELEASE_TOOLS)/test-container.sh"

release-preview:
	sh "$(RELEASE_TOOLS)/preview.sh"

release-preview-if-main:
	sh "$(RELEASE_TOOLS)/preview-main.sh"

release:
	sh "$(RELEASE_TOOLS)/promote.sh"

release-from-main:
	sh "$(RELEASE_TOOLS)/release-from-main.sh"

release-notify-test:
	sh "$(RELEASE_TOOLS)/notify.sh" --test
