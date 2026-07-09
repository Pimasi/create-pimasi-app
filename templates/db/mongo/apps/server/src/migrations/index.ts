import { $mongo } from "../services/db";
import { $logger } from "../utils/logger";
import { Migration } from "../app/migration";
import { CreateInitialIndexes } from "./20260709120000-create-initial-indexes";

/**
 * Ordered registry of all migrations. Append new entries to the end —
 * order is determined by this array, not filename. Names must be unique
 * (the YYYYMMDDHHMMSS prefix in the filename guarantees this in practice).
 */
const MIGRATIONS: Migration[] = [CreateInitialIndexes];

interface MigrationRecord {
    /** Migration name, or `$lock` for the runner advisory lock. */
    _id: string;
    ran_at: Date;
}

const $migrations = $mongo.collection<MigrationRecord>("migrations");

const LOCK_ID = "$lock";

/**
 * Lock TTL. If a runner crashes mid-migration, the lock is considered
 * stale after this and another runner will steal it. Set well above the
 * longest expected migration runtime.
 */
const STALE_LOCK_MS = 5 * 60 * 1000;

const POLL_INTERVAL_MS = 2_000;

/**
 * Run every pending migration in registry order. Safe to call from every
 * cluster worker on startup — a Mongo-backed lock ensures exactly one
 * runner executes at a time, and migrations already recorded are skipped.
 */
export async function runMigrations(): Promise<void> {
    let names = new Set(MIGRATIONS.map((m) => m.name));
    if (names.size !== MIGRATIONS.length) {
        throw new Error("Duplicate migration name in registry");
    }

    await acquireLock();

    try {
        let ran = await $migrations.find({ _id: { $ne: LOCK_ID } }).toArray();
        let ran_names = new Set(ran.map((r) => r._id));

        let pending = MIGRATIONS.filter((m) => !ran_names.has(m.name));
        if (pending.length === 0) {
            $logger.info("migrations: nothing to run");
            return;
        }

        $logger.info(
            { count: pending.length, names: pending.map((m) => m.name) },
            "migrations: running pending",
        );

        for (let migration of pending) {
            let t0 = Date.now();
            $logger.info({ name: migration.name }, "migration: start");
            await migration.handler();
            await $migrations.insertOne({
                _id: migration.name,
                ran_at: new Date(),
            });
            $logger.info(
                { name: migration.name, duration_ms: Date.now() - t0 },
                "migration: done",
            );
        }
    } finally {
        await $migrations.deleteOne({ _id: LOCK_ID });
    }
}

async function acquireLock(): Promise<void> {
    while (true) {
        try {
            await $migrations.insertOne({
                _id: LOCK_ID,
                ran_at: new Date(),
            });
            return;
        } catch (err: any) {
            if (err?.code !== 11000) throw err;

            let lock = await $migrations.findOne({ _id: LOCK_ID });
            if (lock && Date.now() - lock.ran_at.getTime() > STALE_LOCK_MS) {
                $logger.warn(
                    { lock },
                    "migrations: stale lock detected, removing",
                );
                await $migrations.deleteOne({
                    _id: LOCK_ID,
                    ran_at: lock.ran_at,
                });
                continue;
            }

            $logger.info("migrations: lock held by another instance, waiting");
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
    }
}
