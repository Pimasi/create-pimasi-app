import { type Selectable } from "kysely";
import { $db, type Database } from "../services/db";
import type { UserModel, UsersRepo } from "./users";
import type { UserRoles } from "@pimasi/lib/values/auth";

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

export const usersRepo: UsersRepo = {
    async findById(id) {
        let row = await $db
            .selectFrom("users")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirst();
        return row ? mapUserRow(row) : null;
    },

    async findByEmail(email) {
        let row = await $db
            .selectFrom("users")
            .selectAll()
            .where("email", "=", email)
            .executeTakeFirst();
        return row ? mapUserRow(row) : null;
    },

    async findByFirebaseOrEmail(firebaseId, email) {
        let row = await $db
            .selectFrom("users")
            .selectAll()
            .where((eb) =>
                eb.or([
                    eb("firebase_id", "=", firebaseId),
                    eb("email", "=", email),
                ]),
            )
            .executeTakeFirst();
        return row ? mapUserRow(row) : null;
    },

    async insert(user) {
        await $db
            .insertInto("users")
            .values({
                id: user.id,
                created_at: user.created_at,
                name: user.name,
                email: user.email,
                email_verified: user.email_verified,
                password_hash: user.password_hash ?? null,
                firebase_id: user.firebase_id ?? null,
                disabled_at: user.disabled_at ?? null,
                roles: JSON.stringify(user.roles),
            })
            .execute();
    },

    async update(id, changes) {
        let updateRow: {
            name?: string;
            email?: string;
            email_verified?: boolean;
            password_hash?: string | null;
            firebase_id?: string | null;
            disabled_at?: Date | null;
            roles?: string;
        } = {};

        if (changes.name !== undefined) updateRow.name = changes.name;
        if (changes.email !== undefined) updateRow.email = changes.email;
        if (changes.email_verified !== undefined) {
            updateRow.email_verified = changes.email_verified;
        }
        if (changes.password_hash !== undefined) {
            updateRow.password_hash = changes.password_hash;
        }
        if (changes.firebase_id !== undefined) {
            updateRow.firebase_id = changes.firebase_id;
        }
        if (changes.disabled_at !== undefined) {
            updateRow.disabled_at = changes.disabled_at;
        }
        if (changes.roles !== undefined) {
            updateRow.roles = JSON.stringify(changes.roles);
        }

        if (Object.keys(updateRow).length === 0) return;

        await $db
            .updateTable("users")
            .set(updateRow)
            .where("id", "=", id)
            .execute();
    },
};
