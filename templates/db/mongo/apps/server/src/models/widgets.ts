import { Widget } from "@pimasi/lib/schemas/api/widget.schema";
import { $mongo } from "../services/db";

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

const _widgets = $mongo.collection<WidgetModel>("widgets");

export const $widgets: WidgetsRepo = {
    async listByUser(userId) {
        return _widgets
            .find({ user_id: userId }, { projection: { _id: 0 } })
            .sort({ created_at: -1 })
            .toArray();
    },

    async findByIdForUser(id, userId) {
        return _widgets.findOne(
            { id, user_id: userId },
            { projection: { _id: 0 } },
        );
    },

    async insert(widget) {
        await _widgets.insertOne(widget);
    },

    async updateForUser(id, userId, changes) {
        return _widgets.findOneAndUpdate(
            { id, user_id: userId },
            { $set: changes },
            { returnDocument: "after", projection: { _id: 0 } },
        );
    },

    async deleteForUser(id, userId) {
        let result = await _widgets.deleteOne({ id, user_id: userId });
        return result.deletedCount > 0;
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
