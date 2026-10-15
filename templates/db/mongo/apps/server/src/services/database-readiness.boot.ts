import { Boot } from "../app/boot";
import { registerReadinessCheck } from "../app/readiness";
import { $mongo } from "./db";

export const DatabaseReadinessBoot = Boot({
    name: "database-readiness",
    handler: () => {
        registerReadinessCheck("database", async () => {
            await $mongo.command({ ping: 1 });
        });
    },
});
