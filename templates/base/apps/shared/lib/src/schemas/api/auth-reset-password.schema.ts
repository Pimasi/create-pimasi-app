import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type ResetPasswordRequest = Static<typeof ResetPasswordRequestSchema>;
export const ResetPasswordRequestSchema = Schema.Object({
    email: Schema.String({ format: "email" }),
});
