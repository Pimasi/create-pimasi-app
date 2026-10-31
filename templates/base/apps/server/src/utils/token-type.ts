import { wireValues } from "@pimasi/lib/values/wire";

export enum TokenType {
    USER = "user",
    PASSWORD_RESET = "password_reset",
}
wireValues(TokenType, ["user", "password_reset"]);
