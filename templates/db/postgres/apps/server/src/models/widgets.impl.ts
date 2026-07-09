import { $db } from "../services/db";
import type { WidgetsRepo } from "./widgets";

export const widgetsRepo: WidgetsRepo = {
    async listByUser(userId) {
        let rows = await $db
            .selectFrom("widgets")
            .selectAll()
            .where("user_id", "=", userId)
            .orderBy("created_at", "desc")
            .execute();
        return rows;
    },

    async findByIdForUser(id, userId) {
        let row = await $db
            .selectFrom("widgets")
            .selectAll()
            .where("id", "=", id)
            .where("user_id", "=", userId)
            .executeTakeFirst();
        return row ?? null;
    },

    async insert(widget) {
        await $db
            .insertInto("widgets")
            .values({
                id: widget.id,
                user_id: widget.user_id,
                name: widget.name,
                description: widget.description,
                quantity: widget.quantity,
                created_at: widget.created_at,
                updated_at: widget.updated_at,
            })
            .execute();
    },

    async updateForUser(id, userId, changes) {
        let updateRow: {
            name?: string;
            description?: string | null;
            quantity?: number;
            updated_at: Date;
        } = { updated_at: changes.updated_at };

        if (changes.name !== undefined) updateRow.name = changes.name;
        if (changes.description !== undefined) {
            updateRow.description = changes.description;
        }
        if (changes.quantity !== undefined) {
            updateRow.quantity = changes.quantity;
        }

        let row = await $db
            .updateTable("widgets")
            .set(updateRow)
            .where("id", "=", id)
            .where("user_id", "=", userId)
            .returningAll()
            .executeTakeFirst();

        return row ?? null;
    },

    async deleteForUser(id, userId) {
        let deleted = await $db
            .deleteFrom("widgets")
            .where("id", "=", id)
            .where("user_id", "=", userId)
            .returning("id")
            .executeTakeFirst();
        return deleted !== undefined;
    },
};
