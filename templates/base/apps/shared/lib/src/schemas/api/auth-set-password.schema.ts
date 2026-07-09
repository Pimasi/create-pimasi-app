import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type SetPasswordRequest = Static<typeof SetPasswordRequestSchema>;
export const SetPasswordRequestSchema = Schema.Object({
    password: Schema.String({ minLength: 6 }),
    /**
     * The user's current password. Required when the account already has a
     * local hash; ignored for Google-only accounts (no hash yet).
     */
    current_password: Schema.Optional(Schema.String()),
});

export type SetPasswordResponse = Static<typeof SetPasswordResponseSchema>;
export const SetPasswordResponseSchema = Schema.Object({
    success: Schema.Boolean(),
});
