import { $mongo } from "../services/db";
import { WidgetsRepo, WidgetModel } from "./widgets";

const _widgets = $mongo.collection<WidgetModel>("widgets");

export const widgetsRepo: WidgetsRepo = {
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
