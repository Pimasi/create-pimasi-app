import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type ErrorResponse = Static<typeof ErrorResponseSchema>;
export const ErrorResponseSchema = Schema.Object({
    error: Schema.String(),
});
