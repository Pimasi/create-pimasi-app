import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type RegisterRequest = Static<typeof RegisterRequestSchema>;
export const RegisterRequestSchema = Schema.Object({
    email: Schema.String({ format: "email" }),
    password: Schema.String({ minLength: 6 }),
});
