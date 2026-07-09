import { Kysely, sql } from "kysely";
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

    await db.schema
        .createTable("widgets")
        .addColumn("id", "text", (col) => col.primaryKey())
        .addColumn("user_id", "text", (col) => col.notNull())
        .addColumn("name", "text", (col) => col.notNull())
        .addColumn("description", "text")
        .addColumn("quantity", "integer", (col) => col.notNull())
        .addColumn("created_at", "timestamptz", (col) => col.notNull())
        .addColumn("updated_at", "timestamptz", (col) => col.notNull())
        .execute();

    await sql`
        create index widgets_user_id_created_at_idx
        on widgets (user_id, created_at desc)
    `.execute(db);
}

async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable("widgets").ifExists().execute();
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
