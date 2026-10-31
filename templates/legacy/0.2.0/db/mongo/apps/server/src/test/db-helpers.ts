import { MongoClient, type Db, type Collection } from "mongodb";
import { ulid } from "ulid";
import type { UserModel } from "../models/users";
import type { WidgetModel } from "../models/widgets";
import { UserRoles } from "@pimasi/lib/values/auth";
import { getenv } from "@pimasi/utils/lib/helpers";

let _db: Db | null = null;
let _mongoClient: MongoClient | null = null;

async function getDb(): Promise<Db> {
    if (!_db) {
        let url = getenv("MONGO_URL");
        let dbName = getenv("MONGO_DATABASE");
        _mongoClient = new MongoClient(url);
        await _mongoClient.connect();
        _db = _mongoClient.db(dbName);
    }
    return _db;
}

async function users(): Promise<Collection<UserModel>> {
    let db = await getDb();
    return db.collection<UserModel>("users");
}

async function widgets(): Promise<Collection<WidgetModel>> {
    let db = await getDb();
    return db.collection<WidgetModel>("widgets");
}

let seededUserIds: string[] = [];

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

    await (await users()).insertOne(user);
    seededUserIds.push(user.id);

    return user;
}

export const db = {
    users,
    widgets,
};

export async function teardownSeed(): Promise<void> {
    if (seededUserIds.length > 0) {
        await (
            await widgets()
        ).deleteMany({
            user_id: { $in: seededUserIds },
        });
        await (await users()).deleteMany({ id: { $in: seededUserIds } });
    }

    seededUserIds = [];
}

export async function cleanup(): Promise<void> {
    await teardownSeed();
    if (_mongoClient) await _mongoClient.close();
    _db = null;
    _mongoClient = null;
}
