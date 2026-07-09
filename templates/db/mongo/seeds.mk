.PHONY: mongo-seeds-save mongo-seeds-restore

mongo-seeds-save:
	docker exec pimasi-mongo /scripts/seed-dump.sh

mongo-seeds-restore:
	docker exec pimasi-mongo /scripts/seed-restore.sh
