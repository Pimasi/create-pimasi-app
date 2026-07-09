ARGS ?=

.PHONY: setup dev dev-clean test type-check format update-deps

setup:
	test -f .env || cp .env.example .env
	npm install

dev:
	docker compose up --build --watch

dev-clean:
	docker compose down -v
	$(MAKE) dev

test:
	docker exec pimasi-server sh -c "npm run test -- $(ARGS)"

type-check:
	npm run type-check

format:
	npx prettier --write .

update-deps:
	npx npm-check-updates -u --workspaces --root
	npm install

-include *.mk
