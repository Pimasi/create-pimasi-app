import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type PingResponse = Static<typeof PingResponseSchema>;
export const PingResponseSchema = Schema.Object({
    message: Schema.Const("pong"),
    version: Schema.String(),
    commit: Schema.String(),
});
