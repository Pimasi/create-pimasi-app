import { Migration } from "../app/migration";
import { $mongo } from "../services/db";

export const CreateInitialIndexes = Migration({
    name: "20260709120000-create-initial-indexes",
    handler: async () => {
        let users = $mongo.collection("users");

        await users.createIndex({ email: 1 }, { unique: true });
    },
});
