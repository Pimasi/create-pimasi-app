import { Kysely, PostgresDialect, type Selectable } from "kysely";
import { Pool } from "pg";
import { ulid } from "ulid";
import { getenv } from "@pimasi/utils/lib/helpers";
import { UserRoles } from "@pimasi/lib/values/auth";
import type { Database } from "../services/db";
import type { UserModel } from "../models/users";

let _db: Kysely<Database> | null = null;
let seededUserIds: string[] = [];

function getDb(): Kysely<Database> {
    if (!_db) {
        _db = new Kysely<Database>({
            dialect: new PostgresDialect({
                pool: new Pool({ connectionString: getenv("DATABASE_URL") }),
            }),
        });
    }
    return _db;
}

function parseRoles(value: unknown): UserRoles[] {
    if (typeof value === "string") return JSON.parse(value);
    return (value as UserRoles[]) ?? [];
}

function mapUserRow(row: Selectable<Database["users"]>): UserModel {
    return {
        id: row.id,
        created_at: row.created_at,
        name: row.name,
        email: row.email,
        email_verified: row.email_verified,
        password_hash: row.password_hash ?? undefined,
        firebase_id: row.firebase_id ?? undefined,
        disabled_at: row.disabled_at ?? null,
        roles: parseRoles(row.roles),
    };
}

function userValues(user: UserModel) {
    return {
        id: user.id,
        created_at: user.created_at,
        name: user.name,
        email: user.email,
        email_verified: user.email_verified,
        password_hash: user.password_hash ?? null,
        firebase_id: user.firebase_id ?? null,
        disabled_at: user.disabled_at ?? null,
        roles: JSON.stringify(user.roles),
    };
}

export async function seedUser(
    overrides: Partial<UserModel> = {},
): Promise<UserModel> {
    let id = overrides.id ?? ulid();
    let suffix = id.slice(-6).toLowerCase();

    let user: UserModel = {
        id,
        created_at: overrides.created_at ?? new Date(),
        name: overrides.name ?? `test-user-${suffix}`,
        email: overrides.email ?? `test-${suffix}@example.test`,
        email_verified: overrides.email_verified ?? true,
        password_hash: overrides.password_hash,
        firebase_id: overrides.firebase_id,
        disabled_at: overrides.disabled_at ?? null,
        roles: overrides.roles ?? [UserRoles.USER],
    };

    await getDb().insertInto("users").values(userValues(user)).execute();
    seededUserIds.push(user.id);

    return user;
}

async function users() {
    let conn = getDb();
    return {
        async findOne(filter: {
            id?: string;
            email?: string;
        }): Promise<UserModel | null> {
            let query = conn.selectFrom("users").selectAll();
            if (filter.id !== undefined) {
                query = query.where("id", "=", filter.id);
            }
            if (filter.email !== undefined) {
                query = query.where("email", "=", filter.email);
            }
            let row = await query.executeTakeFirst();
            return row ? mapUserRow(row) : null;
        },
        async insertOne(user: UserModel): Promise<void> {
            await conn.insertInto("users").values(userValues(user)).execute();
        },
        async insertMany(list: UserModel[]): Promise<void> {
            if (list.length === 0) return;
            await conn
                .insertInto("users")
                .values(list.map(userValues))
                .execute();
        },
        async deleteMany(filter: { id: { $in: string[] } }): Promise<void> {
            let ids = filter.id.$in;
            if (ids.length === 0) return;
            await conn.deleteFrom("users").where("id", "in", ids).execute();
        },
    };
}

export const db = {
    users,
};

export async function teardownSeed(): Promise<void> {
    if (seededUserIds.length > 0) {
        let conn = getDb();
        await conn
            .deleteFrom("users")
            .where("id", "in", seededUserIds)
            .execute();
    }

    seededUserIds = [];
}

export async function cleanup(): Promise<void> {
    await teardownSeed();
    if (_db) {
        await _db.destroy();
        _db = null;
    }
}
