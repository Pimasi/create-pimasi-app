import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type LoginRequest = Static<typeof LoginRequestSchema>;
export const LoginRequestSchema = Schema.Object({
    token: Schema.String(),
});

export type LoginResponse = Static<typeof LoginResponseSchema>;
export const LoginResponseSchema = Schema.String();
