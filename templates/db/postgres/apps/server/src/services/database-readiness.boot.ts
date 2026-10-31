import { sql } from "kysely";
import { Boot } from "../app/boot";
import { registerReadinessCheck } from "../app/readiness";
import { $db } from "./db";

export const DatabaseReadinessBoot = Boot({
    name: "database-readiness",
    handler: () => {
        registerReadinessCheck("database", async () => {
            await sql`select 1`.execute($db);
        });
    },
});
