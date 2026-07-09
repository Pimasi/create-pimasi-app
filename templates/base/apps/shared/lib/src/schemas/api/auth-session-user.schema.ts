import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type SessionUserResponse = Static<typeof SessionUserResponseSchema>;
export const SessionUserResponseSchema = Schema.Object({
    id: Schema.String(),
    name: Schema.String(),
    email: Schema.String(),
    email_verified: Schema.Boolean(),
    /**
     * The user's stored password hash, or "" when no local password is set
     * (e.g. accounts created via Google only). The FE treats any empty/null/
     * undefined value as "no password yet" and shows the initial-set flow
     * instead of the change-password flow.
     */
    password: Schema.String(),
    firebase_id: Schema.Optional(Schema.Nullable(Schema.String())),
    roles: Schema.Array(Schema.String()),
});
