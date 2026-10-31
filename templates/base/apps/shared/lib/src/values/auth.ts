import { wireValues } from "@pimasi/lib/values/wire";

export enum UserRole {
    ADMIN = "admin",
    USER = "user",
}
wireValues(UserRole, ["admin", "user"]);
