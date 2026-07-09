import { Migration } from "../app/migration";
import { $mongo } from "../services/db";

export const CreateInitialIndexes = Migration({
    name: "20260709120000-create-initial-indexes",
    handler: async () => {
        let users = $mongo.collection("users");
        let widgets = $mongo.collection("widgets");

        await users.createIndex({ email: 1 }, { unique: true });

        await widgets.createIndex({ user_id: 1, created_at: -1 });
    },
});
