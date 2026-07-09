import { Kysely, PostgresDialect, Generated, ColumnType } from "kysely";
import { Pool } from "pg";
import { UserRoles } from "@pimasi/lib/values/auth";
import { $env } from "../utils/env";

interface UsersTable {
    id: string;
    created_at: ColumnType<Date, Date | string, never>;
    name: string;
    email: string;
    email_verified: boolean;
    password_hash: string | null;
    firebase_id: string | null;
    disabled_at: ColumnType<Date | null, Date | null, Date | null>;
    roles: ColumnType<UserRoles[], string, string>;
}

interface WidgetsTable {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    quantity: number;
    created_at: ColumnType<Date, Date | string, Date | string>;
    updated_at: ColumnType<Date, Date | string, Date | string>;
}

export interface Database {
    users: UsersTable;
    widgets: WidgetsTable;
}

export const $db = new Kysely<Database>({
    dialect: new PostgresDialect({
        pool: new Pool({ connectionString: $env.DATABASE_URL }),
    }),
});
