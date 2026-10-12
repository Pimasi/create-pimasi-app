import { Kysely } from "kysely";
import { Migrator } from "kysely/migration";
import { $db } from "../services/db";
import { $logger } from "../utils/logger";

async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable("users")
        .addColumn("id", "text", (col) => col.primaryKey())
        .addColumn("created_at", "timestamptz", (col) => col.notNull())
        .addColumn("name", "text", (col) => col.notNull())
        .addColumn("email", "text", (col) => col.notNull().unique())
        .addColumn("email_verified", "boolean", (col) => col.notNull())
        .addColumn("password_hash", "text")
        .addColumn("firebase_id", "text")
        .addColumn("disabled_at", "timestamptz")
        .addColumn("roles", "jsonb", (col) => col.notNull())
        .execute();
}

async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable("users").ifExists().execute();
}

export async function runMigrations(): Promise<void> {
    let migrator = new Migrator({
        db: $db,
        provider: {
            getMigrations: async () => ({
                "20260709120000-init": { up, down },
            }),
        },
    });

    let { error, results } = await migrator.migrateToLatest();

    for (let result of results ?? []) {
        if (result.status === "Success") {
            $logger.info({ name: result.migrationName }, "migration: applied");
        } else if (result.status === "Error") {
            $logger.error({ name: result.migrationName }, "migration: failed");
        }
    }

    if (error) {
        throw error;
    }
}
