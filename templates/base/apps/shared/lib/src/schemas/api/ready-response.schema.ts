import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type ReadyResponse = Static<typeof ReadyResponseSchema>;
export const ReadyResponseSchema = Schema.Object({
    status: Schema.AnyOf([Schema.Const("ready"), Schema.Const("unavailable")]),
    checks: Schema.Record(
        Schema.String(),
        Schema.AnyOf([Schema.Const("ok"), Schema.Const("failed")]),
    ),
});
