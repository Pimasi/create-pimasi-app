import { Widget } from "@pimasi/lib/schemas/api/widget.schema";
import { $db } from "../services/db";

export interface WidgetModel {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    quantity: number;
    created_at: Date;
    updated_at: Date;
}

export interface WidgetUpdate {
    name?: string;
    description?: string | null;
    quantity?: number;
    updated_at: Date;
}

export interface WidgetsRepo {
    listByUser(userId: string): Promise<WidgetModel[]>;
    findByIdForUser(id: string, userId: string): Promise<WidgetModel | null>;
    insert(widget: WidgetModel): Promise<void>;
    updateForUser(
        id: string,
        userId: string,
        changes: WidgetUpdate,
    ): Promise<WidgetModel | null>;
    deleteForUser(id: string, userId: string): Promise<boolean>;
}

export const $widgets: WidgetsRepo = {
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

export function toWidgetResponse(model: WidgetModel): Widget {
    return {
        id: model.id,
        name: model.name,
        description: model.description,
        quantity: model.quantity,
        created_at: model.created_at.toISOString(),
        updated_at: model.updated_at.toISOString(),
    };
}
