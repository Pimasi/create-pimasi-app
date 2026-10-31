import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type PingResponse = Static<typeof PingResponseSchema>;
export const PingResponseSchema = Schema.Const("pong");
