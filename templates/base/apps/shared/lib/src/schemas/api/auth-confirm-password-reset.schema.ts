import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type ConfirmPasswordResetRequest = Static<
    typeof ConfirmPasswordResetRequestSchema
>;
export const ConfirmPasswordResetRequestSchema = Schema.Object({
    token: Schema.String({ minLength: 1 }),
    password: Schema.String({ minLength: 6 }),
});

export type ConfirmPasswordResetResponse = Static<
    typeof ConfirmPasswordResetResponseSchema
>;
export const ConfirmPasswordResetResponseSchema = Schema.Object({
    success: Schema.Boolean(),
    /** Fresh JWT so the FE can log the user in directly after a reset. */
    token: Schema.String(),
});
